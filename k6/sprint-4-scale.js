// Sprint 4 — Scaling Comparison Test
// Run from inside Holmes:
//   Single instance:   k6 run /workspace/k6/sprint-4-scale.js
//   With replicas:     k6 run /workspace/k6/sprint-4-scale.js

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const errorRate = new Rate("errors");
const BASE_URL = "http://caddy:80";

export const options = {
  summaryTrendStats: ["med", "p(90)", "p(95)", "p(99)"],
  stages: [
    { duration: "30s", target: 20 },  // ramp up
    { duration: "60s", target: 50 },  // push harder to show scaling benefit
    { duration: "10s", target: 0 },   // ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<500"],
    errors: ["rate<0.01"],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/events`);

  const ok = check(res, {
    "status is 200": (r) => r.status === 200,
    "response time < 500ms": (r) => r.timings.duration < 500,
  });

  errorRate.add(!ok);
  sleep(0.5);
}

export function handleSummary(data) {
  const dur = data.metrics.http_req_duration?.values;
  const rps = data.metrics.http_reqs?.values?.rate;
  const errors = data.metrics.errors?.values?.rate ?? 0;

  console.log("SPRINT-4 SCALING TEST:");
  console.log(`p50: ${dur?.med?.toFixed(2)}ms`);
  console.log(`p95: ${dur?.["p(95)"]?.toFixed(2)}ms`);
  console.log(`p99: ${dur?.["p(99)"]?.toFixed(2)}ms`);
  console.log(`RPS: ${rps?.toFixed(1)}`);
  console.log(`Error rate: ${(errors * 100).toFixed(2)}%`);

  return {};
}