# Sprint 2 Report — Team 1

**Sprint:** 2 — Async Pipelines and Caching  
**Tag:** `sprint-2`  
**Submitted:** [date, before 04.21 class]

---

## What We Built

[What cache did you add? What queue and worker are running? What does the async pipeline do?]

- Implemented part one of Analytics worker that subscribes to purchase events published by the ticket-purchase worker and stores related data in the analytic DB.

- Implemented a Dead Letter Queue (DLQ) for the ticket purchase worker, which stores jobs that cannot be processed due to issues like invalid payloads, database failures, pub/sub failures, or unexpected runtime errors, ensuring no jobs are silently lost.

- Added a health endpoint for the ticket purchase worker that reports system status, including queue depths (main queue and DLQ) and the timestamp of the last successfully processed job, enabling monitoring and quick detection of failures or backlogs.


---

## Individual Contributions

| Team Member    | What They Delivered                                                                                                                                                                                                                                                     | Key Commits / PR                                                                                                                                                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tun Lin Naine  | analytic db and waitlist worker | https://github.com/ginpks/team-1-ticketing/pull/20, https://github.com/ginpks/team-1-ticketing/pull/28|
| Aryan          | Added `GET \health` endpoint for ticket purchase worker, moved ticket purchase worker to the workers folder and created/updated related Dockerfile and package.json | [PR #22](https://github.com/ginpks/team-1-ticketing/pull/22) |
| Vihaan Sejwani | Added caching to Event Catalog service, the cache interacts with `GET /events`, `GET /events/:event_id`, `POST /events` endpoints. Created Architecture diagram.                                                                                                        | [PR #25](https://github.com/ginpks/team-1-ticketing/pull/25)                                                                                                                                                                                                                |
| Mark Gallant   | Modified k6 script from sprint-1 to better stress the system and provide better analytics. Implemented async test script to hit the async pipeline and provide sprint metrics. Contributed to Sprint-2 report with metric analysis based on test results.               | [PR #30](https://github.com/ginpks/team-1-ticketing/pull/30), [PR #31](https://github.com/ginpks/team-1-ticketing/pull/31)                                                                                                                                                                                                                                       | [PR #17](https://github.com/ginpks/team-1-ticketing/pull/17)                                                                                                                                                                                                                |
| Din            | Payment Service, Ticket Request Service                                                                                                                                                                                                                                 | [PR #15](https://github.com/ginpks/team-1-ticketing/pull/15)                                                                                                                                                                                                                |
| Gin Park       | Analytics worker | https://github.com/ginpks/team-1-ticketing/pull/24 |
| Sidharth       | `POST /purchases`, Redis, purchase health check                                                                                                                                                                                                                         | [PR #12](https://github.com/ginpks/team-1-ticketing/pull/12)                                                                                                                                                                                                                |
| Arkar Myint    | Built `notification-service` — `POST /notify` logs simulated confirmation emails, `GET /health` returns service status. Added to `compose.yml` on port 3005. | [PR #21](https://github.com/ginpks/team-1-ticketing/pull/21), [PR #27](https://github.com/ginpks/team-1-ticketing/pull/27) |

---
## What Is Working

- [x] Redis cache in use — repeated reads do not hit the database
- [ ] Async pipeline works end-to-end (message published → worker consumes → action taken)
- [ ] At least one write path is idempotent (same request twice produces same result)
- [ ] Worker logs show pipeline activity in `docker compose logs`
- [x] Worker `GET /health` returns queue depth, DLQ depth, and last-job-at
- [x] Both sprint-2-cache.js and sprint-2-async.js k6 tests run succesfully and provide the desired metrics

---

## What Is Not Working / Cut

---

## k6 Results

### Test 1: Caching Comparison (`k6/sprint-2-cache.js`)

| Metric | Sprint 1 Baseline | Sprint 2 Cached | Change |
| ------ | ----------------- | --------------- | ------ |
| p50    | 5.1ms             | 1.3ms           | -74.5% |
| p95    | 6.9ms             | 1.9ms           | -72.5% |
| p99    | 8.4ms             | 2.5ms           | -70.2% |
| RPS    | ~3205             | ~11,449         | +257%  |

Our numbers improved quite significantly. We saw a substantial decrease in
the response time for each of the 3 measured metrics: p50, p95, and p99, and
a big increase in the RPS.

We expected our numbers to improve once we hooked up our main endpoint, the
event-catalogue, to a redis cache. They did improve a little at first, but
not by very much. This made us suspect that our test might not be working
as well as it should be. The issue was that our original test was using a
k6's `sleep()` function for every VU, which is what the boilerplate script
from the main repo does by default. This is good for simulating real user
behavior because it adds some time where the user might be thinking or
looking for what button they need to press or whatever, but it's not the best
for doing a stress test because it means the system is just waiting around
most of the time.

After modifying the original test script from Sprint-1 to not use the sleep
function, the numbers from our first sprint became significantly worse, which
was good, because it meant that the system was experiencing more stress from
all the requests. We made sure to run our modified test script from Sprint-1
on the version of our endpoint that was **not** using the redis-cache, and
that's where the numbers in the Sprint 1 Baseline section in the above table
come from.

Running the same script on our endpoint with the redis cache gave us the
results above with the significant improvements in all metrics. This is from
the endpoint not needing to hit the DB for every single request, instead just
pulling straight from the redis cache once it exists. The response time is
basically just the network latency from the request being pulled straight
from memory and transmitted.

### Test 2: Async Pipeline Burst (`k6/sprint-2-async.js`)

Our async pipeline test hits our `/purchases` endpoint with a burst of POST
requests. It verifies a 202 status return and a valid purchase.id and that
the value of `duplicate` returns false for every request.

There's a `queue-monitor` test that periodically hits the `/health` endpoint
to monitor the queue and see if anything is in there. This prints to the
terminal continuously as the test runs. It reads both the queue depth and the
DLQ depth each time it polls.

Finally, there's an idempotency check that has two VUs send an identical key
to ensure that they don't create duplicate requests. One of the requests
should be flagged as `duplicate: false` and the other as `duplicate: true`,
with the test validating the only of the requests actually created a new
row.

```
INFO[0030]   Acceptance latency                         source=console
INFO[0030]     p50  :  2.2  ms                          source=console
INFO[0030]     p95  :  3.3  ms                          source=console
INFO[0030]     p99  :  4.5  ms                          source=console
INFO[0030]     rps  :  63.0 req/s                       source=console
INFO[0030]                                              source=console
INFO[0030]   Worker queue depth (sampled every 100 ms)  source=console
INFO[0030]     max  : 1                                 source=console
INFO[0030]     avg  : 0.0                               source=console
INFO[0030]  DLQ depth max : 0                           source=console
INFO[0030]                                              source=console
INFO[0030]  Idempotency duplicate rows created : 0      source=console
INFO[0030]  Burst accept error rate : 0.00%             source=console
```

Worker health during the burst (hit `/health` while k6 is running):

```
INFO[0004] [monitor] queue=0 dlq=0 lastSuccess=2026-04-20T23:31:58.680Z  source=console
INFO[0004] [monitor] queue=1 dlq=0 lastSuccess=2026-04-20T23:31:58:780Z  source=console
INFO[0004] [monitor] queue=0 dlq=0 lastSuccess=2026-04-20T23:31:58:883Z  source=console
```

Getting a value above 0 for the queue was difficult. With the initial 50 VUs
it was not happening, we think because everything was being processed too
quickly since nothing very demanding is actually happening with each request.
Upping the VUs to ~250 started to show some activity in the queue, but never
above 1. It also quickly drops back down to 0, as shown in the output above.
But since we did see some activity we know the queue is functioning. The DLQ
never showed anything but 0 which is good because it means none of the
requests were failing to process.

Idempotency check: 
---

We have 2 VUs send requests with identical IDs and expect one to be marked
with `duplicate: false` and the other with `duplicate: true`. If the
response is marked as a duplicate we check for a valid purchase id. The
duplicate guarding logic on the endpoint should prevent any duplicate entries
from actually being created, so at the end of the test we verify that there
are no actual duplicate purchases. Despite this, both requsts still succeed
and return 200 (or 202) codes.

## Blockers and Lessons Learned

As usual, we all learned that we should start our work earlier. We also learned
a lot about the different ways of using k6 to test and particularly about
using tests to simulate actual user behavior vs just slamming a system to
stress test it. In this Sprint there were very small changes to the test
script that gave pretty substantially different results and it was something
we had to consider for our tests. From the last sprint we were initially doing
something closer to user behavior simulation, whereas for this sprint we
changed to a proper stress test.

