# Sprint 2 Plan — [Team Name]

**Sprint:** 2 — Async Pipelines and Caching  
**Dates:** 04.14 → 04.21  
**Written:** 04.14 in class

---

## Goal

[What will your team have working by end of sprint? Name the specific cache, queue, and worker you are adding.]

---

## Ownership

| Team Member    | Files / Directories Owned This Sprint |
| -------------- | ------------------------------------- |
| Arkar Myint    | `services/notification-service/`      |
| Vihaan Sejwani | `services/event-catalog/`             |
| Aryan Vakil    | `workers/ticket-worker/`              |
| [Name]         | `[path]`                              |

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

### [Name]

- [ ] ...

---

## Risks

---

## Definition of Done

A TA can trigger an action, watch the queue flow in Docker Compose logs, hit the worker's `/health` to see queue depth and last-job-at, and review k6 results showing the caching improvement.
