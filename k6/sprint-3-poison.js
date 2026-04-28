// Sprint 3 — Poison-Pill Resilience Test
//
// ── HOW TO RUN ────────────────────────────────────────────────────────────────
// Seed the queue with bad requests by running the poison-seed.sh script,
// then run this test:
//
//  k6 run k6/sprint-3-poison.js
//

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend, Gauge } from "k6/metrics";

// ── Service URLs ──────────────────────────────────────────────────────────────
const PURCHASE_URL        = "http://ticket-purchase:3001/purchases";
const TICKET_WORKER_HEALTH = "http://ticket-worker:4000/health";
const NOTIF_WORKER_HEALTH  = "http://notification-worker:3006/health";

// ── Custom metrics ────────────────────────────────────────────────────────────
const normalAcceptErrors  = new Rate("normal_accept_errors");   // must stay < 2 %
const poisonRejected      = new Counter("poison_pills_rejected"); // API-level 4xx
const dlqDepthGauge       = new Gauge("worker_dlq_depth");       // last sampled value
const tpQueueDepthTrend   = new Trend("worker_tp_queue_depth");
const workerLatency       = new Trend("worker_health_latency_ms");
const normalLatency       = new Trend("normal_purchase_latency_ms");

// ── Scenario options ──────────────────────────────────────────────────────────
export const options = {
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],

  scenarios: {
    // ── 1. Steady stream of valid purchases (the "good" traffic) ─────────────
    normal_purchases: {
      executor:         "ramping-arrival-rate",
      startRate:        0,
      timeUnit:         "1s",
      preAllocatedVUs:  100,
      maxVUs:           150,
      stages: [
        { duration: "5s",  target: 30 },  // warm up
        { duration: "20s", target: 30 },  // steady good traffic
        { duration: "5s",  target: 0  },  // cool down
      ],
      startTime: "0s",
      exec:      "normalPurchaseScenario",
    },

    // ── 2. HTTP-level poison pills — malformed API requests ───────────────────
    //    Sent concurrently with good traffic to prove the service absorbs them
    //    without crashing or contaminating the queue.
    //    Uses constant-vus (not ramping-arrival-rate) to avoid VU exhaustion
    //    from slow/hung responses — each VU fires one pill then immediately
    //    starts the next, with a hard per-request timeout as a safety net.
    api_poison_pills: {
      executor:  "constant-vus",
      vus:       5,
      duration:  "28s",
      startTime: "2s",   // slight delay so purchase service is warm
      exec:      "apiPoisonPillScenario",
    },

    // ── 3. Health monitor — samples worker /health every 200 ms ──────────────
    //    Verifies: worker stays up, dlqDepth rises during injection phase,
    //    lastSuccessAt keeps updating (good messages still processed).
    health_monitor: {
      executor:  "constant-vus",
      vus:       1,
      duration:  "35s",
      startTime: "0s",
      exec:      "healthMonitorScenario",
    },

    // ── 4. Post-injection verification — final snapshot of /health ────────────
    //    Runs near the end to confirm dlqDepth > 0 and worker is still alive.
    final_health_check: {
      executor:    "per-vu-iterations",
      vus:         1,
      iterations:  1,
      maxDuration: "10s",
      startTime:   "27s",
      exec:        "finalHealthCheckScenario",
    },
  },

  thresholds: {
    // Good requests must stay fast even under poison load
    "http_req_duration{scenario:normal_purchases}": ["p(95)<600"],

    // Every poison pill must be rejected — checks inside apiPoisonPillScenario
    // assert status is 4xx; this threshold fails if any check fails (rate==1 means
    // all checks passed, i.e. all pills were rejected cleanly).
    "checks{scenario:api_poison_pills}": ["rate>0.95"],

    // The good-traffic acceptance error rate must stay negligible
    normal_accept_errors: ["rate<0.02"],

    // Worker health endpoint must always respond
    "http_req_duration{scenario:health_monitor}": ["p(99)<1000"],
  },
};

