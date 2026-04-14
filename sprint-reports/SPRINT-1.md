# Sprint 1 Report — Team 1

**Sprint:** 1 — Foundation  
**Tag:** `sprint-1`  
**Submitted:** [4/13/26, before 04.14 class]

---

## What We Built

[One or two paragraphs. What is running? What does `docker compose up` produce? What endpoints are live?]
We built the core servies for the ticket system. When you run compose up, it set up the database and start the services. You can go into the workspace and test out the k6 test. The endpoints that are live are the health endpoints. 
For GET 3000:/ 3000:/health, 3001:/health, 3001:/purchases/:id, 3003:/, 3003:/health, 3003:/events
For POST 3000:/pay, 3001:/purchases

---

## Individual Contributions

| Team Member | What They Delivered | Key Commits / PR |
|---|---|---|
| Tun Lin | purchase DB, event-catalog DB | [pr for purchase db](https://github.com/ginpks/team-1-ticketing/pull/8), [pr for event db](https://github.com/ginpks/team-1-ticketing/pull/14) |
| Aryan | `/purchase/:id` endpoint, setup express and redis for the purchase service, `PublishPurchaseConfirm` function | [Ticket purchase service starter and status endpoint](https://github.com/ginpks/team-1-ticketing/pull/3), [Reconciliation after merge](https://github.com/ginpks/team-1-ticketing/pull/9), [Incorporate service and db](https://github.com/ginpks/team-1-ticketing/pull/10) |
| Vihaan | Finished `GET /events`, `GET /events/:event_id`, `POST /events` endpoints. Added input validation, correct HTTP responses including error handling and logging | [PR #16](https://github.com/ginpks/team-1-ticketing/pull/16) |
| Mark | k6 baseline script | [PR #17](https://github.com/ginpks/team-1-ticketing/pull/17) |
| Din | Payment Service, Ticket Request Service | [PR #15](https://github.com/ginpks/team-1-ticketing/pull/15) |
| Gin | API service, Event-catalogue service | [pr for API service](https://github.com/ginpks/team-1-ticketing/pull/1), [pr for Event-catalogue service](https://github.com/ginpks/team-1-ticketing/pull/14) |
| Sidharth | `POST /purchases`, Redis, purchase health check | [PR #12](https://github.com/ginpks/team-1-ticketing/pull/12) |
| Arkar Myint | `services/payment-service/`, `services/api/` | Implemented payment service with Postgres and Redis health checks, added idempotency to payment validation, refactored payment logic to standalone service |

Verify with:

```bash
git log --author="Name" --oneline -- path/to/directory/
```

---

## What Is Working

- [x] `docker compose up` starts all services without errors
- [x] `docker compose ps` shows every service as `(healthy)`
- [x] `GET /health` on every service returns `200` with DB and Redis status
- [x] At least one synchronous service-to-service call works end-to-end
- [x] k6 baseline test runs successfully

all of these are working

---

## What Is Not Working / Cut

[Be honest. What did you not finish? What did you cut from the sprint plan and why? How will you address it in Sprint 2?]

So far all the core servies are finished. For now some api insert their data but in future we can make queries store in the db that the api can use to interact with the database. In sprint 2 we can just call thesequeries instead of api having their own insert statement.

---

## k6 Baseline Results

Script: `k6/sprint-1.js`  
Run: `docker compose exec holmes k6 run /workspace/k6/sprint-1.js`

```
[Paste the k6 summary output here]

INFO[0070] SPRINT-1 METRICS:                             source=console
INFO[0070] p50: 1.6030305ms                              source=console
INFO[0070] p95: 2.4884855999999993ms                     source=console
INFO[0070] p99: 3.344339540000004ms                      source=console
INFO[0070] Requests/second: 28.562393230432942           source=console


  █ THRESHOLDS 

    errors
    ✓ 'rate<0.01' rate=0.00%

    http_req_duration
    ✓ 'p(95)<500' p(95)=2.48ms


  █ TOTAL RESULTS 

    checks_total.......: 4020    57.124786/s
    checks_succeeded...: 100.00% 4020 out of 4020
    checks_failed......: 0.00%   0 out of 4020

    ✓ status is 200
    ✓ response time < 500ms

    CUSTOM
    errors.........................: 0.00%  0 out of 2010

    HTTP
    http_req_duration..............: med=1.6ms    p(90)=2.18ms   p(95)=2.48ms  p(99)=3.34ms  
      { expected_response:true }...: med=1.6ms    p(90)=2.18ms   p(95)=2.48ms  p(99)=3.34ms  
    http_req_failed................: 0.00%  0 out of 2010
    http_reqs......................: 2010   28.562393/s

    EXECUTION
    iteration_duration.............: med=502.44ms p(90)=503.09ms p(95)=503.4ms p(99)=504.36ms
    iterations.....................: 2010   28.562393/s
    vus............................: 1      min=1         max=20
    vus_max........................: 20     min=20        max=20

    NETWORK
    data_received..................: 935 kB 13 kB/s
    data_sent......................: 165 kB 2.3 kB/s
```

| Metric             | Value |
| ------------------ | ----- |
| p50 response time  |1.603 ms|
| p95 response time  |2.488 ms |
| p99 response time  |3.344 ms |
| Requests/sec (avg) |28.56 req/s |
| Error rate         |  0% |

These numbers are your baseline. Sprint 2 caching should improve them measurably.

---

## Blockers and Lessons Learned

[What slowed you down? What would you do differently? What surprised you?]

The problem we faced was what schema we should decide on and how we want out system to look. It was hard but we manage to agree on one things. We should also start our project earlier and communicate ealier so one person did not design something and some one else design a different thing and then have to have things up on the last day. Next time we will start earlier and communicate better. Im surprised that we are able to make our system work and communicate well on the last few days.

