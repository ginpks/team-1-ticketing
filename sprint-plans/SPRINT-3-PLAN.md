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
| Arkar Myint | `services/refund-service/` |
| Vihaan Sejwani | `services/event-catalog/`, `services/ticket-purchase/`             |
| Aryan Vakil    | `db/refund/`              |
| Tun Lin Naine  | `workers/waitlist-worker`             |
| Din Masic      | `services/ticket-purchase/`           |
| Gin Park       | `workers/analytics-worker/`           |
| Mark Gallant   | `k6/`           |
| Sidharth Jain      | `services/notification-worker`           |

---

## Tasks

### Arkar Myint
- [ ] Build `services/refund-service/` with `POST /refunds` idempotent endpoint
- [ ] Validate purchase exists via sync call to Ticket Purchase
- [ ] Call Payment Service synchronously to reverse charge
- [ ] Push to `waitlist-queue` on successful refund
- [ ] Implement `GET /health` endpoint
- [ ] Add to `compose.yml` with healthcheck

### Vihaan Sejwani

- [x] Implement statistic tracking in `event-catalog` service pushing to the `analytic-browse` queue
- [x] Implement `ticket-purchase` service checking `event-catalog` for seat availability

### Aryan Vakil
- [ ] Create db for refund service 

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