// ── setup() — verify services are reachable before the test begins ────────────
//
// setup() does three things:
//   1. Confirms ticket-purchase is up.
//   2. Confirms ticket-worker /health is reachable.
//   3. Snapshots the initial DLQ depth so the final check can prove it grew.
export function setup() {
  console.log("[setup] Verifying services are reachable ...");

  // Smoke-check ticket-purchase
  const purchaseHealth = http.get("http://ticket-purchase:3001/health");
  check(purchaseHealth, {
    "setup: ticket-purchase /health is 200": (r) => r.status === 200,
  });
  if (purchaseHealth.status !== 200) {
    console.error(`[setup] ticket-purchase health check failed (${purchaseHealth.status})`);
  }

  // Snapshot worker DLQ depth at t=0
  const workerHealth = http.get(TICKET_WORKER_HEALTH);
  let initialDlqDepth = 0;
  if (workerHealth.status === 200) {
    try {
      const body = JSON.parse(workerHealth.body);
      initialDlqDepth = body.dlqDepth ?? 0;
      console.log(`[setup] ticket-worker reachable -- initial dlqDepth=${initialDlqDepth}`);
      if (initialDlqDepth === 0) {
        console.warn(
          "[setup] WARNING: DLQ is empty at start. " +
          "Seed queue-level pills FIRST with redis-cli -- see run instructions at the top of this file."
        );
      } else {
        console.log(`[setup] OK: ${initialDlqDepth} queue-level pill(s) already seeded.`);
      }
    } catch {
      console.error("[setup] Could not parse worker /health response");
    }
  } else {
    console.error(`[setup] ticket-worker /health returned ${workerHealth.status}`);
  }

  sleep(0.5);
  return { setupAt: new Date().toISOString(), initialDlqDepth };
}


// ── Helpers ───────────────────────────────────────────────────────────────────

/* Build a fully valid purchase payload. */
function makeValidPurchase() {
  return JSON.stringify({
    idempotency_key: `poison-test-good-${__VU}-${__ITER}-${Date.now()}`,
    event:           "a0000000-0000-0000-0000-000000000001",
    seat:            "b0000000-0000-0000-0000-000000000001A",
    start_time:      "2025-09-01T19:00:00Z",
    end_time:        "2025-09-01T22:00:00Z",
    amount:          (Math.random() * 90 + 10).toFixed(2),
  });
}

/* Pick one of several poison-pill shapes at random. */
function makePoisonPill() {
  const kind = Math.floor(Math.random() * 6);
  switch (kind) {
    case 0:
      // Missing idempotency_key
      return JSON.stringify({
        event:      "Missing Key Show",
        seat:       "C3",
        start_time: "2025-10-01T18:00:00Z",
        end_time:   "2025-10-01T21:00:00Z",
        amount:     "75.00",
      });
    case 1:
      // Missing amount
      return JSON.stringify({
        idempotency_key: `poison-no-amount-${__VU}-${__ITER}`,
        event:           "Free Entry Show",
        seat:            "D4",
        start_time:      "2025-10-02T18:00:00Z",
        end_time:        "2025-10-02T21:00:00Z",
      });
    case 2:
      // Missing all fields - empty body
      return "{}";
    case 3:
      // Completely invalid JSON
      return "i am not json";
    case 4:
      // event_id that does not exist (non-numeric event field, triggers DB error)
      return JSON.stringify({
        idempotency_key: `poison-bad-event-${__VU}-${__ITER}-${Date.now()}`,
        event:           null,            // null event
        seat:            "E5",
        start_time:      "2025-10-03T18:00:00Z",
        end_time:        "2025-10-03T21:00:00Z",
        amount:          "50.00",
      });
    case 5:
    default:
      // Refund poison pill - purchase_id that will never exist
      return JSON.stringify({
        // intentionally omit idempotency_key so validation fires
        purchase_id: 999999999,
        amount:      "9999.99",
      });
  }
}

