# Sprint 2 Report — Team 1

**Sprint:** 2 — Async Pipelines and Caching  
**Tag:** `sprint-2`  
**Submitted:** [date, before 04.21 class]

---

## What We Built

[What cache did you add? What queue and worker are running? What does the async pipeline do?]
- Implemented part one of Analytics worker that subscribes to purchase events published by the ticket-purchase worker and stores related data in the analytic DB.


---

## Individual Contributions

| Team Member | What They Delivered | Key Commits / PR |
|---|---|---|
| Tun Lin |  | [pr for purchase db](https://github.com/ginpks/team-1-ticketing/pull/8), [pr for event db](https://github.com/ginpks/team-1-ticketing/pull/14) |
| Aryan | `/purchase/:id` endpoint, setup express and redis for the purchase service, `PublishPurchaseConfirm` function | [Ticket purchase service starter and status endpoint](https://github.com/ginpks/team-1-ticketing/pull/3), [Reconciliation after merge](https://github.com/ginpks/team-1-ticketing/pull/9), [Incorporate service and db](https://github.com/ginpks/team-1-ticketing/pull/10) |
| Vihaan | Finished `GET /events`, `GET /events/:event_id`, `POST /events` endpoints. Added input validation, correct HTTP responses including error handling and logging | [PR #16](https://github.com/ginpks/team-1-ticketing/pull/16) |
| Mark | k6 baseline script | [PR #17](https://github.com/ginpks/team-1-ticketing/pull/17) |
| Din | Payment Service, Ticket Request Service | [PR #15](https://github.com/ginpks/team-1-ticketing/pull/15) |
| Gin | Analytics worker | [PR #24](https://github.com/ginpks/team-1-ticketing/pull/24) |
| Sidharth | `POST /purchases`, Redis, purchase health check | [PR #12](https://github.com/ginpks/team-1-ticketing/pull/12) |
| Arkar Myint | Built `notification-service` with `POST /notify` endpoint that receives purchase confirmations and logs simulated emails in structured JSON. Implemented `GET /health` endpoint. Added service to `compose.yml` on port 3005. Moved service into `services/` directory. | [PR #21](https://github.com/ginpks/team-1-ticketing/pull/21), [PR #27](https://github.com/ginpks/team-1-ticketing/pull/27) |

---

## What Is Working

- [ ] Redis cache in use — repeated reads do not hit the database
- [ ] Async pipeline works end-to-end (message published → worker consumes → action taken)
- [ ] At least one write path is idempotent (same request twice produces same result)
- [ ] Worker logs show pipeline activity in `docker compose logs`
- [ ] Worker `GET /health` returns queue depth, DLQ depth, and last-job-at

---

## What Is Not Working / Cut

---

## k6 Results

### Test 1: Caching Comparison (`k6/sprint-2-cache.js`)

| Metric | Sprint 1 Baseline | Sprint 2 Cached | Change |
| ------ | ----------------- | --------------- | ------ |
| p50    | | | |
| p95    | | | |
| p99    | | | |
| RPS    | | | |

[Explain the improvement. If the numbers did not improve, explain why and what you did to diagnose it.]

### Test 2: Async Pipeline Burst (`k6/sprint-2-async.js`)

```
[Paste k6 summary output here]
```

Worker health during the burst (hit `/health` while k6 is running):

```json
[Paste an example health response showing non-zero queue depth]
```

Idempotency check: [Describe what you sent and what happened when you sent the same idempotency key twice.]

---

## Blockers and Lessons Learned
