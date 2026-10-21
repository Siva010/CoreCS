---
title: "When a Server Is Overloaded: Queues, Backpressure and Cascading Failure"
subject: x
level: 0
order: 5
summary: "Why latency explodes near 100% utilization, Little's law and queueing intuition, bounded queues and backpressure, load shedding, timeouts and retry storms, circuit breakers and bulkheads, and how one slow dependency takes down a whole system."
depth: advanced
difficulty: 4
minutes: 50
relevance: essential
stage: 3
prerequisites: [os-thread-pools, os-epoll-event-loops, cn-tail-latency, os-performance-method]
related: [x-connection-management, x-slow-query, os-scheduling-basics, cn-proxies-load-balancers, db-redis-caching, db-failover, os-classic-sync-problems]
labs: [speedup-queueing, producer-consumer, overload-retries]
tags: [overload, queueing theory, utilization, littles law, backpressure, bounded queue, load shedding, admission control, timeouts, retries, exponential backoff, jitter, retry storm, circuit breaker, bulkhead, cascading failure, thundering herd, autoscaling, graceful degradation]
---

## Mental Model

Every server is a **queue in front of a limited set of workers**: threads, event-loop time, DB connections, CPU cores. While work arrives slower than it's completed, queues stay short and latency is just the service time. As the arrival rate approaches capacity, queues grow **non-linearly**:

- at 50% utilization, a request waits about as long as it is served;
- at 90%, it waits about 9 times longer;
- at 99%, about 99 times longer.

Past 100%, the queue grows without bound. Every request times out, and the work spent on them is wasted.

Overload is dangerous because it **feeds itself**: slow responses cause timeouts, timeouts cause retries, retries add load. The defenses are about keeping queues bounded and refusing work early.

## Definition

- **Utilization (ρ)**: fraction of time workers are busy = arrival rate × service time / workers.
- **Little's law**: items in the system = arrival rate × time in system (L = λW) — holds for any stable queue.
- **Backpressure**: a slow consumer signals producers to slow down (bounded buffers that block/reject, TCP flow control, reactive streams).
- **Load shedding / admission control**: rejecting excess work quickly (HTTP 503/429) instead of queueing it.
- **Retry storm**: retries multiplying load on an already overloaded service.
- **Circuit breaker**: stop calling a failing dependency for a while; fail fast.
- **Bulkhead**: isolate resources (pools, threads) per dependency/feature so one failure can't consume everything.
- **Cascading failure**: overload in one component propagating to others.

## Why It Exists

**The problem.** Capacity is always finite, and traffic spikes, slow dependencies, bad deploys and failovers regularly push some component past it. Systems that degrade gracefully (serve fewer requests, but serve them) stay up. Systems that queue without limit and retry blindly collapse, often long after the original trigger is gone (metastable failure).

**The idea.** When you can't do all the work, decide *which* work not to do: early, cheaply and on purpose. Don't let queues and retries decide for you. Every defense below (bounded queues, shedding, rate limits, timeouts, circuit breakers) is a different place to make that decision.

