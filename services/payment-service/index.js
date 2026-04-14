const express = require("express");
const { Pool } = require("pg");
const { createClient } = require("redis");
 
const app = express();
app.use(express.json());
 
const PORT = Number(process.env.PORT) || 3000;
const SERVICE_NAME = process.env.SERVICE_NAME || "payment-service";
const startTime = Date.now();
 
// ── Postgres ──────────────────────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 
// ── Redis ─────────────────────────────────────────────────────────────────────
const redisClient = createClient({ url: process.env.REDIS_URL });
redisClient.on("error", (err) => console.error("Redis client error:", err.message));
 
// ── GET / ─────────────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({ service: SERVICE_NAME, status: "ok", message: "Payment service is running" });
});
 
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
 
// ── POST /pay ─────────────────────────────────────────────────────────────────
// Called synchronously by the Ticket Purchase Service.
//
// Body:    { purchaseId, amount }
// Returns: { status: "success" | "failure", transaction_ref: "..." }
app.post("/pay", async (req, res) => {
  const { purchaseId, amount } = req.body;
 
  // ── Validate ───────────────────────────────────────────────────────────────
  if (amount == null) {
    return res.status(400).json({
      status: "failure",
      error: "purchaseId and amount are required",
    });
  }
 
  if (Number(amount) <= 0) {
    return res.status(400).json({
      status: "failure",
      error: "amount must be greater than 0",
    });
  }
 
  // ── Simulate payment (90% success) ────────────────────────────────────────
  const success = Math.random() < 0.9;
  const status = success ? "success" : "failure";
  const transaction_ref = `txn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
 
  return res.status(success ? 200 : 402).json({ status, transaction_ref });
});
 
// ── Start ─────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await pool.query("SELECT 1");
    console.log("Connected to Postgres");
 
    await redisClient.connect();
    console.log("Connected to Redis");
 
    app.listen(PORT, () => {
      console.log(`${SERVICE_NAME} listening on port ${PORT}`);
    });
  } catch (err) {
    console.error("Startup failure:", err.message);
    process.exit(1);
  }
}
 
start();
 