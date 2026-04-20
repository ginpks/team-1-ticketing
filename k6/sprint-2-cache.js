// Sprint 1 — Baseline load test
//
// Run from inside the holmes container:
//   docker compose exec holmes bash
//   k6 run /workspace/k6/sprint-1.js
//
// Or from your host machine if k6 is installed:
//   k6 run k6/sprint-2-cache.js
//
// Replace TARGET_URL with your main read endpoint.

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const errorRate = new Rate("errors");

// ── Configuration ─────────────────────────────────────────────────────────────
// Update this URL to point to your main read endpoint.
// From inside the holmes container, use the service name (not localhost).
const TARGET_URL = "http://event-catalogue:3003/events";

export const options = {
  // force k6 to collect the stats we want for the first sprint
  summaryTrendStats: ["med", "p(90)", "p(95)", "p(99)"],
  stages: [
    { duration: "30s", target: 20 }, // ramp up to 20 VUs
    { duration: "30s", target: 20 }, // sustain
    { duration: "10s", target: 0  }, // ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<500"], // 95% of requests under 500ms,
    errors: ["rate<0.01"],            // less than 1% error rate
  },
};

export default function () {
  const res = http.get(TARGET_URL);

  const ok = check(res, {
    "status is 200": (r) => r.status === 200,
    "response time < 500ms": (r) => r.timings.duration < 500,
  });


  errorRate.add(!ok);
  //sleep(0.5);
}

export function handleSummary(data) {
    const duration_values = data.metrics.http_req_duration?.values;
    const requests_per_second = data.metrics.http_reqs?.values?.rate;

    console.log("SPRINT-1 METRICS:");
    console.log(`p50: ${duration_values["med"]}ms`);
    console.log(`p95: ${duration_values["p(95)"]}ms`);
    console.log(`p99: ${duration_values["p(99)"]}ms`);
    console.log(`Requests/second: ${requests_per_second}`);

    return
}

