# Sprint 3 Plan — Team 1

**Sprint:** 3 — Reliability and Poison Pills  
**Dates:** 04.21 → 04.28  
**Written:** 04.21 in class

---

## Goal

[What reliability improvements and poison pill handling will your team add? Which queues get DLQ handling?]

All of our queues currently have poison pill handling. Our goal is to implement/polish all remaining services and workers.

---

## Ownership

| Team Member    | Files / Directories Owned This Sprint |
| -------------- | ------------------------------------- |
| Arkar Myint    | `services/notification-service/`      |
| Vihaan Sejwani | `services/event-catalog/`, `services/ticket-purchase/`             |
| Aryan Vakil    | `workers/ticket-worker/`              |
| Tun Lin Naine  | `workers/waitlist-worker`             |
| Din Masic      | `services/ticket-purchase/`           |
| Gin Park       | `workers/analytics-worker/`           |
| Mark Gallant   | `k6/`           |
| Sidharth Jain      | `services/notification-worker`           |

---

## Tasks

### Arkar Myint

- [x] Build `notification-service` with `POST /notify` endpoint
- [x] Implement `GET /health` endpoint
- [x] Add service to `compose.yml` with healthcheck on port 3005
- [x] Move service into `services/` directory

### Vihaan Sejwani

- [x] Implement statistic tracking in `event-catalog` service pushing to the `analytic-browse` queue
- [x] Implement `ticket-purchase` service checking `event-catalog` for seat availability

### Aryan Vakil
- [x] Add `GET \health` for ticket purchase worker
- [x] Integrate dlq for ticket purchase worker

### Tun Lin Naine

- [x] Implement a database for analytic service
- [x] implement a waitlist worker that handle waitlist for different events

### Din Masic

- [x] Made event ticket and purchase async
- [x] Implemented worker for that said async pipeline

### Gin Park

- [x] Implement part two of analytics worker that consumes from browse event queue and stores/updates related data in analytic db
      
### Sidharth Jain

- [x] Build the Notification Worker that subscribes to purchases:confirmed pub/sub
- [x] Call the Notification Service via POST /notify on each confirmed purchase
- [x] Add `/health` for notification worker

### Mark Gallant

- [x] Modify k6 script from sprint-1 to better stress the system and provide better analytics
- [x] Implement async test script to hit the async pipeline and provide sprint metrics

---

## Risks
- Merge conflicts could arise if mutliple members share a single service implemnentation. Careful planning and a structured git workflow is imperative.
---

## Definition of Done

After injecting poison pills, the worker's `/health` shows non-zero `dlq_depth` while status remains `healthy`. Good messages keep flowing. k6 results show throughput does not collapse.
