# Sprint 3 Report — Team 1

**Sprint:** 3 — Reliability and Poison Pills  
**Tag:** `sprint-3`  
**Submitted:** [date, before 04.28 class]

---

## What We Built

[What failure scenarios does the system now handle? Which queues have DLQ handling? What happens when a poison pill is injected?]

- Implemented boilerplate for part 2 of analytics worker that consumes from placeholder browse events queue and updates relevant data in analytic db along poison pill handling and DLQ depth return in its health check.

- Implemented the Refund Service with an idempotent POST /refunds endpoint. The service validates the purchase exists via a synchronous call to the Ticket Purchase Service, calls the Payment Service to reverse the charge, and pushes to the waitlist queue so the next waitlisted user can be promoted.

---

## Individual Contributions

| Team Member | What They Delivered | Key Commits |
| ----------- | ------------------- | ----------- |
| Tun Lin Naine  | analytic db and waitlist worker | https://github.com/ginpks/team-1-ticketing/pull/20, https://github.com/ginpks/team-1-ticketing/pull/28|
| Aryan          | Added `GET \health` endpoint for ticket purchase worker, moved ticket purchase worker to the workers folder and created/updated related Dockerfile and package.json | [PR #22](https://github.com/ginpks/team-1-ticketing/pull/22) |
| Vihaan Sejwani | Added caching to Event Catalog service, the cache interacts with `GET /events`, `GET /events/:event_id`, `POST /events` endpoints. Created Architecture diagram.                                                                                                        | [PR #25](https://github.com/ginpks/team-1-ticketing/pull/25)                                                                                                                                                                                                                |
| Mark Gallant   | Modified k6 script from sprint-1 to better stress the system and provide better analytics. Implemented async test script to hit the async pipeline and provide sprint metrics. Contributed to Sprint-2 report with metric analysis based on test results.               | [PR #30](https://github.com/ginpks/team-1-ticketing/pull/30), [PR #31](https://github.com/ginpks/team-1-ticketing/pull/31)                                                                                                                                                                                                                                       | [PR #17](https://github.com/ginpks/team-1-ticketing/pull/17)                                                                                                                                                                                                                |
| Din            | Payment Service, Ticket Request Service                                                                                                                                                                                                                                 | [PR #15](https://github.com/ginpks/team-1-ticketing/pull/15)                                                                                                                                                                                                                |
| Gin Park       | Analytics Worker part two boilerplate with poison pill handling | https://github.com/ginpks/team-1-ticketing/pull/41 |
| Sidharth       | Notification worker                                                                                                                                                                                                                         | [PR #23](https://github.com/ginpks/team-1-ticketing/pull/23)                                                                                                                                                                                                                |
| Arkar Myint | Built `services/refund-service/` — `POST /refunds` idempotent endpoint that validates purchase exists via sync call to ticket-purchase, calls payment service to reverse charge, and pushes to waitlist-queue on success. `GET /health` checks Postgres and Redis. | [PR #38](https://github.com/ginpks/team-1-ticketing/pull/38) |

---

---

## What Is Working

- [ ] Poison pill handling: malformed messages go to DLQ, worker keeps running
- [ ] Worker `GET /health` shows non-zero `dlq_depth` after poison pills are injected
- [ ] Worker status remains `healthy` while DLQ fills
- [ ] System handles failure scenarios gracefully (no dangling state, no crash loops)
- [ ] All services/workers required for team size are implemented

---

## What Is Not Working / Cut

- [x] All services/workers required for team size are implemented

---

## Poison Pill Demonstration

How to inject a poison pill:

```bash
# From inside holmes:
docker compose exec holmes bash

# Example — publish a malformed message directly to the queue:
redis-cli -h redis RPUSH your-queue '{"this": "is malformed"}'
```

Worker health before injection:

```json
{
  "status": "healthy",
  "queue_depth": 0,
  "dlq_depth": 0,
  "last_job_at": "2025-04-24T..."
}
```

Worker health after injection:

```json
{
  "status": "healthy",
  "queue_depth": 0,
  "dlq_depth": 3,
  "last_job_at": "2025-04-24T..."
}
```

---

## k6 Results: Poison Pill Resilience (`k6/sprint-3-poison.js`)

```
[Paste k6 summary output here]
```

| Metric | Normal-only run | Mixed with poison pills | Change |
| ------ | --------------- | ----------------------- | ------ |
| p95    | | | |
| RPS    | | | |
| Error rate | | | |

[Explain: did throughput hold? Did the worker stay healthy throughout?]

---

## Blockers and Lessons Learned

Arkar M: Learned how to connect multiple services together in the right order and the importance of idempotency on write paths that involve money.
