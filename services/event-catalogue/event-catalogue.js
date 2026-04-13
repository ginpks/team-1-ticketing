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

  try {
    const startTime = Date.now();
    await client.ping();
    checks.redis = {
      status: "healthy",
      latency_ms: Date.now() - startTime,
    };
  } catch (err) {
    healthy = false;
    checks.redis = {
      status: "unhealthy",
      error: err.message,
    };
  }

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "healthy" : "unhealthy",
    service: "event-catalogue",
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    checks,
  });
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
