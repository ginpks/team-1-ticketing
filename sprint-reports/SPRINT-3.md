# Sprint 3 Report — [Team Name]

**Sprint:** 3 — Reliability and Poison Pills  
**Tag:** `sprint-3`  
**Submitted:** [date, before 04.28 class]

---

## What We Built

[What failure scenarios does the system now handle? Which queues have DLQ handling? What happens when a poison pill is injected?]

---

## Individual Contributions

| Team Member | What They Delivered | Key Commits |
| ----------- | ------------------- | ----------- |
| [Name]      | | |
| [Name]      | | |
| [Name]      | | |

---

## What Is Working

- [ ] Poison pill handling: malformed messages go to DLQ, worker keeps running
- [ ] Worker `GET /health` shows non-zero `dlq_depth` after poison pills are injected
- [ ] Worker status remains `healthy` while DLQ fills
- [ ] System handles failure scenarios gracefully (no dangling state, no crash loops)
- [ ] All services/workers required for team size are implemented

---

## What Is Not Working / Cut

---

## Poison Pill Demonstration

How to inject a poison pill:

```bash
# From inside holmes:
docker compose exec holmes bash

# Example — publish a malformed message directly to the queue:
redis-cli -h redis RPUSH your-queue '{"this": "is malformed"}'
```

Worker health before injection:

```json
{
  "status": "healthy",
  "queue_depth": 0,
  "dlq_depth": 0,
  "last_job_at": "2025-04-24T..."
}
```

Worker health after injection:

```json
{
  "status": "healthy",
  "queue_depth": 0,
  "dlq_depth": 3,
  "last_job_at": "2025-04-24T..."
}
```

---

## k6 Results: Poison Pill Resilience (`k6/sprint-3-poison.js`)

```
[Paste k6 summary output here]
```

| Metric | Normal-only run | Mixed with poison pills | Change |
| ------ | --------------- | ----------------------- | ------ |
| p95    | | | |
| RPS    | | | |
| Error rate | | | |

[Explain: did throughput hold? Did the worker stay healthy throughout?]

---

## Blockers and Lessons Learned
