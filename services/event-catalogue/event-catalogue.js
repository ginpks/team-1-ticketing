import express from "express";
import redis from "redis";
import pkg from "pg";

const app = express();
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const port = Number(process.env.PORT) || 3003;
const redisUrl = process.env.REDIS_URL || "redis://redis:6379";
const client = redis.createClient({ url: redisUrl });

app.use(express.json());

client.on("error", (err) => {
  console.error("Redis error:", err.message);
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
    const result = await pool.query("SELECT * FROM events");
    // Did not put a check for empty array, that is not an error.
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error("Error fetching events:", err.message);
    return res.status(500).json({ error: "Failed to fetch events" });
  }
});

app.listen(port, async () => {
  console.log(`Event Catalogue Service listening on port ${port}`);

  try {
    await client.connect();
    console.log("Connected to Redis successfully");
  } catch (err) {
    console.error("Failed to connect to Redis:", err.message);
  }
});
