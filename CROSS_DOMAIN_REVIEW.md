# Cross-Domain track — review and ratings

*Reviewed 21 October 2026, covering all 8 cross-domain lessons ("Connections"): the end-to-end journeys and the unifying patterns that tie the [database](DBMS_REVIEW.md), [operating-systems](OS_REVIEW.md) and [networks](CN_REVIEW.md) tracks together. They were then improved in the same rounds as those tracks: questions and theory, practice, understandability, diagrams, Java and labs. The track still has 8 lessons.*

## Verdict

The cross-domain lessons were already **the best-written part of the site**. They answer the classic questions that cut across subjects: what happens when you open a website, a SQL query's path through the system, a slow endpoint, an overloaded server, and caching, concurrency and durability at every layer. Each one follows a single operation through every layer and says what fails where. The review found five weaknesses:

- **Almost no self-testing.** There were 16 practice items, 2 per lesson, and no written exercises at all.
- **No Java.** The only program was a Python `cursor.execute` line. The lessons talked about "the app" and "the pool" without ever naming Tomcat's threads, HikariCP, JDBC or Resilience4j, which are what a Java backend developer actually configures.
- **One wrong worked example.** The slow-endpoint lesson's investigation hinged on a `bigint` column compared with a text parameter "silently" causing a sequential scan. PostgreSQL rejects that comparison with an error. The same MySQL-only claim appeared in three database lessons.
- **Few diagrams.** Only one of the eight lessons had one.
- **Long sentences.** 21 theory sentences were over 35 words, and the lessons had no hover definitions, because each glossary entry was limited to its own track.

The rounds:

- **Questions and theory:** 27 new questions, Java and production sections in every lesson, and five accuracy fixes.
- **Practice:** every lesson has at least 6 items, at least 2 of them numericals or exercises, and every lesson's practice uses a lab.
- **Understandability:** no theory sentence is over 30 words (39 were), 7 more worked traces, and hover definitions drawn from all three tracks.
- **Diagrams:** every lesson has one, all readable at real size.
- **Java:** 7 compile-checked Java blocks, and Spring Boot, HikariCP and Resilience4j settings where they matter.
- **Labs:** two new labs, *Overload & Retries* and *Page Load Timeline*, the first labs that belong to the cross-domain track itself.

**Overall 7.8 → 9.0.** Most of the gain is practice (3.8 → 9.0) and interview readiness (7.9 → 9.0).

A note on honesty: I wrote these lessons, so this is a review of my own work. I recorded each lesson's starting scores before editing it, and practice is scored by a fixed rule. Every lesson now scores 9.0 on every dimension. That says as much about the rubric as about the lessons: nothing is scored 10, so a 9 means "meets every criterion", not "complete". The real remaining gaps are listed at the end. The tracks were scored in separate passes, and this one has 8 lessons against 48–62, so its overall number isn't directly comparable with theirs.

## How the ratings work

The same six dimensions as the other reviews, each scored 1–10. For cross-domain lessons, two of them read slightly differently:

| Dimension | What a 9 means |
|---|---|
| **Content accuracy & depth** | Correct for current Linux, PostgreSQL, the JDK and common Java frameworks; explains the mechanism at each layer. |
| **First-principles clarity** | The single operation being followed is always clear, and each layer's step follows from the problem it solves. |
| **Interview readiness** | Covers the classic cross-cutting questions *and* the follow-ups, including the Java ones, with model answers. |
| **Practice / self-testing** | Enough MCQs, numericals and exercises to check yourself, ideally hands-on. |
| **Production relevance** | Real signals at every layer (`curl -w`, `pg_stat_activity`, thread dumps, `ss`, pool metrics) and operational advice. |
| **Syllabus coverage** | Covers the named patterns and questions that system-design and backend interviews expect (cache-aside, retry budgets, fencing tokens, RPO/RTO). |

**Practice is scored by a fixed rule:**

