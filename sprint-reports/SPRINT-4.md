# Sprint 4 Report — Team 1

**Sprint:** 4 — Replication, Scaling, and Polish  
**Tag:** `sprint-4`  
**Submitted:** [5-06-2026]

---

## What We Built

- The event-catalogue, ticket-purchase, and payment services were replicated using `--scale`, running 3 instances each behind Caddy's round-robin load balancer.
- Added Sprint 4 k6 tests for scaling comparison and replica failure resilience, validating that the system handles replica failure with zero dropped requests.
- Ran and validated both k6 tests with 3 replicas running behind Caddy.
- Built a full-stack internal dashboard frontend (port 8000) — a six-panel SPA covering System Health, Events, Purchase pipeline, Refund, Analytics, and Fraud Detection. The frontend runs as its own Docker service with an Express proxy server that forwards API calls to internal Docker hostnames, avoiding CORS entirely.
---

## Individual Contributions

| Team Member | What They Delivered | Key Commits |
| ----------- | ------------------- | ----------- |
| Tun Lin Naine  | waitlist dlq endpoint | https://github.com/ginpks/team-1-ticketing/pull/51/changes, https://github.com/ginpks/team-1-ticketing/pull/53|
| Aryan          | Refactor code base | [PR #46](https://github.com/ginpks/team-1-ticketing/pull/46), [PR #47](https://github.com/ginpks/team-1-ticketing/pull/47), [PR #55](https://github.com/ginpks/team-1-ticketing/pull/55), [PR #56](https://github.com/ginpks/team-1-ticketing/pull/56), [PR #57](https://github.com/ginpks/team-1-ticketing/pull/57) |
| Vihaan Sejwani | Implemented Event Catalog pushing analytics for the analytics worker. Fixed analytics worker to consume correctly from Event Catalog and from the purchase:confirmed pub sub. Implemented correct peak hour calculation.                                                                                                         | [PR #54](https://github.com/ginpks/team-1-ticketing/pull/54)                                                                                                                                                                                                                |
| Mark Gallant   | Reviewed PRs and helped finalize project. Contributed to demo day script / cheat sheet in the k6 and poison pill sections. |   n/a                                                                                                                                                                                                                               | [PR #17](https://github.com/ginpks/team-1-ticketing/pull/17)                                                                                                                                                                                                                |
| Din            | Helped fix issues regarding workers. Cheat sheet contribution.                                                                                                                                                                                                                                   | n/a                                                                                                                                                                                                                |
| Gin Park       | Service replication | https://github.com/ginpks/team-1-ticketing/pull/47 |
| Sidharth Jain | Wrote `Caddyfile` — reverse proxy with round-robin DNS load balancing across `ticket-purchase` replicas using Caddy's `dynamic a` resolver. Updated `compose.yml` to remove the static port and `container_name` from `ticket-purchase` so it supports `--scale`, and added the `frontend` service. Built the internal dashboard (`frontend/`) — a six-panel SPA (System Health, Events, Purchase, Refund, Analytics, Fraud) served on port 8000. Express proxy server forwards all API calls to internal Docker hostnames so the browser never hits backends directly. Includes real-time pipeline tracing for async purchases and 5-second auto-polling for analytics and fraud metrics. | dev branch |
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
| ---- | ----- |:80 {
    handle /events* {
        reverse_proxy {
            dynamic a event-catalogue 3003 {
                refresh 5s
                resolvers 127.0.0.11
                versions ipv4
            }
            lb_policy round_robin
        }
    }

    handle /pay {
        reverse_proxy {
            dynamic a payment-service 3000 {
                refresh 5s
                resolvers 127.0.0.11
                versions ipv4
            }
            lb_policy round_robin
        }
    }

    handle /payment* {
        reverse_proxy {
            dynamic a payment-service 3000 {
                refresh 5s
                resolvers 127.0.0.11
                versions ipv4
            }
            lb_policy round_robin
        }
    }

    handle {
        reverse_proxy {
            dynamic a ticket-purchase 3001 {
                refresh 5s
                resolvers 127.0.0.11
                versions ipv4
            }
            lb_policy round_robin
        }
    }
}
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

Sidharth J: Building the frontend exposed a subtle issue with Caddy path forwarding — because `handle /events*` passes the full path to the upstream service, a health check routed through `caddy:80/events/health` would arrive at event-catalogue as `/events/health` instead of `/health`, causing a 404. The fix was to call each service's `/health` endpoint directly by Docker hostname rather than routing through Caddy. The same proxy-as-API-gateway pattern also meant the browser never needed CORS headers since all requests stay on `localhost:8000`.
