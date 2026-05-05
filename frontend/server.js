import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8000;

// Caddy handles: /events* → event-catalogue, /pay → payment, else → ticket-purchase
const CADDY = process.env.CADDY_URL || 'http://caddy:80';

const DIRECT = {
  refund:             process.env.REFUND_URL              || 'http://refund-service:3007',
  notificationSvc:    process.env.NOTIFICATION_SVC_URL    || 'http://notification-service:3005',
  notificationWorker: process.env.NOTIFICATION_WORKER_URL || 'http://notification-worker:3006',
  ticketWorker:       process.env.TICKET_WORKER_URL       || 'http://ticket-worker:4000',
  analyticsWorker:    process.env.ANALYTICS_WORKER_URL    || 'http://analytics-worker:4001',
  fraudWorker:        process.env.FRAUD_WORKER_URL        || 'http://fraud-worker:4002',
  waitlistWorker:     process.env.WAITLIST_WORKER_URL     || 'http://waitlist-worker:4003',
};

const HEALTH_SERVICES = [
  { key: 'ticket-purchase',       label: 'Ticket Purchase',      url: CADDY,                        type: 'service' },
  { key: 'event-catalogue',       label: 'Event Catalogue',      url: `${CADDY}/events`,             type: 'service', healthPath: '/health' },
  { key: 'payment-service',       label: 'Payment Service',      url: `${CADDY}/payment`,            type: 'service', healthPath: '/health' },
  { key: 'notification-service',  label: 'Notification Service', url: DIRECT.notificationSvc,       type: 'service' },
  { key: 'refund-service',        label: 'Refund Service',       url: DIRECT.refund,                type: 'service' },
  { key: 'ticket-worker',         label: 'Ticket Worker',        url: DIRECT.ticketWorker,          type: 'worker'  },
  { key: 'notification-worker',   label: 'Notification Worker',  url: DIRECT.notificationWorker,    type: 'worker'  },
  { key: 'analytics-worker',      label: 'Analytics Worker',     url: DIRECT.analyticsWorker,       type: 'worker'  },
  { key: 'fraud-worker',          label: 'Fraud Worker',         url: DIRECT.fraudWorker,           type: 'worker'  },
  { key: 'waitlist-worker',       label: 'Waitlist Worker',      url: DIRECT.waitlistWorker,        type: 'worker'  },
];

async function pfetch(url, opts = {}) {
  const signal = AbortSignal.timeout(5000);
  return fetch(url, { ...opts, signal });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Aggregate health ──────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  const results = await Promise.allSettled(
    HEALTH_SERVICES.map(async (svc) => {
      const start = Date.now();
      const url = svc.healthPath ? `${svc.url}${svc.healthPath}` : `${svc.url}/health`;
      try {
        const r = await pfetch(url);
        const data = await r.json().catch(() => ({}));
        return { ...svc, status: r.ok ? 'healthy' : 'unhealthy', latency: Date.now() - start, data };
      } catch (e) {
        return { ...svc, status: 'unreachable', latency: Date.now() - start, data: {}, error: e.message };
      }
    })
  );
  res.json(results.map(r => r.status === 'fulfilled' ? r.value : { status: 'unreachable', data: {} }));
});

// ── Events (via Caddy → event-catalogue) ─────────────────────────────────
app.get('/api/events', async (_req, res) => {
  try {
    const r = await pfetch(`${CADDY}/events`);
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/events/:name', async (req, res) => {
  try {
    const r = await pfetch(`${CADDY}/events/${encodeURIComponent(req.params.name)}`);
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Purchases (via Caddy → ticket-purchase) ───────────────────────────────
app.post('/api/purchases', async (req, res) => {
  try {
    const r = await pfetch(`${CADDY}/purchases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/purchases/:id', async (req, res) => {
  try {
    const r = await pfetch(`${CADDY}/purchases/${req.params.id}`);
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Waitlist (via Caddy → ticket-purchase) ────────────────────────────────
app.post('/api/waitlist', async (req, res) => {
  try {
    const r = await pfetch(`${CADDY}/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Refunds (direct) ──────────────────────────────────────────────────────
app.post('/api/refunds', async (req, res) => {
  try {
    const r = await pfetch(`${DIRECT.refund}/refunds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Analytics worker health ───────────────────────────────────────────────
app.get('/api/analytics', async (_req, res) => {
  try {
    const r = await pfetch(`${DIRECT.analyticsWorker}/health`);
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Fraud worker health ───────────────────────────────────────────────────
app.get('/api/fraud', async (_req, res) => {
  try {
    const r = await pfetch(`${DIRECT.fraudWorker}/health`);
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`[frontend] http://localhost:${PORT}`));