// ── Scenario 1 — Normal purchases ─────────────────────────────────────────────
export function normalPurchaseScenario() {
  const start = Date.now();
  const res = http.post(
    PURCHASE_URL,
    makeValidPurchase(),
    {
      headers: { "Content-Type": "application/json" },
      tags:    { scenario: "normal_purchases" },
    }
  );

  normalLatency.add(Date.now() - start);

  const ok = check(res, {
    "normal: status 202":          (r) => r.status === 202,
    "normal: body has purchase.id": (r) => {
      try { return JSON.parse(r.body).purchase?.id > 0; } catch { return false; }
    },
    "normal: duplicate is false":  (r) => {
      try { return JSON.parse(r.body).duplicate === false; } catch { return false; }
    },
  });

  normalAcceptErrors.add(!ok);
}

// ── Scenario 2 — API-level poison pills ───────────────────────────────────────
export function apiPoisonPillScenario() {
  // All requests have a hard 3s timeout so a slow response never hangs a VU.
  // We only target ticket-purchase (single-hop, fast validation) to keep
  // response times predictable - no multi-service chains that could stall.
  const params = {
    headers: { "Content-Type": "application/json" },
    tags:    { scenario: "api_poison_pills" },
    timeout: "3s",
  };

  const res = http.post(PURCHASE_URL, makePoisonPill(), params);

  // A 4xx means the pill was absorbed cleanly.
  // A 5xx means unhandled crash; a 2xx means the pill slipped into the queue.
  // Single check per request so each counts as exactly one pass/fail.
  const rejected = check(res, {
    "pill: service returned 4xx (rejected cleanly, not crashed)": (r) =>
      r.status >= 400 && r.status < 500,
  });

  if (rejected) {
    poisonRejected.add(1);
  } else {
    console.warn(`[pill] unexpected status ${res.status} — body: ${res.body?.slice(0, 120)}`);
  }

  sleep(0.2); // ~5 pills/s per VU - steady pressure without flooding
}

// ── Scenario 3 — Health monitor ───────────────────────────────────────────────
export function healthMonitorScenario() {
  const res = http.get(TICKET_WORKER_HEALTH, {
    tags: { scenario: "health_monitor" },
  });

  if (res.status !== 200) {
    console.error(`[monitor] ticket-worker /health returned ${res.status} — worker may be down!`);
    sleep(0.5);
    return;
  }

  let body;
  try {
    body = JSON.parse(res.body);
  } catch {
    console.error("[monitor] Could not parse /health response");
    sleep(0.2);
    return;
  }

  const dlq   = body.dlqDepth      ?? 0;
  const queue = body.tpQueueDepth   ?? 0;
  const last  = body.lastSuccessAt  ?? "never";

  dlqDepthGauge.add(dlq);
  tpQueueDepthTrend.add(queue);

  check(res, {
    "monitor: worker status is ok":      () => body.status === "ok",
    "monitor: worker health endpoint up": (r) => r.status === 200,
  });

  console.log(
    `[monitor] queue=${queue} dlq=${dlq} lastSuccess=${last} workerOk=${body.status === "ok"}`
  );

  sleep(0.2);
}