| Items | Condition | Score |
|---|---|---|
| ≤ 3 | — | 3 |
| ≤ 3 | with a numerical or exercise | 4 |
| 4–5 | — | 5 |
| 4–5 | with ≥ 2 numericals/exercises | 6 |
| ≥ 6 | with a numerical or exercise | 7 |
| ≥ 6 | with ≥ 2 numericals/exercises | 8 |
| ≥ 6 | the same, plus practice that uses one of the site's labs or visualizations | 9 |

## Track-level scores

| Dimension | Before | After |
|---|---|---|
| Content accuracy & depth | 8.9 | **9.0** |
| First-principles clarity | 9.0 | **9.0** |
| Interview readiness | 7.9 | **9.0** |
| Practice / self-testing | 3.8 | **9.0** |
| Production relevance | 8.6 | **9.0** |
| Syllabus coverage | 8.9 | **9.0** |
| **Overall** | **7.8** | **9.0** |

## What was already strong

- **One operation, every layer.** Each journey follows a single request or query from the browser or the application down to the disk and back, naming the layer, the mechanism and the cost of each step.
- **Quantified.** Latency budgets for a page load and for an UPDATE, Little's law for pool sizing, the M/M/1 knee, group-commit throughput.
- **Failure-first.** Each lesson says what each layer looks like when it fails: the 502/503/504 table, pool exhaustion, metastable overload, lying disk caches, invalidation races.
- **Real incident patterns.** Pool exhaustion caused by an external call inside a transaction; p99 dominated by pool waits that were really slow queries; a cascading failure step by step.

## What the review found weak

1. **Thin practice.** There were 16 items across 8 lessons: 9 MCQs, 7 numericals and no exercises. No practice item used a lab.
2. **No Java mapping.** The lessons said "the framework", "the pool", "a circuit breaker". A Java developer had to work out for themselves that these mean Tomcat's 200 worker threads, HikariCP's 10 connections and its 30-second timeout, `ThreadPoolExecutor`'s rejection policies, or Resilience4j.
3. **Accuracy:**
   - The slow-endpoint example claimed that `customer_id = '42'::text` against a `bigint` column silently disabled the index. PostgreSQL raises `operator does not exist: bigint = text` instead. The real PostgreSQL trap is a `numeric` parameter (a Java `BigDecimal`), which makes it cast the column.
   - The connection-management timeout table had a garbled rule for load-balancer idle timeouts, which read as if the backend's keep-alive should be the shorter one.
4. **Few diagrams.** Only the overloaded-server lesson had one (the circuit-breaker states).
5. **Readability and glossary.** 6 theory sentences were over 45 words and 21 over 35. Cross-domain lessons got no hover definitions at all.

## Update 1: questions, theory and accuracy

- **Question bank 26 → 53.** Every lesson has at least 6, and the two that had 2 now have 6 and 7. Examples:
  - In a Spring Boot service, which threads and pools does one request pass through, and where can it queue?
  - Users see a 2-second time to first byte, but the handler took 50 ms. Where did the time go?
  - What does pgJDBC send for `executeUpdate()` and `commit()`, and what changes after five runs?
  - A Spring Boot service logs "Connection is not available, request timed out after 30000ms". What do you check?
  - The bad query was fixed an hour ago, but the service is still overloaded. How?
  - Why does a distributed lock need a fencing token, and who checks it?
  - Is a Kafka message durable once `acks=all` acknowledges it?
- **New sections, one or more per lesson:**
  - the same request inside Spring Boot on Tomcat: connection, thread and pool limits with their defaults, and where requests queue (*Website Journey*);
  - JDBC calls mapped to PostgreSQL wire messages, with pgJDBC's prepared-statement threshold (*SQL Query Journey*);
  - HikariCP: what each setting controls, sensible values, HikariCP's own sizing formula, and what exhaustion looks like in a thread dump (*Connection Management*);
  - Java diagnostics for a slow endpoint (JFR, GC logs, thread dumps, pool metrics) and JPA N+1 (*Slow Endpoint*);
  - bounded executors that shed load, and Resilience4j settings read in plain words (*Overloaded Server*);
  - cache patterns by name, stampedes and request coalescing (*Caching Everywhere*);
  - compare-and-swap at three layers in Java, and fencing tokens (*Concurrency Everywhere*);
  - the durability chain from Java (`FileChannel.force`, directory fsync) and Kafka's `acks=all` (*Durability Chain*).
