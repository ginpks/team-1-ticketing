# Sprint 4 Plan — Team 1

**Sprint:** 4 — Replication, Scaling, and Polish  
**Dates:** 04.28 → 05.07  
**Written:** 04.28 in class

---

## Goal

[Which services will you replicate? What is the exact `--scale` command? What polish work remains?]

The ticket-purchase, payment, and event catalog services will be replicated.

---

## Ownership

| Team Member    | Files / Directories Owned This Sprint                       |
| -------------- | ----------------------------------------------------------- |
| Arkar Myint    | `services/refund-service/`                                  |
| Vihaan Sejwani | `services/event-catalog/`, `services/ticket-purchase/`      |
| Aryan Vakil    | `db/refund/`                                                |
| Tun Lin Naine  | `workers/waitlist-worker`                                   |
| Din Masic      | `services/ticket-purchase/`                                 |
| Gin Park       | `workers/analytics-worker/`, `compose.yml`                                 |
| Mark Gallant   | `k6/`                                                       |
| Sidharth Jain  | `services/notification-worker/`, `Caddyfile`, `compose.yml` |
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

- [] Implement statistic tracking in `event-catalog` service pushing to the `analytic-browse` queue
- [x] Implement `ticket-purchase` service checking `event-catalog` for seat availability
- [x] Create a seat availability route in `event-catalog` so the `ticket-purchase` can use it to check the seat availability.
- [x] Implement `event-catalog` subscribing to `purchase:confirmed` redis pub sub to update the availabilty of the seats.
- [x] Implement `event-catalog` subscribing to `seat:released` redis pub sub to update the availabilty of the seats.

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
- [x] Replicate evenet catalog, ticket-purchase, and payment services.

### Sidharth Jain

- [x] Add DLQ handling to notification worker — malformed messages and failed notification calls pushed to `purchases:confirmed:dlq`
- [x] Update `/health` endpoint to include `queue_depth`, `dlq_depth` (read live from Redis), and `last_job_at`
- [x] Worker remains `healthy` while DLQ fills — poison pills do not crash or block good messages
- [x] Add Caddy as reverse proxy and load balancer in front of `ticket-purchase` service
- [x] Remove static port and `container_name` from `ticket-purchase` to support `--scale`
- [x] Verified round-robin distribution across 3 replicas via Holmes

### Mark Gallant

- [x] Modify k6 script from sprint-1 to better stress the system and provide better analytics
- [x] Implement async test script to hit the async pipeline and provide sprint metrics

---

## Risks
- Merge conflicts could arise if mutliple members share a single service implemnentation. Careful planning and a structured git workflow is imperative.

---

## Definition of Done

`docker compose up --scale [service]=3` starts successfully. `docker compose ps` shows all replicas as `(healthy)`. k6 scaling comparison shows measurable improvement. Replica failure test shows no dropped requests.
