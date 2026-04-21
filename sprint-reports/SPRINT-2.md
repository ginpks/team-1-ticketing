# Sprint 2 Report — Team 1

**Sprint:** 2 — Async Pipelines and Caching  
**Tag:** `sprint-2`  
**Submitted:** [date, before 04.21 class]

---

## What We Built

[What cache did you add? What queue and worker are running? What does the async pipeline do?]

- Implemented part one of Analytics worker that subscribes to purchase events published by the ticket-purchase worker and stores related data in the analytic DB.

- Implemented a Dead Letter Queue (DLQ) for the ticket purchase worker, which stores jobs that cannot be processed due to issues like invalid payloads, database failures, pub/sub failures, or unexpected runtime errors, ensuring no jobs are silently lost.

- Added a health endpoint for the ticket purchase worker that reports system status, including queue depths (main queue and DLQ) and the timestamp of the last successfully processed job, enabling monitoring and quick detection of failures or backlogs.


---

## Individual Contributions

| Team Member | What They Delivered | Key Commits |
| ----------- | ------------------- | ----------- |
| Tun Lin Naine | analytic db and waitlist worker | https://github.com/ginpks/team-1-ticketing/pull/20, https://github.com/ginpks/team-1-ticketing/pull/28|
| Arkar Myint | Built `notification-service` — `POST /notify` logs simulated confirmation emails, `GET /health` returns service status. Added to `compose.yml` on port 3005. | [PR #21](https://github.com/ginpks/team-1-ticketing/pull/21), [PR #27](https://github.com/ginpks/team-1-ticketing/pull/27) |
| Aryan          | Added `GET \health` endpoint for ticket purchase worker, moved ticket purchase worker to the workers folder and created/updated related Dockerfile and package.json | [PR #22](https://github.com/ginpks/team-1-ticketing/pull/22) |
| Gin Park| Analytics worker | https://github.com/ginpks/team-1-ticketing/pull/24 |
| [Name]      | | |

---
## What Is Working

- [x] Redis cache in use — repeated reads do not hit the database
- [ ] Async pipeline works end-to-end (message published → worker consumes → action taken)
- [ ] At least one write path is idempotent (same request twice produces same result)
- [ ] Worker logs show pipeline activity in `docker compose logs`
- [x] Worker `GET /health` returns queue depth, DLQ depth, and last-job-at

---

## What Is Not Working / Cut

---

## k6 Results

### Test 1: Caching Comparison (`k6/sprint-2-cache.js`)

| Metric | Sprint 1 Baseline | Sprint 2 Cached | Change |
| ------ | ----------------- | --------------- | ------ |
| p50    |                   |                 |        |
| p95    |                   |                 |        |
| p99    |                   |                 |        |
| RPS    |                   |                 |        |

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