- **Accuracy fixes, all checked against PostgreSQL 18 (PGlite):**
  - The slow-endpoint example now uses the real trap: a `BigDecimal` parameter makes PostgreSQL cast the `bigint` column (`Filter: ((customer_id)::numeric = '42'::numeric)`), so it scans 38 million rows instead of using the index.
  - The load-balancer rule now says the backend's keep-alive timeout must be *longer* than the load balancer's idle timeout, or users get sporadic 502s.
  - Three database lessons repeated the MySQL-only claim. *Index Fundamentals*, *Index Design* and *SQL Joins* now say which comparisons PostgreSQL rejects (`varchar = integer`, `uuid = text`, `text = bigint`) and which it silently casts (an integer column against `numeric` or `float8`).

## Update 2: practice

- **Practice 16 → 60 items:**
  - 17 MCQs;
  - 25 numericals;
  - 18 written exercises with worked solutions.

  Every lesson has at least 6 items, with at least 2 numericals or exercises.
- **All 8 lessons now have practice that uses a lab** (none did before). Each answer was worked out with the code the lab runs, or reproduced in it. Examples:
  - read a slow server's `curl -w` timings and attribute every millisecond (*Website Journey*);
  - load "Crash after COMMIT" in the WAL recovery lab and name the station that made the transfer survive (*SQL Query Journey*);
  - size a pool for 1,500 requests/s: 30 connections are 100% busy, 35 make 28.5% of requests wait, and 40 make 5.5% wait (*Connection Management*, queueing lab);
  - turn `customer_id = 4242` into `= 4242.0` in the Query Plan lab and watch the index disappear (*Slow Endpoint*);
  - a loop one page bigger than the cache drops LRU and Clock to 0 hits out of 12 (*Caching Everywhere*, page-replacement lab);
  - map a lost update in the race-condition lab onto a web shop's stock, then fix it with one atomic SQL statement (*Concurrency Everywhere*).

## Update 3: understandability

Measured on the theory sections (Mental Model through Example):

| Measure | Before | After |
|---|---|---|
| Sentences over 45 words | 6 | 0 |
| Sentences over 35 words | 21 | 0 |
| Sentences over 30 words | 39 | 0 |
| Worked examples with concrete values (`text`/`sql` traces) | 2 | 9 |
| Hover definitions | 0 | 146 first uses marked (91 distinct terms) |

- **Long sentences were rewritten, not trimmed.** Lists hidden inside sentences became bullet lists, and no facts or links were removed.
- **New traces with real values**, each a production signal you can collect yourself:
  - `curl -w` timings for each phase of a page load, matching the lesson's 180 ms example;
  - a `pg_stat_activity` snapshot in which an idle-in-transaction session blocks two UPDATEs;
  - a thread dump of request threads parked in `HikariPool.getConnection`;
  - `pg_test_fsync` output, and what a suspiciously fast result means;
  - Redis `keyspace_hits`/`keyspace_misses` turned into a hit ratio;
  - a full listen queue in `ss`, with `TcpExtListenOverflows` counting the dropped connections.
- **Hover definitions draw on all three tracks.** In a subject's own lessons, a glossary term applies only within that subject. Cross-domain lessons now use entries from every track, except the 12 whose word the tracks define differently, such as "page" (OS or database), "frame" and "RTO" (recovery time objective or retransmission timeout).
  - Five entries were kept out of lessons where they would mislead: the IP "TTL" where a cache TTL is meant, the database "heap" where the Java heap is meant, "pipe" used as a metaphor, "multiplexing" for PgBouncer, and "garbage collection" for cleaning up old row versions. One sentence was reworded because "process" was used as a verb.

