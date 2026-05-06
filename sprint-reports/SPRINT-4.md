# Sprint 4 Report — Team 1

**Sprint:** 4 — Replication, Scaling, and Polish  
**Tag:** `sprint-4`  
**Submitted:** [date, before 05.05 class]

---

## What We Built

[Which services are replicated? How does load balancing work? What polish work was completed?]
- The event catalogue, ticket-purhcase, and payment services were replicated.
- Added Sprint 4 k6 tests for scaling comparison and replica failure resilience, validating that the system handles replica failure with zero dropped requests.
- Ran and validated both k6 tests with 3 replicas running behind Caddy.
---

## Individual Contributions

| Team Member | What They Delivered | Key Commits |
| ----------- | ------------------- | ----------- |
| Tun Lin Naine  | waitlist worker | https://github.com/ginpks/team-1-ticketing/pull/39|
| Aryan          | Refactor code base | [PR #46](https://github.com/ginpks/team-1-ticketing/pull/46), [PR #47](https://github.com/ginpks/team-1-ticketing/pull/47), [PR #55](https://github.com/ginpks/team-1-ticketing/pull/55) |
| Vihaan Sejwani | Implemented Event Catalog pushing analytics for the analytics worker. Fixed analytics worker to consume correctly from Event Catalog and from the purchase:confirmed pub sub. Implemented correct peak hour calculation.                                                                                                         | [PR #54](https://github.com/ginpks/team-1-ticketing/pull/54)                                                                                                                                                                                                                |
| Mark Gallant   | Implemented poison pill k6 test and helper scripts to send bad data to the redis queue | [PR #44](https://github.com/ginpks/team-1-ticketing/pull/44)                                                                                                                                                                                                                                   | [PR #17](https://github.com/ginpks/team-1-ticketing/pull/17)                                                                                                                                                                                                                |
| Din            | Fraud DB, Fraud Detection Worker                                                                                                                                                                                                                                  | [PR #40](https://github.com/ginpks/team-1-ticketing/pull/40)                                                                                                                                                                                                                |
| Gin Park       | Service replication | https://github.com/ginpks/team-1-ticketing/pull/47 |
| Sidharth Jain | Added DLQ handling to notification worker — malformed JSON and failed notification calls are pushed to `purchases:confirmed:dlq` with reason and timestamp. Updated `/health` to show live `dlq_depth` from Redis. Added Caddy load balancer in front of `ticket-purchase` with round-robin across 3 replicas. Removed static port and container_name to support `--scale`. | [PR #23](https://github.com/ginpks/team-1-ticketing/pull/23), [PR — task/caddy-load-balancer] |
| Arkar Myint | Built `k6/sprint-4-scale.js` and `k6/sprint-4-replica.js`, scaling comparison test and replica failure test hitting GET /events through Caddy. Ran and validated both tests with 3 replicas. | [PR #52](https://github.com/ginpks/team-1-ticketing/pull/52) |

---

## Starting the System with Replicas

```bash
docker compose up --build --scale ticket-purchase=3
```

After startup:

```
NAME                                      SERVICE           STATUS          PORTS
caddy                                     caddy             Up              0.0.0.0:8080->80/tcp
team-1-ticketing-ticket-purchase-1        ticket-purchase   Up (healthy)    3000/tcp
team-1-ticketing-ticket-purchase-2        ticket-purchase   Up (healthy)    3000/tcp
team-1-ticketing-ticket-purchase-3        ticket-purchase   Up (healthy)    3000/tcp
```

---

## What Is Working

- [x] `ticket-purchase` replicated via `--scale` to 3 instances
- [x] Caddy distributes traffic across replicas with round-robin
- [x] Services are stateless — multiple instances run without conflicts
- [x] `docker compose ps` shows all replicas as `(healthy)`
- [x] System is fully complete — all services and workers running
- [x] Zero failed requests during replica failure test

---

## What Is Not Working / Cut

- Caddy healthcheck shows `(unhealthy)` in `docker compose ps` due to a misconfigured healthcheck test, but Caddy is actually routing traffic correctly — verified by hitting `http://caddy:80/events` from Holmes and receiving correct responses.
---

## k6 Results

### Test 1: Scaling Comparison (`k6/sprint-4-scale.js`)

| Metric | 1 replica | 3 replicas | Change |
| ------ | --------- | ---------- | ------ |
| p50    | 1.42ms    | 1.36ms     | -4%    |
| p95    | 5.41ms    | 5.71ms     | +5%    |
| p99    | 7.85ms    | 7.82ms     | ~same  |
| RPS    | 52.3      | 52.3       | ~same  |
| Error rate | 0%   | 0%         | ✓ PASS |

The improvement from single to 3 replicas was modest at this load level. p50 dropped slightly and p99 was nearly identical. This suggests the bottleneck is not the ticket-purchase service itself but the shared database and Redis underneath. Under higher concurrent load the benefit of replication would become more pronounced. The key result is that the system handled the same load correctly across all 3 replicas with zero errors throughout.

### Test 2: Replica Failure (`k6/sprint-4-replica.js`)

Timeline:

| Time | Event |
| ---- | ----- |
| 0s   | k6 started, 3 replicas running |
| ~40s | Killed replica: `docker stop team-1-ticketing-ticket-purchase-2` |
| ~40s | Surviving replicas (1 and 3) absorbed all traffic |
| ~70s | Replica restarted: `docker compose up --scale ticket-purchase=3 -d` |
| ~75s | All 3 replicas healthy again, traffic redistributed |

```
INFO[0190] SPRINT-4 REPLICA FAILURE TEST:
INFO[0190] p50: 1.91ms
INFO[0190] p95: 6.97ms
INFO[0190] p99: 9.30ms
INFO[0190] RPS: 35.6
INFO[0190] Error rate: 0.00%   ✓ PASS
```

During failure — `docker compose ps`:

```
team-1-ticketing-ticket-purchase-1   Up (healthy)   3000/tcp
team-1-ticketing-ticket-purchase-2   Exited
team-1-ticketing-ticket-purchase-3   Up (healthy)   3000/tcp
```

After restart — `docker compose ps`:

```
team-1-ticketing-ticket-purchase-1   Up (healthy)   3000/tcp
team-1-ticketing-ticket-purchase-2   Up (healthy)   3000/tcp
team-1-ticketing-ticket-purchase-3   Up (healthy)   3000/tcp

Zero failed requests throughout the entire test including during the replica failure window. Caddy automatically stopped routing to the stopped replica and redistributed traffic to the remaining two. When the replica restarted, traffic redistributed back to all three.
```
---

## Blockers and Lessons Learned

Arkar M: Doing the replica failure test showed me what replication actually means in practice. It is not just about running more copies, it is about making sure the load balancer detects failures and reroutes traffic automatically. Seeing zero errors while a replica was stopped was the proof. 
