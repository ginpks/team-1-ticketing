const express = require("express");
const { Pool } = require("pg");
const { createClient } = require("redis");

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT) || 3007;
const SERVICE_NAME = "refund-service";
const startTime = Date.now();

const TICKET_PURCHASE_URL = process.env.TICKET_PURCHASE_URL || "http://ticket-purchase:3001";
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || "http://payment-service:3000";
const WAITLIST_QUEUE = process.env.WAITLIST_QUEUE || "waitlist-queue";

// ── Postgres ──────────────────────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.REFUND_DATABASE_URL });

// ── Redis ─────────────────────────────────────────────────────────────────────
const redisClient = createClient({ url: process.env.REDIS_URL || "redis://redis:6379" });
redisClient.on("error", (err) => console.error("Redis error:", err.message));

// ── GET /health ───────────────────────────────────────────────────────────────
app.get("/health", async (_req, res) => {
  const checks = {};
  let healthy = true;

  const dbStart = Date.now();
  try {
    await pool.query("SELECT 1");
    checks.database = { status: "healthy", latency_ms: Date.now() - dbStart };
  } catch (err) {
    healthy = false;
    checks.database = { status: "unhealthy", error: err.message };
  }

  const redisStart = Date.now();
  try {
    const pong = await redisClient.ping();
    if (pong !== "PONG") throw new Error(`unexpected Redis response: ${pong}`);
    checks.redis = { status: "healthy", latency_ms: Date.now() - redisStart };
  } catch (err) {
    healthy = false;
    checks.redis = { status: "unhealthy", error: err.message };
  }

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "healthy" : "unhealthy",
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    checks,
  });
});

// ── POST /refunds ─────────────────────────────────────────────────────────────
app.post("/refunds", async (req, res) => {
  const { purchase_id, amount, idempotency_key, event, seat, start_time, end_time } = req.body;

  // ── Validate ───────────────────────────────────────────────────────────────
  if (!purchase_id || !amount || !idempotency_key) {
    return res.status(400).json({
      error: "Missing required fields: purchase_id, amount, idempotency_key",
    });
  }

  try {
    // ── Idempotency check ──────────────────────────────────────────────────
    const existing = await pool.query(
      "SELECT id, status FROM refunds WHERE idempotency_key = $1",
      [idempotency_key]
    );
    if (existing.rows.length > 0) {
      return res.status(200).json({
        message: "Duplicate request — returning existing refund",
        duplicate: true,
        refund: existing.rows[0],
      });
    }

    // ── Validate purchase exists via sync call to Ticket Purchase ──────────
    const purchaseRes = await fetch(`${TICKET_PURCHASE_URL}/purchases/${purchase_id}`);
    if (!purchaseRes.ok) {
      return res.status(404).json({ error: "Purchase not found" });
    }

    // ── Insert refund as pending ────────────────────────────────────────────
    const refundData = await pool.query(
      `INSERT INTO refunds (purchase_id, amount, status, idempotency_key)
       VALUES ($1, $2, 'pending', $3) RETURNING id`,
      [purchase_id, amount, idempotency_key]
    );
    const refundId = refundData.rows[0].id;

    // ── Call Payment Service to reverse charge ─────────────────────────────
    const paymentRes = await fetch(`${PAYMENT_SERVICE_URL}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purchaseId: purchase_id, amount }),
    });
    const paymentData = await paymentRes.json();

    // ── Update refund status ───────────────────────────────────────────────
    const refundStatus = paymentData.status === "success" ? "completed" : "failed";
    await pool.query(
      "UPDATE refunds SET status = $1, updated_at = NOW() WHERE id = $2",
      [refundStatus, refundId]
    );

    // ── Push to waitlist queue on success ──────────────────────────────────
    if (refundStatus === "completed") {
      await redisClient.lPush(WAITLIST_QUEUE, JSON.stringify({
        id: purchase_id,
        event,
        seat,
        startTime: start_time,
        endTime: end_time,
        amount,
        idempotencyKey: idempotency_key,
        status: "cancel",
      }));
      console.log(JSON.stringify({
        event: "refund_processed",
        refundId,
        purchase_id,
        amount,
        status: refundStatus,
        timestamp: new Date().toISOString(),
      }));
    }

    return res.status(201).json({
      refundId,
      purchase_id,
      amount,
      status: refundStatus,
      duplicate: false,
    });

  } catch (err) {
    console.error("Refund error:", err.message);
    return res.status(500).json({ error: "Failed to process refund" });
  }
});

// ── GET / ─────────────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({ service: SERVICE_NAME, status: "ok" });
});

// ── Start ─────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await pool.query("SELECT 1");
    console.log("Connected to Postgres");

    await redisClient.connect();
    console.log("Connected to Redis");

    // ── Create refunds table if not exists ─────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS refunds (
        id SERIAL PRIMARY KEY,
        purchase_id INTEGER NOT NULL,
        amount NUMERIC(10,2) NOT NULL,
        status TEXT CHECK(status IN ('pending', 'completed', 'failed')) NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("Refunds table ready");

    app.listen(PORT, () => {
      console.log(`${SERVICE_NAME} listening on port ${PORT}`);
    });
  } catch (err) {
    console.error("Startup failure:", err.message);
    process.exit(1);
  }
}

start();