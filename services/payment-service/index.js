const express = require("express");
const { Pool } = require("pg");
const { createClient } = require("redis");

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT) || 3000;
const SERVICE_NAME = process.env.SERVICE_NAME || "payment-service";
const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;

const startTime = Date.now();

const pool = new Pool({
  connectionString: DATABASE_URL,
});

const redisClient = createClient({
  url: REDIS_URL,
});

redisClient.on("error", (err) => {
  console.error("Redis client error:", err.message);
});

async function connectRedis() {
  if (!redisClient.isOpen) {
    await redisClient.connect();
    console.log("Connected to Redis");
  }
}

app.get("/", (_req, res) => {
  res.json({
    service: SERVICE_NAME,
    status: "ok",
    message: "Payment service is running",
  });
});

app.get("/health", async (_req, res) => {
  const checks = {};
  let healthy = true;

  const dbStart = Date.now();
  try {
    await pool.query("SELECT 1");
    checks.database = {
      status: "healthy",
      latency_ms: Date.now() - dbStart,
    };
  } catch (err) {
    healthy = false;
    checks.database = {
      status: "unhealthy",
      error: err.message,
    };
  }

  const redisStart = Date.now();
  try {
    const pong = await redisClient.ping();
    if (pong !== "PONG") {
      throw new Error(`unexpected Redis response: ${pong}`);
    }

    checks.redis = {
      status: "healthy",
      latency_ms: Date.now() - redisStart,
    };
  } catch (err) {
    healthy = false;
    checks.redis = {
      status: "unhealthy",
      error: err.message,
    };
  }

  const body = {
    status: healthy ? "healthy" : "unhealthy",
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    checks,
  };

  res.status(healthy ? 200 : 503).json(body);
});

app.post("/payments/validate", async (req, res) => {
  const { userId, eventId, amount, cardToken } = req.body;
  const idempotencyKey = req.header("Idempotency-Key");

  if (!idempotencyKey) {
    return res.status(400).json({
      error: "Idempotency-Key header is required",
    });
  }

  if (!userId || !eventId || amount == null || !cardToken) {
    return res.status(400).json({
      error: "userId, eventId, amount, and cardToken are required",
    });
  }

  if (Number(amount) <= 0) {
    return res.status(400).json({
      error: "amount must be greater than 0",
    });
  }

  try {
    const existingPayment = await pool.query(
      `
      SELECT id, idempotency_key, user_id, event_id, amount, status, created_at
      FROM payments
      WHERE idempotency_key = $1
      `,
      [idempotencyKey]
    );

    if (existingPayment.rows.length > 0) {
      return res.status(200).json({
        message: "duplicate request - returning existing payment",
        payment: existingPayment.rows[0],
      });
    }

    const approved = true;

    const result = await pool.query(
      `
      INSERT INTO payments (idempotency_key, user_id, event_id, amount, card_token, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, idempotency_key, user_id, event_id, amount, status, created_at
      `,
      [idempotencyKey, userId, eventId, amount, cardToken, approved ? "approved" : "declined"]
    );

    if (!approved) {
      return res.status(402).json({
        error: "payment declined",
        payment: result.rows[0],
      });
    }

    return res.status(200).json({
      message: "payment approved",
      payment: result.rows[0],
    });
  } catch (err) {
    console.error("Payment validation error:", err.message);
    return res.status(500).json({
      error: "failed to process payment",
    });
  }
});

async function start() {
  try {
    await pool.query("SELECT 1");
    console.log("Connected to Postgres");

    await connectRedis();

    app.listen(PORT, () => {
      console.log(`${SERVICE_NAME} listening on port ${PORT}`);
    });
  } catch (err) {
    console.error("Startup failure:", err.message);
    process.exit(1);
  }
}

start();