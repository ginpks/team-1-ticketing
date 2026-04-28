# Sprint 3 Report — Team 1

**Sprint:** 3 — Reliability and Poison Pills  
**Tag:** `sprint-3`  
**Submitted:** [4-27-2026]

---

## What We Built

[What failure scenarios does the system now handle? Which queues have DLQ handling? What happens when a poison pill is injected?]

- Implemented boilerplate for part 2 of analytics worker that consumes from placeholder browse events queue and updates relevant data in analytic db along poison pill handling and DLQ depth return in its health check.

- Implemented the Refund Service with an idempotent POST /refunds endpoint. The service validates the purchase exists via a synchronous call to the Ticket Purchase Service, calls the Payment Service to reverse the charge, and pushes to the waitlist queue so the next waitlisted user can be promoted.

- Implemented the foundational database layer for the refund service, including schema design, Docker-based deployment, and data insertion logic.

- Implemented k6 poison pill testing that verifies the system can handle malformed data and requests gracefully without stalling, crashing, or getting clogged.
---

## Individual Contributions

| Team Member | What They Delivered | Key Commits |
| ----------- | ------------------- | ----------- |
| Tun Lin Naine  | waitlist worker | https://github.com/ginpks/team-1-ticketing/pull/39|
| Aryan          | Created refund db and storeRefund logic | [PR #37](https://github.com/ginpks/team-1-ticketing/pull/37) |
| Vihaan Sejwani | Added seat availability checking route in `event-catalogue` service, modified the post purchase route in `ticket-purchase` service to use it, subscribed `event-catalogue ` service to `purchases:confirmed` and `seat:released` queues from redis to update seat status in the database accordingly.                                                                                                        | [PR #43](https://github.com/ginpks/team-1-ticketing/pull/43)                                                                                                                                                                                                                |
| Mark Gallant   | Implemented poison pill k6 test and helper scripts to send bad data to the redis queue | [PR #44](https://github.com/ginpks/team-1-ticketing/pull/44)                                                                                                                                                                                                                                   | [PR #17](https://github.com/ginpks/team-1-ticketing/pull/17)                                                                                                                                                                                                                |
| Din            | Fraud DB, Fraud Detection Worker                                                                                                                                                                                                                                  | [PR #40](https://github.com/ginpks/team-1-ticketing/pull/40)                                                                                                                                                                                                                |
| Gin Park       | Analytics Worker part two boilerplate with poison pill handling | https://github.com/ginpks/team-1-ticketing/pull/41 |
| Sidharth Jain | Added DLQ handling to notification worker — malformed JSON and failed notification calls are pushed to `purchases:confirmed:dlq` with reason and timestamp. Updated `/health` to show live `dlq_depth` from Redis. Added Caddy load balancer in front of `ticket-purchase` with round-robin across 3 replicas. Removed static port and container_name to support `--scale`. | [PR #23](https://github.com/ginpks/team-1-ticketing/pull/23), [PR — task/caddy-load-balancer] |
| Arkar Myint | Built `services/refund-service/` — `POST /refunds` idempotent endpoint that validates purchase exists via sync call to ticket-purchase, calls payment service to reverse charge, and pushes to waitlist-queue on success. `GET /health` checks Postgres and Redis. | [PR #38](https://github.com/ginpks/team-1-ticketing/pull/38) |

---

---

## What Is Working

- [x] Poison pill handling: malformed messages go to DLQ, worker keeps running
- [x] Worker `GET /health` shows non-zero `dlq_depth` after poison pills are injected
- [x] Worker status remains `healthy` while DLQ fills
- [x] System handles failure scenarios gracefully (no dangling state, no crash loops)
- [x] k6 poison pill test
- [] All services/workers required for team size are implemented

---

## What Is Not Working / Cut

- [x] All services/workers required for team size are implemented
- [ ] Have to finish implementing minor features to connect between the containers such as event-catalogue pushing to analytics browse. 

---

## Poison Pill Demonstration

How to inject a poison pill:

```bash
# From inside holmes:
docker compose exec holmes bash

# Run the helper script to send bad data to the queue
./k6/poison-seed.sh

# Run the k6 test
# Note: the above helper script can be run while the k6 test is running to see the DLQ update in real time
k6 run /k6/sprint-3-poison.js
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
Worker status remains `healthy` throughout — poison pills are routed to DLQ and good messages continue flowing.
---

### Verify DLQ contents in Redis

```bash
redis-cli -h redis LRANGE purchases:confirmed:dlq 0 -1
```


### Caddy Load Balancer

Start with 3 replicas:

```bash
docker compose up --build --scale ticket-purchase=3
```

Verify round-robin distribution:

```bash
docker compose exec holmes bash
for i in $(seq 1 9); do curl -s http://caddy/health | jq -r '.service'; done
```

All requests flow through Caddy on port 8080. Each replica handles roughly equal traffic.


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
