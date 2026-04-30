import express from "express";
import redis from "redis";
import pkg from "pg";

const app = express();
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const port = Number(process.env.PORT) || 3003;
const redisUrl = process.env.REDIS_URL || "redis://redis:6379";
const client = redis.createClient({ url: redisUrl });
const subscriber = redis.createClient({ url: redisUrl });

async function resolveIds(eventName, seatName) {
  const eventResult = await pool.query(
    "SELECT event_id FROM events WHERE name = $1 LIMIT 1",
    [eventName],
  );
  if (eventResult.rows.length === 0) return null;
  const event_id = eventResult.rows[0].event_id;

  const seatResult = await pool.query(
    "SELECT seat_id FROM seats WHERE event_id = $1 AND seat_number = $2 LIMIT 1",
    [event_id, seatName],
  );
  if (seatResult.rows.length === 0) return null;
  const seat_id = seatResult.rows[0].seat_id;

  return { event_id, seat_id };
}

app.use(express.json());

client.on("error", (err) => {
  console.error("Client Redis error:", err.message);
});

subscriber.on("error", (err) => {
  console.error("Subscriber Redis error:", err.message);
});

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
}

app.get("/", (_req, res) => {
  res.json({
    service: "event-catalogue",
    status: "ok",
    message: "Event catalogue service is running",
  });
});

app.get("/health", async (_req, res) => {
  const checks = {};
  let healthy = true;

  await Promise.all([
    // Check Redis connection
    (async () => {
      try {
        const start_time = Date.now();
        await client.ping();
        checks.redis = {
          status: "healthy",
          latency_ms: Date.now() - start_time,
        };
      } catch (err) {
        healthy = false;
        checks.redis = { status: "unhealthy", error: err.message };
      }
    })(),

    // Check DB connection
    (async () => {
      try {
        const start_time = Date.now();
        await pool.query("SELECT 1");
        checks.database = {
          status: "healthy",
          latency_ms: Date.now() - start_time,
        };
      } catch (err) {
        healthy = false;
        checks.database = { status: "unhealthy", error: err.message };
      }
    })(),
  ]);

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "healthy" : "unhealthy",
    service: "event-catalogue",
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    checks,
  });
});

// ------------- GET events -------------
app.get("/events", async (_req, res) => {
  try {
    const cached = await client.get("events:all");
    if (cached) {
      return res.status(200).json(JSON.parse(cached));
    }

    const result = await pool.query("SELECT * FROM events");

    await client.setEx("events:all", 60, JSON.stringify(result.rows));

    // Did not put a check for empty array, that is not an error.
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error("Error fetching events:", err.message);
    return res.status(500).json({ error: "Failed to fetch events" });
  }
});

// ------------- GET events/:event_id -------------
app.get("/events/:event_id", async (req, res) => {
  const { event_id } = req.params;

  if (!event_id) {
    return res.status(400).json({ error: "event_id is required" });
  }

  try {
    const cached = await client.get(`events:${event_id}`);
    if (cached) {
      return res.status(200).json(JSON.parse(cached));
    }
    const event = await pool.query("SELECT * FROM events WHERE event_id = $1", [
      event_id,
    ]);
    if (event.rows.length === 0) {
      return res.status(404).json({ error: "Event not found" });
    }
    const seats = await pool.query("SELECT * FROM seats WHERE event_id = $1", [
      event_id,
    ]);
    const responseObject = { event: event.rows[0], seats: seats.rows };
    await client.setEx(
      `events:${event_id}`,
      60,
      JSON.stringify(responseObject),
    );
    res.status(200).json(responseObject);
  } catch (err) {
    console.error("Error fetching event:", err.message);
    res.status(500).json({ error: "Failed to fetch event" });
  }
});

// ------------- GET /events/:event_id/seats/:seat_id -------------
app.get("/events/:event_id/seats/:seat_id", async (req, res) => {
  const { event_id, seat_id } = req.params;

  if (!event_id) {
    return res.status(400).json({ error: "event_id is required" });
  }

  if (!seat_id) {
    return res.status(400).json({ error: "seat_id is required" });
  }

  try {
    const result = await pool.query(
      "SELECT * FROM seats WHERE seat_id = $1 AND event_id = $2",
      [seat_id, event_id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Seat not found for this event" });
    }

    const seat = result.rows[0];

    if (seat.status !== "available") {
      return res.status(409).json({
        available: false,
        error: "Seat is not available",
        status: seat.status,
      });
    }

    return res.status(200).json({
      available: true,
      seat,
    });
  } catch (err) {
    console.error("Error checking seat:", err.message);
    return res.status(500).json({ error: "Failed to check seat availability" });
  }
});

// ------------- POST events -------------
app.post("/events", async (req, res) => {
  const { name, start_time, end_time, venue_name, venue_address } = req.body;
  if (!name || !start_time || !venue_name) {
    return res
      .status(400)
      .json({ error: "name, start_time and venue_name are required" });
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");

    const eventResult = await dbClient.query(
      `INSERT INTO events (name, start_time, end_time, venue_name, venue_address)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, start_time, end_time, venue_name, venue_address],
    );
    const event = eventResult.rows[0];

    await dbClient.query("COMMIT");
    await client.del("events:all");
    return res.status(201).json(event);
  } catch (err) {
    await dbClient.query("ROLLBACK");
    console.error("Error creating event:", err.message);
    return res.status(500).json({ error: "Failed to create event" });
  } finally {
    dbClient.release();
  }
});

app.listen(port, async () => {
  console.log(`Event Catalogue Service listening on port ${port}`);

  try {
    await client.connect();
    await subscriber.connect();
    console.log("Event Catalog service connected to Redis");

    await subscriber.subscribe("purchases:confirmed", async (message) => {
      try {
        const { seat, event } = JSON.parse(message);
        if (!seat || !event) return;

        await pool.query(
          "UPDATE seats SET status = 'sold' WHERE seat_id = $1 AND event_id = $2",
          [seat, event],
        );

        await client.del(`events:${event}`);
        console.log(
          `Seat ${seat} marked as sold, cache invalidated for event ${event}`,
        );
      } catch (err) {
        console.error("Error handling purchases:confirmed:", err.message);
      }
    });
    console.log("Subscribed to purchases:confirmed");

    await subscriber.subscribe("seat:released", async (message) => {
      try {
        const { seat, event } = JSON.parse(message);
        if (!seat || !event) return;

        await pool.query(
          "UPDATE seats SET status = 'available' WHERE seat_id = $1 AND event_id = $2",
          [seat, event],
        );

        await client.del(`events:${event}`);
        console.log(
          `Seat ${seat} marked as available, cache invalidated for event ${event}`,
        );
      } catch (err) {
        console.error("Error handling seat:released:", err.message);
      }
    });
    console.log("Subscribed to seat:released");
  } catch (err) {
    console.error("Failed to connect to Redis:", err.message);
  }
});
