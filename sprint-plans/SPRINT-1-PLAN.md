# Sprint 1 Plan — [Team Name]

**Sprint:** 1 — Foundation  
**Dates:** 04.07 → 04.14  
**Written:** 04.07 in class

---

## Goal

[One or two sentences on what your team will have working by end of sprint. Be specific. "Order service, restaurant service, and synchronous call between them running in Docker Compose with health endpoints" is good. "Get stuff working" is not.]

---

## Ownership

| Team Member | Files / Directories Owned This Sprint           |
| ----------- | ----------------------------------------------- |
| Gin Park and Arkar Myint      | `[service-dir]/`, `[service-dir]/db/schema.sql` |
| [Name]      | `[service-dir]/`, `compose.yml` additions       |
| [Name]      | `k6/sprint-1.js`, `[worker-dir]/`               |

Each person must have meaningful commits in the paths they claim. Ownership is verified by:

```bash
git log --author="Name" --oneline -- path/to/directory/
```

---

## Tasks

### [Name]

- [ ] Set up `[service]/` with Express + Postgres connection
- [ ] Implement `GET /health` with DB check
- [ ] Write `db/schema.sql` and seed script
- [ ] Add `healthcheck` directive to `compose.yml`

### [Name]

- [ ] Set up `[service]/` with Express + Redis connection
- [ ] Implement `GET /health` with Redis check
- [ ] Implement `GET /[resource]` — stub returning placeholder data
- [ ] Test synchronous call to [other service]

### [Name]

- [ ] Wire `depends_on: condition: service_healthy` in `compose.yml`
- [ ] Write `k6/sprint-1.js` baseline load test
- [ ] Write `README.md` startup instructions and endpoint list

---

## Risks

[What could go wrong? What are you uncertain about? What will you do if a task takes longer than expected?]

---

## Definition of Done

A TA can clone this repo, check out `sprint-1`, run `docker compose up`, and:

- `docker compose ps` shows every service as `(healthy)`
- `GET /health` on each service returns `200` with DB and Redis status
- The synchronous service-to-service call works end-to-end
- k6 baseline results are included in `SPRINT-1.md`
