# Sprint 2 Report — [Team Name]

**Sprint:** 2 — Async Pipelines and Caching  
**Tag:** `sprint-2`  
**Submitted:** [date, before 04.21 class]

---

## What We Built

[What cache did you add? What queue and worker are running? What does the async pipeline do?]

---

## Individual Contributions

| Team Member | What They Delivered | Key Commits |
| ----------- | ------------------- | ----------- |
| [Name]      | | |
| [Name]      | | |
| [Name]      | | |

---

## What Is Working

- [ ] Redis cache in use — repeated reads do not hit the database
- [ ] Async pipeline works end-to-end (message published → worker consumes → action taken)
- [ ] At least one write path is idempotent (same request twice produces same result)
- [ ] Worker logs show pipeline activity in `docker compose logs`
- [ ] Worker `GET /health` returns queue depth, DLQ depth, and last-job-at

---

## What Is Not Working / Cut

---

## k6 Results

### Test 1: Caching Comparison (`k6/sprint-2-cache.js`)

| Metric | Sprint 1 Baseline | Sprint 2 Cached | Change |
| ------ | ----------------- | --------------- | ------ |
| p50    | | | |
| p95    | | | |
| p99    | | | |
| RPS    | | | |

[Explain the improvement. If the numbers did not improve, explain why and what you did to diagnose it.]

### Test 2: Async Pipeline Burst (`k6/sprint-2-async.js`)

```
[Paste k6 summary output here]
```

Worker health during the burst (hit `/health` while k6 is running):

```json
[Paste an example health response showing non-zero queue depth]
```

Idempotency check: [Describe what you sent and what happened when you sent the same idempotency key twice.]

---

## Blockers and Lessons Learned
