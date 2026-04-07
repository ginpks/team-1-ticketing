# Sprint 1 Report — [Team Name]

**Sprint:** 1 — Foundation  
**Tag:** `sprint-1`  
**Submitted:** [date, before 04.14 class]

---

## What We Built

[One or two paragraphs. What is running? What does `docker compose up` produce? What endpoints are live?]

---

## Individual Contributions

| Team Member | What They Delivered                                     | Key Commits            |
| ----------- | ------------------------------------------------------- | ---------------------- |
| [Name]      | [e.g. order-service with DB schema, health endpoint]    | [short SHA or PR link] |
| [Name]      | [e.g. restaurant-service, synchronous call integration] |                        |
| [Name]      | [e.g. compose.yml wiring, k6 baseline script]           |                        |

Verify with:

```bash
git log --author="Name" --oneline -- path/to/directory/
```

---

## What Is Working

- [ ] `docker compose up` starts all services without errors
- [ ] `docker compose ps` shows every service as `(healthy)`
- [ ] `GET /health` on every service returns `200` with DB and Redis status
- [ ] At least one synchronous service-to-service call works end-to-end
- [ ] k6 baseline test runs successfully

---

## What Is Not Working / Cut

[Be honest. What did you not finish? What did you cut from the sprint plan and why? How will you address it in Sprint 2?]

---

## k6 Baseline Results

Script: `k6/sprint-1.js`  
Run: `docker compose exec holmes k6 run /workspace/k6/sprint-1.js`

```
[Paste the k6 summary output here]
```

| Metric             | Value |
| ------------------ | ----- |
| p50 response time  |       |
| p95 response time  |       |
| p99 response time  |       |
| Requests/sec (avg) |       |
| Error rate         |       |

These numbers are your baseline. Sprint 2 caching should improve them measurably.

---

## Blockers and Lessons Learned

[What slowed you down? What would you do differently? What surprised you?]