:::callout[That's all it is]{type=insight}
An overloaded server is a queue growing faster than it drains. Keep queues bounded, reject excess early, time out and retry sparingly, and cut off failing dependencies — so the server keeps doing *some* work well instead of all work badly.
:::

## How It Works

### The latency curve

For a single-server queue with random arrivals (M/M/1), average time in system = service time / (1 − ρ):

| Utilization ρ | Wait multiplier (time in system ÷ service time) |
|---|---|
| 50% | 2× |
| 80% | 5× |
| 90% | 10× |
| 95% | 20× |
| 99% | 100× |

Multi-worker systems are better but have the same knee. Practical rule: plan capacity so that normal peaks stay below ~70–80% of the bottleneck resource.

### Little's law in capacity planning

A service receiving 1,000 req/s with 50 ms latency has 50 requests in flight. If latency rises to 2 s (a slow dependency), in-flight requests rise to 2,000 — exceeding thread pools, connection pools and memory. **Latency increases are concurrency increases**, which is how a slow dependency exhausts resources upstream ([Connection Management](lesson:x-connection-management)).

### Bounded queues and backpressure

An unbounded queue converts overload into unbounded latency and memory growth (and, eventually, OOM). Bounded queues force a decision: block the producer (backpressure), or reject (shed load). Examples: thread pools with bounded task queues and a rejection policy ([Thread Pools](lesson:os-thread-pools)); TCP's receive window ([Flow Control](lesson:cn-tcp-flow-control)); the kernel's listen backlog; a pool's checkout timeout.

### Load shedding

Once a request is going to time out anyway, every bit of work spent on it is wasted. And that wasted work is what slows the requests that could have succeeded. Reject early and cheaply, at the edge, before doing expensive work:

- Return 503/429 when queue length or in-flight count exceeds a threshold (concurrency limits, adaptive limits that track latency).
- Prioritize: shed low-value traffic (analytics beacons, prefetches) before checkout requests.
- Drop requests whose client has already given up (deadline propagation: don't start work on a request whose 2 s client timeout already passed).

### Rate limiting: saying no precisely

Load shedding decides *how many* requests to drop; a rate limiter decides *whose* requests to drop, usually per API key, user or IP.

| Algorithm | How it works | Burst behavior | Cost |
|---|---|---|---|
| **Fixed window** | count requests per key per clock minute; reject above N | allows 2N across a window boundary | one counter + TTL |
| **Sliding window log** | store timestamps, count those within the last T | exact | memory ∝ requests |
| **Sliding window counter** | weight the previous window's count by overlap | close to exact | two counters |
| **Token bucket** | tokens refill at rate r up to capacity b; each request takes one | allows bursts up to b, long-run rate r | two numbers (tokens, last refill) |
| **Leaky bucket (queue)** | requests queue and drain at a constant rate | smooths bursts, adds latency | a bounded queue |

**Token bucket is the usual default**: it is cheap, allows short bursts (which real clients produce) and enforces an average rate. In Redis the state is one hash per key updated by a small Lua
script, so the check is atomic and ~0.2 ms ([Redis & Caching](lesson:db-redis-caching)).

Distributed rate limiting adds a choice: exact global limits need a shared store on every request (latency, a hard dependency), while per-instance limits of N/instances are cheaper but drift
when traffic is uneven. Many systems use local token buckets synchronized periodically — approximate, but never a single point of failure.

Tell clients what happened: **429 Too Many Requests** with `Retry-After`, and headers for the remaining quota. A limiter that drops silently turns into a retry storm.

### Timeouts and retries done right

- Every remote call needs a timeout ([Connection Management](lesson:x-connection-management)).
- Retries only for idempotent operations, with **exponential backoff and jitter**, a small max attempt count, and a **retry budget** (e.g., retries ≤ 10% of requests).
- Retry at one layer only: if 3 layers each retry 3 times, one user request becomes 27 calls to the bottom service.

### Circuit breakers and bulkheads

When a dependency is failing, calling it again only adds load to it and ties up your own threads waiting. A circuit breaker remembers recent failures and stops calling for a while; a bulkhead caps how much of your capacity any one dependency can occupy.

```mermaid
stateDiagram-v2
    [*] --> Closed
    Closed --> Open: failure rate > threshold
    Open --> HalfOpen: after cool-down
    HalfOpen --> Closed: trial requests succeed
    HalfOpen --> Open: trial requests fail
```

- **Circuit breaker**: while open, calls fail instantly (or use a fallback — cached data, default response), protecting both the caller's resources and the struggling dependency.
- **Bulkheads**: separate thread/connection pools per dependency, so the slow recommendations service can exhaust *its* pool but not the checkout path's.

### In a Java service

Most Java overload problems start with an unbounded queue nobody chose. `Executors.newFixedThreadPool(32)` puts tasks in an unbounded `LinkedBlockingQueue`. Under overload it accepts everything, latency grows without limit, and the heap eventually fills. Build the executor yourself, with a bounded queue and a rejection policy, and turn rejection into a fast 503:

```java
ThreadPoolExecutor workers = new ThreadPoolExecutor(
        32, 32, 0, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(100),               // at most 100 tasks waiting
        new ThreadPoolExecutor.AbortPolicy());       // queue full: throw at once

void submit(Runnable handleRequest, Runnable reject503) {
    try {
        workers.execute(handleRequest);
    } catch (RejectedExecutionException full) {
        reject503.run();                             // shed load early and cheaply
    }
}
```

`CallerRunsPolicy` is the backpressure alternative: the submitting thread runs the task itself, which slows down whoever is producing work. Tomcat has the same knobs: `server.tomcat.threads.max` (200 worker threads) and `server.tomcat.accept-count` (100 connections waiting in the kernel's backlog).

Timeouts, retries, circuit breakers and bulkheads usually come from Resilience4j, configured per dependency:

```properties
resilience4j.circuitbreaker.instances.recommendations.failure-rate-threshold=50
resilience4j.circuitbreaker.instances.recommendations.sliding-window-size=20
resilience4j.circuitbreaker.instances.recommendations.wait-duration-in-open-state=10s
resilience4j.bulkhead.instances.recommendations.max-concurrent-calls=20
resilience4j.retry.instances.recommendations.max-attempts=2
resilience4j.timelimiter.instances.recommendations.timeout-duration=300ms
```

Read it as: open the breaker when half of the last 20 calls fail, and try again after 10 s. Let at most 20 calls run at once. Make at most 2 attempts in total, and give each call 300 ms.

Watch these defenses work, or fail, on a simulated server: send it a traffic spike with and without retries, a bounded queue and a retry budget.

::lab{id=overload-retries}

## Internal Mechanism

:::depth{level=advanced}
### Anatomy of a cascading failure

1. The database slows (a bad query plan).
2. App request latency rises → in-flight requests rise (Little's law) → thread and connection pools exhaust.
3. Health checks time out → the load balancer marks instances unhealthy → remaining instances receive more traffic → they fail too.
4. Clients and upstream services retry → load multiplies.
5. Autoscaling adds instances → each opens new DB connections → the database gets *more* overloaded (connection storm).
6. Even after the bad query is fixed, the retry backlog and cold caches keep the system overloaded — a **metastable** state that needs load to be shed to recover.

The loop that keeps it going:

```mermaid
flowchart TD
    S["slow dependency"] --> L["latency rises"]
    L --> F["more requests in flight<br/>(Little's law)"]
    F --> P["thread and connection<br/>pools run out"]
    P --> T["callers time out"]
    T --> R["callers retry"]
    R -->|"more load"| L
```

Each defense breaks one link:

1. query timeouts stop the slow step from holding resources forever;
2. bounded pools and load shedding cap what is in flight;
3. health checks that test only the instance itself keep healthy instances in rotation;
4. retry budgets and jitter stop retries from multiplying the load;
5. pooled database access and scaling limits protect the database from connection storms;
6. the ability to shed traffic lets the system leave the metastable state.

### Seeing the kernel's queue

The first queue a request meets is in the kernel: the listen socket's accept queue, sized by the backlog (Tomcat's `accept-count`, 100 by default). For a listening socket, `ss` shows the queue's current length as Recv-Q and its limit as Send-Q:

```text
$ ss -ltn 'sport = :8080'
State   Recv-Q  Send-Q   Local Address:Port   Peer Address:Port
LISTEN  101     100                  *:8080              *:*

$ nstat -az TcpExtListenOverflows
TcpExtListenOverflows           18342              0.0
```

Recv-Q has passed the backlog of 100, so the queue is full, and the counter shows 18,342 connections dropped because of it. Linux drops those SYNs silently instead of refusing them, so clients see connection *timeouts*, not errors. A growing `ListenOverflows` count means the application isn't accepting connections as fast as they arrive: its threads are all busy, or it is stuck.

### Event loops under overload

A single-threaded event loop's "queue" is its backlog of ready events and pending callbacks; one CPU-heavy task delays all others (event-loop lag). Overload manifests as rising loop lag, not thread exhaustion — measure it and shed load when it grows ([epoll & Event Loops](lesson:os-epoll-event-loops)).

### Thundering herds

Many clients waking up at once create short, severe overloads. Typical triggers are the expiry of a hot cache key ([Redis & Caching](lesson:db-redis-caching)), reconnects after a failover ([Failover](lesson:db-failover)), cron jobs at :00, and every thread woken for one `accept()`. Jitter and coalescing are the cure.
:::

## Example

A product API normally at 60% CPU; a marketing push doubles traffic:

| Without protection | With protection |
|---|---|
| CPU 100%, latency 50 ms → 4 s | concurrency limit rejects ~20% with 503 quickly |
| Client timeouts at 2 s → retries → effective load 3× | clients back off with jitter; retry budget caps retries |
| Health checks fail → instances removed → remaining ones die | health checks are cheap and local; instances stay in rotation |
| Autoscaler adds 3× pods → DB connections exhausted | pooler caps DB connections; scaling limited by DB capacity |
| Outage lasts an hour after the spike ends | recommendations endpoint shed first (bulkhead); checkout stays fast; recovers when load drops |

Serving 80% of requests fast beats serving 0% slowly.

## Complexity & Performance

Latency ≈ service time / (1 − ρ) near saturation; throughput plateaus at capacity and then *falls* (goodput collapse) when time is wasted on requests that time out.

## Trade-offs

- Rejecting requests (visible errors) vs queueing them (invisible until everything times out).
- Aggressive timeouts (fast failure, possible false failures) vs lenient ones (resource tie-up).
- Retries improve success for transient faults but amplify overload — budget them.
- Headroom costs money; running hot costs outages.

## Failure Modes

- Unbounded queues (thread pools, message buffers) → memory exhaustion.
- Missing timeouts → resources held by dead calls.
- Synchronized retries (no jitter) → periodic load spikes.
- Health checks that depend on downstream services → one DB blip removes all instances.
- Autoscaling the wrong tier (stateless apps) against a fixed bottleneck (the DB).

## In Production

- Load test to find the knee; set alerts on saturation signals (queue length, pool waits, loop lag, CPU run queue), not just errors.
- Implement: per-dependency timeouts, retry budgets, circuit breakers, bulkheads, concurrency limits at the edge, graceful degradation paths (serve cached/stale data — [Caching Everywhere](lesson:x-caching-everywhere)).
- Chaos drills: inject latency into a dependency and watch whether the system sheds load or collapses.

## Deeper Connections

- Scheduling and queueing are the same mathematics ([Scheduling Basics](lesson:os-scheduling-basics)); producer–consumer with bounded buffers is backpressure in miniature ([Classic Sync Problems](lesson:os-classic-sync-problems)).
- TCP congestion control is backpressure for networks: back off on loss, probe gently ([Congestion Control](lesson:cn-tcp-congestion-control)).

## Common Misconceptions

- **"We're at 85% CPU, so 15% headroom."** Near saturation, latency is already many times the service time, and bursts push you over.
- **"Retries make systems more reliable."** Uncontrolled retries make overload worse.
- **"Autoscaling solves overload."** It's slow (minutes), and it can't scale a shared bottleneck like the database.

## Interview Questions

### [L2 · why] Why does latency increase sharply as a server approaches full utilization?

Requests arrive randomly, so near capacity, bursts form queues that the server can't drain before more arrive. Waiting time grows roughly as 1/(1 − utilization): at 90% busy the average request waits several times its service time, and at 99% about a hundred times. Beyond 100%, queues grow without bound.

### [L2 · compare] Circuit breaker vs retry vs timeout — what does each do?

A timeout bounds how long a caller waits for one attempt, freeing resources. A retry re-attempts transient failures (for idempotent operations, with backoff and jitter). A circuit breaker tracks failures and, above a threshold, stops calling the dependency for a while, failing fast or using a fallback — protecting the caller's resources and giving the dependency room to recover.

### [L3 · incident] A slow recommendations service caused your whole storefront to go down. Explain the mechanism and the fixes.

Page handlers called recommendations synchronously while holding a worker thread (and maybe a DB connection). When its latency jumped, in-flight requests grew (Little's law), exhausting the shared thread/connection pools; all endpoints queued behind them, health checks failed, and retries added load. Fixes: tight timeouts, circuit breaker with a fallback (render without recommendations), a separate bulkhead pool for that dependency, making it asynchronous/optional, retry budgets, and load shedding at the edge.

### [L2 · design] Design a rate limiter for a public API: 100 requests per minute per API key.

:::answer
Token bucket per key: capacity 100, refill 100/60 tokens per second. State is two numbers (tokens, last refill timestamp) in Redis, updated by an atomic Lua script so concurrent requests
can't double-spend; the key expires after inactivity. Reject with 429 and `Retry-After` plus remaining-quota headers. The bucket allows a short burst (up to 100) while holding the long-run
average, which matches how clients actually behave; a fixed window would let 200 requests through across a window boundary.

Scaling: a shared Redis gives exact limits but adds a round trip and a dependency on every request — so put the limiter at the edge/gateway, and for very high rates use per-instance buckets
of 100/instances with periodic synchronization, accepting approximate limits. Mention tiers (per key, per IP, per endpoint cost) and that limiting must be cheaper than the work it protects.
:::

### [L3 · design] How would you design an API to degrade gracefully under 3× normal load?

Concurrency limits or adaptive admission control at the edge that reject excess requests quickly (429/503 with Retry-After); priority classes so critical paths (checkout, login) are protected and optional features are shed first; bounded queues and pools everywhere; per-dependency timeouts, circuit breakers and bulkheads; caching with stale-while-revalidate for read paths; client guidance to back off with jitter; and capacity headroom plus autoscaling for sustained growth.

### [L2 · how] How do you make a Java thread pool shed load instead of queueing forever?

Don't use `Executors.newFixedThreadPool`, whose queue is unbounded. Create a `ThreadPoolExecutor` with a bounded queue (for example an `ArrayBlockingQueue` of 100) and a rejection policy. `AbortPolicy` throws `RejectedExecutionException` when the queue is full; catch it and return 503 with `Retry-After`, which sheds load. `CallerRunsPolicy` makes the submitting thread run the task, which slows the producer down; that is backpressure. Size the queue from the latency you can afford: 100 queued tasks at 10 ms each, on 32 threads, is about 31 ms of extra waiting. Then watch the queue length and rejection count, not just CPU.

### [L3 · design] What is a retry budget, and how would you implement one?

A cap on retries as a fraction of normal traffic, for example "retries may add at most 10% to the load". Each successful first attempt adds 0.1 to a token bucket, and each retry spends 1 token; with no tokens, the call fails without retrying. When a dependency is healthy, the few retries it needs always find tokens. When it is failing, the budget runs out quickly, so retries can't triple the load on it. gRPC's retry throttling and Finagle's retry budgets work this way. It complements a per-call limit like "at most 2 attempts", which still lets every failing call retry.

### [L3 · why] The bad query was fixed an hour ago, but the service is still overloaded. How is that possible, and how do you get out?

The system is in a metastable state: the overload now sustains itself, whatever started it. Clients keep retrying their backlog, timed-out work is still being processed, caches emptied during the incident send every read to the database, and instances that restarted are cold. Each of these adds load, which keeps latency high, which causes more timeouts and retries.

To get out, cut the load below capacity for long enough to drain the queues: shed traffic at the edge (reject a share of requests, lowest priority first), turn off retries or let the budgets run dry, and bring traffic back gradually while caches warm. Rate-limited retries and jittered backoff make it less likely to happen again.

## Practice

### [numeric 10] A single-worker queue with random arrivals runs at 90% utilization. Using time-in-system ≈ service time / (1 − ρ), how many times the service time does an average request spend in the system?

:::answer
1 / (1 − 0.9) = **10×** the service time: a 10 ms operation takes ~100 ms on average.
:::

### [numeric 27] Three layers each retry a failed call up to 2 extra times (3 attempts per layer). In the worst case, how many calls reach the bottom service for one user request?

:::answer
Attempts multiply across layers: 3 × 3 × 3 = **27** calls. Retry at one layer only, with budgets.
:::

### [numeric 600] A service receives 400 requests per second and normally answers in 50 ms. A dependency slows down, and latency becomes 1.5 s. How many requests are in flight now?

:::answer
L = λ × W = 400 × 1.5 = **600**, up from 20. With Tomcat's 200 worker threads, the server ran out of threads well before that point; the rest queue, time out and retry.
:::

### [numeric 1390] 1,000 requests per second arrive, and during an incident 30% of every attempt fails. Each failed attempt is retried, up to 2 retries per request, with no retry budget. How many calls per second reach the struggling service?

:::answer
First attempts 1,000, first retries 1,000 × 0.3 = 300, second retries 300 × 0.3 = 90, for a total of **1390** calls per second: 39% more load on a service that is already failing. A 10% retry budget would cap it at 1,100.
:::

### [exercise] In the [Speedup & Queueing lab](lab:speedup-queueing), queueing tab, set the service time to 10 ms. Compare 1 server at 90 requests per second with 4 servers at 360 and 16 servers at 1,440: all three are 90% busy. What is the mean response time in each case, and what does that say about adding servers?

:::solution
- 1 server: 100 ms (10 × the service time), and 90% of requests wait.
- 4 servers: 29.69 ms, and 78.8% wait.
- 16 servers: 13.70 ms, and 59.1% wait.

At the same utilization, a pool of servers sharing one queue answers much faster than a single server: a busy server rarely holds up the whole queue. But even 16 servers at 90% are 37% slower than idle ones, and every case climbs steeply as utilization approaches 100%. More servers soften the knee; they don't remove it. Keep headroom at peak.
:::

### [exercise] In the [producer–consumer lab](lab:producer-consumer), fill the buffer with a fast producer. Which thread blocks, and on which semaphore? Relate this to backpressure and to load shedding in a server.

:::solution
When the buffer is full, the `empty` semaphore (free slots) is 0, so the producer blocks on `empty` until a consumer removes an item and signals it. That is **backpressure**: a bounded buffer forces the producer to slow down to the consumer's pace.

A server can do the same, with a bounded queue that blocks the caller, or TCP's window filling up. It can also refuse instead of blocking: a bounded queue that rejects when full, returning 503 or 429, is **load shedding**. Blocking suits internal producers that can wait. Rejecting suits external clients, who should back off rather than tie up a thread.
:::

### [mcq] What does `Executors.newFixedThreadPool(32)` give you under overload?

- [ ] 32 threads, and new tasks are rejected when all are busy
- [x] 32 threads and an unbounded queue: tasks wait for ever longer, and memory grows
- [ ] A pool that grows past 32 threads when tasks queue up
- [ ] 32 threads that block the caller when all are busy

Its `LinkedBlockingQueue` has no capacity limit, so overload turns into unbounded latency and, eventually, an `OutOfMemoryError`. Build a `ThreadPoolExecutor` with a bounded queue and a rejection policy instead.

### [exercise] In the [Overload & Retries lab](lab:overload-retries), run "No protection", then "No retries", then "Bounded queue". For each, does goodput recover after the spike ends at 20 s, and what does the server spend its capacity on in the meantime?

:::solution
- **No protection**: it never recovers. After the spike every request waits longer than the 1 s timeout, so each one turns into 3 attempts, and the offered load stays around 1,200 per second: 2.4 times the capacity of 500. The server stays 100% busy finishing requests whose clients have left: 88% of all its work is wasted, and only 13.3% of requests succeed. That is a metastable failure.
- **No retries**: it recovers at 46 s, 26 s after the spike. Until then it drains the backlog, again mostly for clients who have already given up; 58.1% succeed.
- **Bounded queue** (250 requests): it recovers immediately, at 20 s. During the spike about 900 requests per second are refused at once with a 503, but those admitted wait only about 0.45 s, inside the timeout, so the server spends its capacity on requests that can still succeed: 93.2% succeed overall.

The lesson: retries turn a temporary overload into a permanent one, and a bounded queue (or dropping expired requests) keeps the server's work useful.
:::

## Quick Revision

- Latency ≈ service/(1 − ρ): the knee is real; keep peaks below ~70–80%.
- Little's law: latency ↑ ⇒ in-flight ↑ ⇒ pools exhaust. Slow dependencies take down callers.
- Bound every queue; backpressure or shed load early (429/503), by priority.
- Rate limit per key: token bucket (bursty, cheap) or sliding window; answer with 429 + Retry-After.
- Timeouts everywhere; retries only idempotent, with backoff + jitter + budgets, at one layer.
- Circuit breakers, bulkheads, graceful degradation; beware thundering herds, connection storms and metastable failures.
- Java: never an unbounded executor queue; `ThreadPoolExecutor` + `ArrayBlockingQueue` + `AbortPolicy` (shed, 503) or `CallerRunsPolicy` (backpressure).
- Resilience4j per dependency: circuit breaker, bulkhead, retry with a small max, time limiter.
- Metastable overload outlives its trigger: shed load until queues drain, then restore traffic gradually.
