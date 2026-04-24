# Sprint 2 Plan — Team 1
**Sprint:** 2 — Async Pipelines and Caching  
**Dates:** 04.14 → 04.21  
**Written:** 04.14 in class

---

## Goal

[What will your team have working by end of sprint? Name the specific cache, queue, and worker you are adding.]
Our group will change our workflow from sync to async to make the system flow faster and handle more services. We will on analytics, waitlist, notification workers. We will add a event cache.

---

## Ownership

| Team Member    | Files / Directories Owned This Sprint |
| -------------- | ------------------------------------- |
| Arkar Myint    | `services/notification-service/`      |
| Vihaan Sejwani | `services/event-catalog/`             |
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

- [x] Implement caching in `event-catalog` service, `GET/events`
- [x] Implement caching in `event-catalog` service, `GET/events:event_id`
- [x] Implement deleting cache in `event-catalog` service, `POST/events` to avoid serving stale data

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

- [x] Implement analytics worker that subscribes to puchase events and stores related data in analytics db
- [x] Add `GET \health` for analytics worker
      
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

A TA can trigger an action, watch the queue flow in Docker Compose logs, hit the worker's `/health` to see queue depth and last-job-at, and review k6 results showing the caching improvement.
