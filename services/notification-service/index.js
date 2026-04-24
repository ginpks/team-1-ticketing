const express = require("express");

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT) || 3005;
const SERVICE_NAME = "notification-service";
const startTime = Date.now();

// ── POST /notify ──────────────────────────────────────────────────────────────
// Called by the Notification Worker when a purchase is confirmed.
app.post("/notify", (req, res) => {
  const {
    purchase_id,
    event,
    seat,
    amount,
    idempotency_key,
    confirmed_at,
  } = req.body;

  if (!purchase_id) {
    return res.status(400).json({
      status: "error",
      error: "purchase_id is required",
    });
  }

  // Simulate sending confirmation email
  console.log(JSON.stringify({
    event: "email_sent",
    subject: "Purchase Confirmed",
    purchase_id,
    event_name: event,
    seat,
    amount,
    idempotency_key,
    confirmed_at,
    timestamp: new Date().toISOString(),
  }));

  return res.status(200).json({
    status: "ok",
    message: `Email sent for purchase ${purchase_id}`,
  });
});

// ── GET /health ───────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "healthy",
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
  });
});

// ── GET / ─────────────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({
    service: SERVICE_NAME,
    status: "ok",
    message: "Notification service is running",
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`${SERVICE_NAME} listening on port ${PORT}`);
});