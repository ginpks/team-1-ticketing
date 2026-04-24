import express from "express";
import redis from "redis";
import pkg from "pg";

const PAYMENT_SERVICE_URL =
  process.env.PAYMENT_SERVICE_URL || "http://payment-service:3000";
const app = express();
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const port = Number(process.env.PORT) || 3001;
const queueName = process.env.QUEUE_NAME || "ticket-purchase-queue";
const client = redis.createClient({
  url: process.env.REDIS_URL || "redis://redis:6379",
});

app.use(express.json());

client.on("error", (err) => {
  console.error("Redis error:", err.message);
});

const publishPurchaseConfirmed = async (message) => {
  try {
    await client.publish("purchases:confirmed", JSON.stringify(message));
    console.log("Published purchase confirmation:", message.purchase_id);
  } catch (err) {
    console.error("Failed to publish purchase confirmation:", err.message);
  }
};

// ── GET /health ───────────────────────────────────────────────────────────────
app.get("/health", async (_req, res) => {
  const checks = {};
  let healthy = true;

  await Promise.all([
    (async () => {
      try {
        const start = Date.now();
        await client.ping();
        checks.redis = { status: "healthy", latency_ms: Date.now() - start };
      } catch (err) {
        healthy = false;
        checks.redis = { status: "unhealthy", error: err.message };
      }
    })(),
    (async () => {
      try {
        const start = Date.now();
        await pool.query("SELECT 1");
        checks.database = { status: "healthy", latency_ms: Date.now() - start };
      } catch (err) {
        healthy = false;
        checks.database = { status: "unhealthy", error: err.message };
      }
    })(),
  ]);

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "healthy" : "unhealthy",
    service: "ticket-purchase",
    queueName,
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    checks,
  });
});

// ── GET /purchases/:id ────────────────────────────────────────────────────────
app.get("/purchases/:id", async (req, res) => {
  const purchaseId = Number(req.params.id);

  if (!Number.isInteger(purchaseId) || purchaseId <= 0) {
    return res.status(400).json({ error: "Invalid purchase ID" });
  }

  try {
    const result = await pool.query(
      "SELECT id, status, amount, idempotency_key, created_at FROM purchases WHERE id = $1",
      [purchaseId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Purchase not found" });
    }
    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error("Error fetching purchase:", err.message);
    return res.status(500).json({ error: "Failed to fetch purchase" });
  }
});

// POST /waitlist
app.post("/waitlist", async (req, res) => {
  const { event, amount, idempotency_key } = req.body;
  if (!event || !amount || !idempotency_key) {
    return res.status(400).json({ error: "mission field" });
  }
  const waitlist = `waitlist:${event}`;
  await client.rPush(
    waitlist,
    JSON.stringify({ event, amount, idempotency_key }),
  );
  return res.status(200).json({ message: "success" });
});

// ── POST /purchases ───────────────────────────────────────────────────────────
app.post("/purchases", async (req, res) => {
  const { idempotency_key, event, seat, start_time, end_time, amount } =
    req.body;

  if (
    !idempotency_key ||
    !event ||
    !seat ||
    !start_time ||
    !end_time ||
    !amount
  ) {
    return res.status(400).json({
      error:
        "Missing required fields: idempotency_key, event, seat, start_time, end_time, amount",
    });
  }

  try {
    // ── Idempotency check ────────────────────────────────────────────────────
    const existing = await pool.query(
      "SELECT id, status, amount FROM purchases WHERE idempotency_key = $1",
      [idempotency_key],
    );
    if (existing.rows.length > 0) {
      return res.status(200).json({
        message: "Duplicate request — returning existing purchase",
        duplicate: true,
        purchase: existing.rows[0],
      });
    }

    // ── Store everything as pending in one DB transaction ────────────────────
    const dbClient = await pool.connect();
    let purchaseId;
    try {
      await dbClient.query("BEGIN");

      const purchaseData = await dbClient.query(
        `INSERT INTO purchases (amount, status, idempotency_key) VALUES ($1, $2, $3) RETURNING id`,
        [amount, "pending", idempotency_key],
      );
      purchaseId = purchaseData.rows[0].id;

      await dbClient.query(
        `INSERT INTO reservations (purchase_id, event, seat, start_time, end_time) VALUES ($1, $2, $3, $4, $5)`,
        [purchaseId, event, seat, start_time, end_time],
      );

      await dbClient.query(
        `INSERT INTO payments (purchase_id, status, amount, transaction_ref) VALUES ($1, $2, $3, $4)`,
        [purchaseId, "pending", amount, null],
      );

      await dbClient.query("COMMIT");
    } catch (err) {
      await dbClient.query("ROLLBACK");
      throw err;
    } finally {
      dbClient.release();
    }

    // ── Push job to Redis queue (async — don't wait for payment) ─────────────
    await client.lPush(
      queueName,
      JSON.stringify({
        purchaseId,
        amount,
        event,
        seat,
        idempotency_key,
      }),
    );
    console.log(`Queued payment job for purchaseId ${purchaseId}`);

    // ── Return immediately with pending status ────────────────────────────────
    return res.status(202).json({
      duplicate: false,
      purchase: {
        id: purchaseId,
        status: "pending",
        amount,
        idempotency_key,
        event,
        seat,
      },
    });
  } catch (err) {
    console.error("Error creating purchase:", err.message);
    return res.status(500).json({ error: "Failed to create purchase" });
  }
});

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(port, async () => {
  console.log(`Ticket Purchase Service listening on port ${port}`);
  try {
    await client.connect();
    console.log("Connected to Redis successfully");
  } catch (err) {
    console.error("Failed to connect to Redis:", err.message);
  }
});

