# Sprint 4 Report — Team 1

**Sprint:** 4 — Replication, Scaling, and Polish  
**Tag:** `sprint-4`  
**Submitted:** [date, before 05.05 class]

---

## What We Built

[Which services are replicated? How does load balancing work? What polish work was completed?]
- The event catalogue, ticket-purhcase, and payment services were replicated.
- Docker creates multiple containers for each scalable service. The service name resolves to multiple container IPs. Caddy refreshes that list every 5 seconds and sends requests across those replicas using round-robin.
---

## Individual Contributions

| Team Member | What They Delivered | Key Commits |
| ----------- | ------------------- | ----------- |
| Tun Lin Naine  | waitlist worker | https://github.com/ginpks/team-1-ticketing/pull/39|
| Aryan          | Created refund db and storeRefund logic | [PR #37](https://github.com/ginpks/team-1-ticketing/pull/37) |
| Vihaan Sejwani | Added seat availability checking route in `event-catalogue` service, modified the post purchase route in `ticket-purchase` service to use it, subscribed `event-catalogue ` service to `purchases:confirmed` and `seat:released` queues from redis to update seat status in the database accordingly.                                                                                                        | [PR #43](https://github.com/ginpks/team-1-ticketing/pull/43)                                                                                                                                                                                                                |
| Mark Gallant   | Implemented poison pill k6 test and helper scripts to send bad data to the redis queue | [PR #44](https://github.com/ginpks/team-1-ticketing/pull/44)                                                                                                                                                                                                                                   | [PR #17](https://github.com/ginpks/team-1-ticketing/pull/17)                                                                                                                                                                                                                |
| Din            | Fraud DB, Fraud Detection Worker                                                                                                                                                                                                                                  | [PR #40](https://github.com/ginpks/team-1-ticketing/pull/40)                                                                                                                                                                                                                |
| Gin Park       | Service replication | https://github.com/ginpks/team-1-ticketing/pull/47 |
| Sidharth Jain | Added DLQ handling to notification worker — malformed JSON and failed notification calls are pushed to `purchases:confirmed:dlq` with reason and timestamp. Updated `/health` to show live `dlq_depth` from Redis. Added Caddy load balancer in front of `ticket-purchase` with round-robin across 3 replicas. Removed static port and container_name to support `--scale`. | [PR #23](https://github.com/ginpks/team-1-ticketing/pull/23), [PR — task/caddy-load-balancer] |
| Arkar Myint | Built `services/refund-service/` — `POST /refunds` idempotent endpoint that validates purchase exists via sync call to ticket-purchase, calls payment service to reverse charge, and pushes to waitlist-queue on success. `GET /health` checks Postgres and Redis. | [PR #38](https://github.com/ginpks/team-1-ticketing/pull/38) |

---

## Starting the System with Replicas

```bash
docker compose up --scale payment-service=3 --scale ticket-purchase=3 --scale event-catalogue=3 --build
```

After startup:

```
team-1-ticketing-ticket-purchase-1   team-1-ticketing-ticket-purchase   "docker-entrypoint.s…"   ticket-purchase   54 seconds ago   Up 34 seconds (healthy)   3000/tcp
team-1-ticketing-ticket-purchase-2   team-1-ticketing-ticket-purchase   "docker-entrypoint.s…"   ticket-purchase   54 seconds ago   Up 35 seconds (healthy)   3000/tcp
team-1-ticketing-ticket-purchase-3   team-1-ticketing-ticket-purchase   "docker-entrypoint.s…"   ticket-purchase   54 seconds ago   Up 34 seconds (healthy)   3000/tcp`


```

---

## What Is Working

- [x] At least [N] services replicated via `--scale`
- [x] Load balancer distributes traffic across replicas (visible in logs)
- [x] Services are stateless — multiple instances run without conflicts
- [x] `docker compose ps` shows all replicas as `(healthy)`
- [x] System is fully complete for team size

---

## What Is Not Working / Cut

---

## k6 Results

### Test 1: Scaling Comparison (`k6/sprint-4-scale.js`)

| Metric | 1 replica | 3 replicas | Change |
| ------ | --------- | ---------- | ------ |
| p50    | | | |
| p95    | | | |
| p99    | | | |
| RPS    | | | |

[Explain the improvement. Which replica count started to show diminishing returns?]

### Test 2: Replica Failure (`k6/sprint-4-replica.js`)

Timeline:

| Time | Event |
| ---- | ----- |
| 0s   | k6 started, 3 replicas running |
| [t]s | Killed replica: `docker stop [container-id]` |
| [t]s | Surviving replicas absorbed traffic |
| [t]s | Replica restarted: `docker compose up -d` |
| [t]s | Traffic redistributed, back to normal |

```
[Paste k6 output showing before / during / after the failure — annotate with timestamps]
```

During failure — `docker compose ps`:

```
[Paste output showing stopped/unhealthy replica alongside healthy survivors]
```

After restart — `docker compose ps`:

```
[Paste output showing all replicas back to (healthy)]
```

---

## Blockers and Lessons Learned