## Update 4: diagrams

| Measure | Before | After |
|---|---|---|
| Lessons with a Mermaid diagram | 1 of 8 | 8 of 8 |
| Mermaid diagrams | 1 | 9 |
| Diagrams below 80% of natural size (desktop column) | — | 0 |

- **8 new diagrams:**
  - a cold page load across browser, DNS, CDN, app and database;
  - an UPDATE seen from the database's side, through the WAL and a standby;
  - fifty application pools funnelled through PgBouncer;
  - the slow-endpoint method as a decision tree;
  - the overload feedback loop (latency → in-flight → pools → timeouts → retries);
  - one read falling through seven cache levels;
  - a paused lock holder stopped by a fencing token;
  - the durability chain, each link labelled with the failure it survives.
- **Readable at real size.** Three first rendered at 57–78% of natural size. Shorter participant names, line breaks and narrower node labels brought them to 81–92%.

## Update 5: Java examples

| Code blocks | Before | After |
|---|---|---|
| Java | 0 | 7 |
| Python | 1 | 0 |
| Spring/Resilience4j properties | 0 | 2 |

- **Java where the reader would write it:**
  - the SQL journey's UPDATE as JDBC with try-with-resources, and an idempotent payment insert;
  - holding a pooled connection across a slow call, and the two-borrow fix;
  - a bounded `ThreadPoolExecutor` that turns rejection into a fast 503;
  - request coalescing for cache stampedes with `ConcurrentHashMap` and `CompletableFuture`;
  - `compareAndSet`, a version-column UPDATE and an HTTP `If-Match` PUT;
  - `FileChannel.force` and a directory fsync for the durability chain.
- **Configuration as you'd write it:** HikariCP and Resilience4j settings appear as Spring Boot properties, with each line explained.
- **Compile-checked.** All 7 blocks went through `javac` 21 with `scripts/_verify-java.mts`: 3 compile as written and 4 compile apart from names the lesson defines. None failed. The checker's imports gained `java.sql` and `javax.sql` for these lessons, and the whole site still compiles: 115 blocks, 0 failures.

## Update 6: labs

Two labs, the first that belong to this track. Widgets can now belong to the cross-domain subject, and the labs index lists them under their own heading.

- **Overload & Retries** (`/labs/overload-retries`) sends a 10-second traffic spike at a server with fixed capacity, whose clients time out and retry. You choose the workers, service time, load, timeout, attempts, backoff, a retry budget, a queue limit, and whether the server drops requests whose client has left. It charts offered load, goodput, wasted work and rejections, and how long served requests had waited. With the default server (capacity 500/s, normal load 400/s, spike 800/s, 1 s timeout):

  | Setup | Requests that succeed | Recovery after the spike |
  |---|---|---|
  | No protection (3 attempts, unbounded queue) | 13.3%, with 88% of all work wasted | never: offered load stays at 1,200/s, a metastable failure |
  | No retries | 58.1% | 26 s |
  | Retry budget only (10%) | 25.1% | 60 s |
  | Bounded queue (250) | 93.2% | immediate |
  | All defenses | 93.1% | immediate, with 1,136 retries instead of 67,960 |
- **Page Load Timeline** (`/labs/page-load`) draws the latency budget of opening a website as a waterfall. The phases are DNS, the TCP and TLS (or QUIC) handshakes, the request through a CDN edge or straight to the origin, the HTML under TCP slow start, CSS and JS, and rendering. The presets reproduce the lesson's numbers:
  - a cold visit has a 180 ms time to first byte;
  - TLS 1.2 adds a round trip: 220 ms;
  - HTTP/3 takes 140 ms, and 100 ms with 0-RTT;
  - a user 200 ms away gets 660 ms, or 295 ms behind a CDN edge 15 ms away, even though the HTML can't be cached.
- **Practice:** the website journey and overloaded-server lessons each gained lab exercises built on these numbers, and a slow-start numerical (a 50 KB page needs 3 round trips).

## Readiness by audience