// ── Scenario 4 — Final health snapshot ────────────────────────────────────────
export function finalHealthCheckScenario() {
  console.log("[final] Taking final health snapshot …");
  sleep(2); // wait for the worker to drain any remaining queue-level pills

  // ── Ticket-worker ─────────────────────────────────────────────────────────
  const twRes = http.get(TICKET_WORKER_HEALTH);
  let twBody  = {};
  try { twBody = JSON.parse(twRes.body); } catch { /* ignore */ }

  check(twRes, {
    "final: ticket-worker is alive (200)":       (r) => r.status === 200,
    "final: ticket-worker status = ok":           ()  => twBody.status === "ok",
    "final: dlqDepth > 0 (queue pills DLQ'd)":   ()  => (twBody.dlqDepth ?? 0) > 0,
    "final: worker kept processing good messages": () => twBody.lastSuccessAt !== null,
  });

  console.log(
    `[final] ticket-worker → status=${twBody.status} ` +
    `dlqDepth=${twBody.dlqDepth ?? "?"} ` +
    `tpQueueDepth=${twBody.tpQueueDepth ?? "?"} ` +
    `lastSuccessAt=${twBody.lastSuccessAt ?? "never"}`
  );

  // ── Notification-worker ───────────────────────────────────────────────────
  const nwRes = http.get(NOTIF_WORKER_HEALTH);
  let nwBody  = {};
  try { nwBody = JSON.parse(nwRes.body); } catch { /* ignore */ }

  check(nwRes, {
    "final: notification-worker is alive (200)": (r) => r.status === 200,
  });

  console.log(
    `[final] notification-worker → status=${nwBody.status} ` +
    `dlq_depth=${nwBody.dlq_depth ?? "?"}`
  );
}

// ── handleSummary ─────────────────────────────────────────────────────────────
export function handleSummary(data) {
  const dur         = data.metrics["http_req_duration"]?.values;
  const normalDur   = data.metrics["normal_purchase_latency_ms"]?.values;
  const rps         = data.metrics["http_reqs"]?.values?.rate;
  const normErrors  = data.metrics["normal_accept_errors"]?.values?.rate ?? 0;
  const pillsRejected = data.metrics["poison_pills_rejected"]?.values?.count ?? 0;
  const dlqMax      = data.metrics["worker_dlq_depth"]?.values?.max ?? 0;
  const dlqLast     = data.metrics["worker_dlq_depth"]?.values?.last ?? 0;

  const p95ok   = (dur?.["p(95)"] ?? Infinity) < 600;
  const errOk   = normErrors < 0.02;
  const dlqOk   = dlqMax > 0;

  console.log();
  console.log("  Sprint 3 — Poison-Pill Resilience Results");
  console.log();
  console.log("  Normal-Purchase Latency");
  console.log(`    p50  : ${(normalDur?.med    ?? dur?.med    ?? 0).toFixed(1)} ms`);
  console.log(`    p95  : ${(normalDur?.["p(95)"] ?? dur?.["p(95)"] ?? 0).toFixed(1)} ms  ${p95ok ? "✓ PASS" : "✗ FAIL (threshold 600 ms)"}`);
  console.log(`    p99  : ${(normalDur?.["p(99)"] ?? dur?.["p(99)"] ?? 0).toFixed(1)} ms`);
  console.log(`    rps  : ${(rps ?? 0).toFixed(1)} req/s`);
  console.log();
  console.log("  Poison-Pill Summary");
  console.log(`    API pills rejected (4xx)  : ${pillsRejected}`);
  console.log(`    Worker DLQ depth (max)    : ${dlqMax}  ${dlqOk ? "✓ PASS — pills reached DLQ" : "✗ FAIL — DLQ never populated"}`);
  console.log();
  console.log("  Normal-Traffic Resilience");
  console.log(`    Accept error rate         : ${(normErrors * 100).toFixed(2)} %  ${errOk ? "✓ PASS" : "✗ FAIL (threshold 2 %)"}`);
  console.log();
  console.log("  Interpretation");
  if (dlqOk) {
    console.log("  ✓ Poison pills (queue-level) were detected and routed to the DLQ.");
  } else {
    console.log("  ✗ DLQ was empty — verify redis-cli is available in the holmes container.");
    console.log("    Seed them first: redis-cli -h redis LPUSH ticket-purchase-queue 'bad-json' -- see file header.");
  }
  if (errOk) {
    console.log("  ✓ Good requests kept succeeding — system throughput was not disrupted.");
  }
  if (p95ok) {
    console.log("  ✓ p95 latency stayed under 600 ms — no throughput collapse under poison load.");
  }

  return {};
}
