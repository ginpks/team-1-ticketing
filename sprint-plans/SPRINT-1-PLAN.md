# Sprint 1 Plan — Team 1

**Sprint:** 1 — Foundation  
**Dates:** 04.07 → 04.14  
**Written:** 04.07 in class

---

## Goal

Initial setup of express server, routes, docker files, compose file, and db connection.

---

## Ownership

| Team Member                   | Files / Directories Owned This Sprint |
| ----------------------------- | ------------------------------------- |
| Gin Park and Vihaan Sejwani   | `service/api/`                        |
| Din Masic and Arkar Myint     | `service/payment/`                    |
| Sidharth Jain and Aryan Vakil | `service/ticket-purchase/`            |
| Mark Gallant                  | `k6/sprint-1.js`                      |
| Tun Lin Naine                 | `db/purchaseDB`,                      |
| Everyone                      | `compose.yml`                         |

Each person must have meaningful commits in the paths they claim. Ownership is verified by:

```bash
git log --author="Name" --oneline -- path/to/directory/
```

---

## Tasks

### Gin Park and Vihaan Sejwani

- [ ] Set up `service/api` with Express
- [ ] Set up `service/event-catalogue` with Express
- [ ] Set up `redis` in compose + health checkpoint
- [ ] Implement `GET /health` for api
- [ ] Implement `GET /health` for event-catalogue

### Din Masic and Arkar Myint

- [ ] Set up `service/payment`
- [ ] Implement `GET /health` with [Whatever this depends on]
- [ ] Test synchronous call to [Ticket purchase]

### Sidharth Jain and Aryan Vakil

- [ ] Set up `service/ticket-purchase`
- [ ] Implement `GET /health` with [Whatever this depends on]
- [ ] Test synchronous call to [Payment Service]

### Mark Gallant

- [ ] Write `k6/sprint-1.js` baseline load test

### Tun Lin Naine

- [ ] Set up `db/purchase-db`
- [ ] Set up `db/event-catalogue-db`

### Everyone

- [ ] Write `README.md` startup instructions and endpoint list
- [ ] Add their service's compose.yml file

---

## Risks

Merge conflicts could arise if mutliple members share a single service implemnentation. Careful planning and a structured git workflow is imperative.

---

## Definition of Done

A TA can clone this repo, check out `sprint-1`, run `docker compose up`, and:

- `docker compose ps` shows every service as `(healthy)`
- `GET /health` on each service returns `200` with DB and Redis status
- The synchronous service-to-service call works end-to-end
- k6 baseline results are included in `SPRINT-1.md`
