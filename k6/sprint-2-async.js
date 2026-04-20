// Sprint 2 — Async Pipeline Throughput Test
//
// Tests the ticket-purchase → Redis queue → ticket-worker pipeline.
//
// Run from inside the holmes container:
//   docker compose exec holmes bash
//   k6 run /workspace/k6/sprint-2-async.js

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

// ── Service URLs ───────────────
const PURCHASE_URL  = "http://ticket-purchase:3001/purchases";
const WORKER_HEALTH = "http://ticket-worker:4000/health";    // tpQueueDepth lives here

// ── Custom metrics ────────────────────────────────────────────────────────────
const duplicateCount      = new Counter("duplicate_purchases");   // must stay 0
const acceptErrors        = new Rate("accept_errors");            // 202 failures
const queueDepthTrend     = new Trend("worker_queue_depth");      // sampled during burst
const dlqDepthTrend       = new Trend("worker_dlq_depth");        // dead-letter queue

// ── Shared idempotency key — used by the idempotency scenario ─────────────────
const SHARED_IDEM_KEY = "idem-test-shared-key-do-not-change";

// ── Helper: build a unique purchase payload ───────────────────────────────────
function makePurchase(idempotencyKey) {
  return JSON.stringify({
    idempotency_key: idempotencyKey,
    event:           "A Good Show",
    seat:            `A${Math.floor(Math.random() * 200) + 1}`,
    start_time:      "2025-09-01T19:00:00Z",
    end_time:        "2025-09-01T22:00:00Z",
    amount:          (Math.random() * 90 + 10).toFixed(2),
  });
}

// ── Scenario definitions ──────────────────────────────────────────────────────
export const options = {
  // Include avg/max so custom Trend metrics (worker_queue_depth, worker_dlq_depth)
  // have those keys populated in handleSummary's data.metrics object.
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],

  scenarios: {
    burst_purchases: {
      executor:            "ramping-arrival-rate",
      startRate:           0,
      timeUnit:            "1s",
      preAllocatedVUs:     250,
      maxVUs:              250,
      stages: [
        { duration: "2s",  target: 200 },  // ramp to 50 req/s
        { duration: "6s",  target: 200 },  // hold - delivers ~250 requests total
        { duration: "2s",  target: 0  },  // ramp down
      ],
      startTime:   "0s",
      exec:        "burstScenario",
    },

    queue_monitor: {
      executor:    "constant-vus",
      vus:         1,
      duration:    "30s",   // covers burst (~6 s) + full drain window
      startTime:   "0s",
      exec:        "monitorScenario",
    },

    idempotency_check: {
      executor:    "per-vu-iterations",
      vus:         2,
      iterations:  1,
      maxDuration: "15s",
      startTime:   "5s",   // slight delay so services are warm
      exec:        "idempotencyScenario",
    },
  },

  thresholds: {
    // The API must acknowledge ≥ 95 % of burst requests within 500 ms
    "http_req_duration{scenario:burst_purchases}": ["p(95)<500"],

    // No burst request should be rejected
    accept_errors: ["rate<0.01"],

    // No duplicate rows may be created
    duplicate_purchases: ["count==0"],
  },
};

// ── Scenario 1 — Burst ────────────────────────────────────────────────────────
export function burstScenario() {
  const key = `burst-${__VU}-${__ITER}-${Date.now()}`;
  const res = http.post(
    PURCHASE_URL,
    makePurchase(key),
    { headers: { "Content-Type": "application/json" }, tags: { scenario: "burst_purchases" } }
  );

  const accepted = check(res, {
    "burst: status is 202": (r) => r.status === 202,
    "burst: body has purchase.id": (r) => {
      try { return JSON.parse(r.body).purchase?.id > 0; } catch { return false; }
    },
    "burst: duplicate flag is false": (r) => {
      try { return JSON.parse(r.body).duplicate === false; } catch { return false; }
    },
  });

  acceptErrors.add(!accepted);
}

// ── Scenario 2 — Queue depth monitor ─────────────────────────────────────────
export function monitorScenario() {
  const res = http.get(WORKER_HEALTH);

  if (res.status === 200) {
    let body;
    try { body = JSON.parse(res.body); } catch { sleep(1); return; }

    queueDepthTrend.add(body.tpQueueDepth ?? 0);
    dlqDepthTrend.add(body.dlqDepth ?? 0);

    // Log a one-liner so draining can be seen in real time in the k6 output
    console.log(
      `[monitor] queue=${body.tpQueueDepth ?? "?"} ` +
      `dlq=${body.dlqDepth ?? "?"} ` +
      `lastSuccess=${body.lastSuccessAt ?? "never"}`
    );
  } else {
    console.error(`[monitor] worker /health returned ${res.status}`);
  }

  sleep(0.1);
}

// ── Scenario 3 — Idempotency ──────────────────────────────────────────────────
export function idempotencyScenario() {
  // Both VUs use the exact same key - only one should create a purchase row.
  const res = http.post(
    PURCHASE_URL,
    makePurchase(SHARED_IDEM_KEY),
    { headers: { "Content-Type": "application/json" }, tags: { scenario: "idempotency_check" } }
  );

  // Both calls must succeed at the HTTP level
  check(res, {
    "idem: status 200 or 202": (r) => r.status === 200 || r.status === 202,
  });

  let body;
  try { body = JSON.parse(res.body); } catch { return; }

  // The second (duplicate) call must come back with duplicate: true
  if (body.duplicate === true) {
    check(res, {
      "idem: duplicate response has existing purchase id": () =>
        body.purchase?.id > 0,
    });
  } else {
    duplicateCount.add(
      __VU === 1 ? 0 : 1
    );
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
export function handleSummary(data) {
  const dur    = data.metrics.http_req_duration?.values;
  const rps    = data.metrics.http_reqs?.values?.rate;
  const qDepth = data.metrics.worker_queue_depth?.values;
  const dlq    = data.metrics.worker_dlq_depth?.values;
  const dups   = data.metrics.duplicate_purchases?.values?.count ?? 0;
  const errors = data.metrics.accept_errors?.values?.rate ?? 0;

  console.log();
  console.log(`  Acceptance latency (burst 50 requests)  ║`);
  console.log(`    p50  : ${String(dur?.med?.toFixed(1) ?? "n/a").padEnd(8)} ms                  ║`);
  console.log(`    p95  : ${String(dur?.["p(95)"]?.toFixed(1) ?? "n/a").padEnd(8)} ms                  ║`);
  console.log(`    p99  : ${String(dur?.["p(99)"]?.toFixed(1) ?? "n/a").padEnd(8)} ms                  ║`);
  console.log(`    rps  : ${String(rps?.toFixed(1) ?? "n/a").padEnd(8)} req/s               ║`);
  console.log();
  console.log(`  Worker queue depth (sampled every 100 ms)  ║`);
  console.log(`    max  : ${String(qDepth?.max ?? "n/a").padEnd(8)}                       ║`);
  console.log(`    avg  : ${String(qDepth?.avg?.toFixed(1) ?? "n/a").padEnd(8)}                       ║`);
  console.log(`  DLQ depth max : ${String(dlq?.max ?? "n/a").padEnd(8)}                  ║`);
  console.log();
  console.log(`  Idempotency duplicate rows created: ${String(dups).padEnd(4)}║`);
  console.log(`  Burst accept error rate : ${String((errors * 100).toFixed(2) + "%").padEnd(7)}         ║`);

  return {};
}