| Audience | Before | After | Comment |
|---|---|---|---|
| **Freshers / campus placements** | 7.5 | **8.8** | "What happens when you type a URL" is now answered with a timeline, a diagram, a lab and numericals on round trips and slow start. The patterns lessons now name the system-design terms (cache-aside, write-behind, fencing tokens, RPO/RTO). |
| **1–3 YOE Java backend** | 7.0 | **9.0** | Every lesson now maps onto Spring Boot, Tomcat, HikariCP, JDBC, JPA, Resilience4j or Kafka, with their defaults and failure messages: the exact things these interviews and incidents involve. |
| **3–5+ YOE / system design and SRE** | 8.3 | **8.9** | Overload, retries and metastable failure can now be practised in a simulator, and every lesson shows a real signal to read (`pg_stat_activity`, thread dumps, `ss`, `pg_test_fsync`). Still no hands-on with real distributed failures. |

## What is still missing (honest gaps)

- **The labs are models.** The overload lab is a queueing simulation with a fixed service time and identical clients, and the page-load lab is round-trip arithmetic with no packet loss, no HTTP/1.1 connection limits and no real browser parsing. They teach the shapes and the orders of magnitude, not exact numbers.
- **Framework defaults were checked against their documentation, not by running the frameworks.** The Tomcat, HikariCP, pgJDBC, Resilience4j and Kafka defaults quoted here match current documentation, but no Spring Boot application was started to confirm them, and the numbers change between versions.
- **Written exercises are self-graded.** MCQs and the 25 numericals are checked automatically. The 18 written exercises rely on comparing your answer with the worked solution.
- **Some hover definitions are skipped.** A glossary entry whose word another track also defines is skipped here, even where both definitions agree (fsync, deadlock, idempotent).
- **Only 8 lessons.** Cross-cutting stories that interviews also ask about have no lesson yet:
  - a container killed for memory, through the JVM, cgroups and Kubernetes;
  - one deploy end to end;
  - the life of a Kafka message;
  - time and clocks across layers;
  - security across layers (TLS, authentication, injection).
- **The Java check isn't part of the build.** `scripts/_verify-java.mts` needs a local JDK, so it runs by hand, and none of the code is executed.

## Per-lesson scorecard

Arrows show before → after where something changed. Questions and practice items are counts; the other columns are scores. Lessons are in course order.

| Lesson | Questions | Practice items | Content | First principles | Interview | Practice | Production | Syllabus | Overall |
|---|---|---|---|---|---|---|---|---|---|
| `x-website-journey` | 4 → 7 | 2 → 9 | 9 | 9 | 8 → **9** | 4 → **9** | 8 → **9** | 9 | 7.8 → **9.0** |
| `x-sql-query-journey` | 3 → 6 | 2 → 7 | 9 | 9 | 8 → **9** | 3 → **9** | 9 | 9 | 7.8 → **9.0** |
| `x-connection-management` | 4 → 7 | 2 → 8 | 9 | 9 | 8 → **9** | 4 → **9** | 9 | 9 | 8.0 → **9.0** |
| `x-slow-query` | 3 → 6 | 2 → 7 | 8 → **9** | 9 | 8 → **9** | 3 → **9** | 9 | 9 | 7.7 → **9.0** |
| `x-overloaded-server` | 5 → 8 | 2 → 8 | 9 | 9 | 9 | 4 → **9** | 9 | 9 | 8.2 → **9.0** |
| `x-caching-everywhere` | 3 → 6 | 2 → 7 | 9 | 9 | 8 → **9** | 4 → **9** | 8 → **9** | 8 → **9** | 7.7 → **9.0** |
| `x-concurrency-everywhere` | 2 → 7 | 2 → 7 | 9 | 9 | 7 → **9** | 4 → **9** | 8 → **9** | 9 | 7.7 → **9.0** |
| `x-durability-chain` | 2 → 6 | 2 → 7 | 9 | 9 | 7 → **9** | 4 → **9** | 9 | 9 | 7.8 → **9.0** |
