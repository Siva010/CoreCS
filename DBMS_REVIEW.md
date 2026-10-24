# Database (DBMS + SQL) track — review and ratings

*First reviewed 13 October 2026, covering all 55 database lessons, then improved in six rounds. The track now has 62 lessons. Updates 5 and 6 are the first two of five batches that bring it up to the standard of the later tracks.*

## Verdict

The database track was already **strong on mechanism and production reality** — accurate, current, and unusually good at explaining *why* (MVCC, WAL, query plans, replication). The first review found three weaknesses: **interview drilling**, **textbook coverage** of the classic theory campus interviews and GATE-style exams ask about by name, and **practice** — too few items to test yourself, almost all multiple choice.

- **Update 1** doubled the question bank, added three theory lessons and filled the textbook gaps. **7.5 → 8.1.**
- **Update 2** went after practice and the missing topics: every lesson now has at least 6 practice items (half of them numericals or written exercises), the SQL Playground grows from 18 to 64 graded exercises including data changes, two new interactive labs cover the new theory, and four new lessons cover security, backups/PITR, data warehousing and PostgreSQL vs MySQL. **8.1 → 8.4.**
- **Update 3** worked on understandability: long sentences split, a worked example with real values added wherever a mechanism was only described in prose, and hover definitions for 112 database terms. **8.4 → 8.5.**
- **Update 4** added diagrams: 59 of 62 lessons now have one (22 before), every diagram was checked at its rendered size, and one that failed to render was fixed. Clarity 8.9 → 9.0; **overall stays 8.5.**
- **Update 5** (transactions, batch 1 of 5) brought the ten transaction lessons up to the standard the OS, Networks and cross-domain tracks reached later: Java and Spring in every lesson, production signals with real output, lab-based practice in all ten, and no theory sentence over 30 words. Interview 8.5 → 8.6, practice 8.3 → 8.4, production 8.1 → 8.2; **overall stays 8.5** (8.49 → 8.55 before rounding).
- **Update 6** (SQL and modeling, batch 2 of 5) did the same for the 18 lessons on the relational model, data modeling and SQL: JDBC and JPA in 15 of them, production practice such as zero-downtime schema changes, migration reconciliation and live deduplication, lab-based practice in all 18, and no theory sentence over 30 words. Interview 8.6 → 8.7, practice 8.4 → 8.5, production 8.2 → 8.4; **overall 8.5 → 8.6** (8.55 → 8.62 before rounding).

A note on honesty: I wrote these lessons, so this is a review of my own work. I scored against what a strong interviewer would expect and what a student would need, not against the effort that went in, and recorded each round's starting scores before changing anything. Scores for unchanged dimensions were not raised just because more content exists nearby.

## How the ratings work

Each lesson is scored 1–10 on six dimensions:

| Dimension | What a 9 means |
|---|---|
| **Content accuracy & depth** | Correct for current PostgreSQL/MySQL, explains the mechanism, no hand-waving. |
| **First-principles clarity** | Problem → idea → mechanism is obvious; a reader could re-derive the design. |
| **Interview readiness** | Covers the classic questions *and* the follow-ups, with model answers at L1–L3 depth plus traps. |
| **Practice / self-testing** | Enough MCQs, numericals and exercises to check yourself, ideally hands-on. |
| **Production relevance** | Failure modes, real signals, operational advice an engineer would actually use. |
| **Syllabus coverage** | Includes the textbook topics examiners and campus interviewers ask for by name. |

Practice was scored with a fixed rule in update 2, so it can't drift upward by impression: **7** = at least 6 items including a numerical or exercise; **8** = at least 6 items including two or more numericals/exercises; **9** = the same, plus practice that sends you to a graded or interactive tool (an SQL Playground exercise, a lab or a visualization). Scores above 9 were reserved for material that would be hard to improve; nothing got a 10.

## Track-level scores

| Dimension | First review (55 lessons) | After update 1 (58) | After update 2 (62) | After update 3 (62) | After update 4 (62) | After update 5 (62) | After update 6 (62) |
|---|---|---|---|---|---|---|---|
| Content accuracy & depth | 8.8 | 9.0 | 9.0 | 9.0 | 9.0 | 9.0 | **9.0** |
| First-principles clarity | 8.6 | 8.6 | 8.6 | 8.9 | 9.0 | 9.0 | **9.0** |
| Interview readiness | 6.9 | 8.6 | 8.5 | 8.5 | 8.5 | 8.6 | **8.7** |
| Practice / self-testing | 5.6 | 6.4 | 8.3 | 8.3 | 8.3 | 8.4 | **8.5** |
| Production relevance | 8.2 | 8.1 | 8.1 | 8.1 | 8.1 | 8.2 | **8.4** |
| Syllabus coverage | 7.2 | 8.1 | 8.1 | 8.1 | 8.1 | 8.1 | **8.1** |
| **Overall** | **7.5** | **8.1** | **8.4** | **8.5** | **8.5** | **8.5** | **8.6** |

Interview readiness dips by 0.1 only because the four new lessons (8 each) pull the average toward 8; no lesson lost questions.

## What was already strong

- **Accuracy.** Every version-specific claim was checked (PostgreSQL 12–18 features, InnoDB behaviour, Redis, MongoDB, Cassandra). Only one was wrong at the first review — Cassandra's Accord transactions were described as shipped in Cassandra 5, but they landed after 5.0 — and it was fixed.
- **Mechanism-first explanations.** MVCC, WAL and recovery, B+ trees vs LSM trees, the buffer pool, isolation levels, and replication lag are explained from the problem up — better than most textbooks for engineers.
- **Production realism.** Failure modes, `pg_stat_*` signals, lock queues behind DDL, bloat from idle transactions, "it only breaks under load" stories.
- **SQL.** NULL logic, joins, anti-joins, window functions and interview patterns are exactly what SQL rounds test, practised against a real PostgreSQL in the browser.

## What the first review found weak

1. **Thin question bank.** 191 interview questions across 55 lessons (3.5 per lesson); classic questions were missing — "Can a primary key be NULL?", "DELETE vs TRUNCATE rollback", "dense vs sparse index", "conflict vs view serializability".
2. **Little self-testing.** 115 practice items (2 per lesson), mostly MCQs; few numericals in the style exams use.
3. **Missing textbook theory**: schedules and serializability, the 2PL family, timestamp ordering, index classification and hashing, the three-schema architecture, Codd's rules, transaction states, shadow paging, join-cost formulas, ER table counting, cursors and triggers.

## Update 1: interview questions and textbook theory

- **3 new lessons:** *Index Types & Hashing*, *Schedules & Serializability*, *Concurrency Control Protocols*, wired into the fresher roadmap.
- **Textbook sections added to 11 lessons:** three-schema architecture and DBMS languages; Codd's rules and division; generalization/specialization and table counting; 5NF and denormalization; FD-set equivalence and super-key counting; file organizations and blocking factor; B+ tree order numericals; join-cost formulas and external sort; heuristic vs cost-based optimization; transaction states; deferred vs immediate modification; shadow paging; cursors and stored procedures.
- **Question bank 191 → 388**, practice 115 → 171.

## Update 2: practice, labs and the missing topics

- **Practice 171 → 387 items** across 62 lessons. Every lesson has at least 6; 193 are numericals or written exercises with worked solutions. Numerical answers are machine-checked against their worked solutions by the content validator.
- **SQL Playground 18 → 64 graded exercises** in seven sections (basics, aggregation, joins, subqueries & sets, window functions, interview patterns, changing data). The ten new *data-modification* exercises — UPDATE with joins, deleting in foreign-key order, deduplication without a key, upserts, CREATE TABLE AS, ALTER TABLE — run inside a transaction that is graded by the state it leaves and then rolled back. Lessons now link straight to specific exercises (`lab:sql-playground#exercise-id`, checked by the validator).
- **Every reference solution is verified against real PostgreSQL** (`scripts/_verify-sql.mts`): each runs, returns the documented columns, is deterministic, data changes actually change something and are rolled back, and 14 classic wrong answers (NOT IN with NULLs, AND/OR precedence, integer division, `count(*)` after a LEFT JOIN, `row_number` for ties, missing calendar days …) are confirmed to be **rejected**.
- **Seed fix:** the `logins` data was degenerate — the random filter only referenced `customers`, so PostgreSQL evaluated it once per customer and every user logged in on all 30 days or none, making the streak exercise trivial. It's now a deterministic per-day hash with realistic gaps.
- **Two new labs:**
  - *Schedule Analyzer* — type any schedule (`R1(A) W2(A) C1 …`) and get the precedence graph (hover an edge for the conflicting operations), conflict and view serializability with equivalent serial orders, and recoverable / cascadeless / strict verdicts with reasons; a second tab steps through basic timestamp ordering and Thomas's write rule with R-TS/W-TS per item. Verified on the textbook cases (lost update, blind writes, three-way cycles, unrecoverable and cascading-abort schedules).
  - *Extendible Hashing Simulator* — global/local depth, directory doubling vs splits without doubling, and overflow for skewed keys, checked against Ramakrishnan & Gehrke's worked example.
- **New level 16, "Databases in Practice" — 4 lessons:**
  - *Database Security*: SQL injection mechanics and why parameters fix it, identifier allowlists, roles and least privilege, row-level security for multi-tenant data (and its pooling/owner pitfalls), TLS `verify-full`, encryption layers, password hashing, auditing.
  - *Backups & Point-in-Time Recovery*: RPO/RTO, logical vs physical backups, incremental backups (PostgreSQL 17), WAL archiving and PITR step by step, the 3-2-1 rule, restore drills, MySQL equivalents.
  - *Data Warehousing*: OLTP vs OLAP, grain, facts and dimensions, star vs snowflake, slowly changing dimensions, ROLLUP/CUBE, ETL vs ELT, log-based CDC, lakes and lakehouses, and time-series data.
  - *PostgreSQL vs MySQL (InnoDB)*: heap vs clustered storage, MVCC in the table vs undo logs, default isolation and gap locks (with the lost-update difference worked out), one log vs redo + binlog, process vs thread per connection, DDL and collation differences.
- **Roadmaps:** security joins the fresher track; security, backups and PostgreSQL vs MySQL join the 1–3 YOE track; warehousing, backups and engine internals join the 3–5+ YOE track.

## Update 3: understandability

The goal: a reader who has never met a term can follow every theory section on the first read. Measured on the theory sections (Mental Model through Example) of all 62 lessons:

| Measure | Before | After |
|---|---|---|
| Sentences over 45 words | 18 | 2 |
| Sentences over 35 words | 115 | 7 |
| Sentences over 30 words | 258 | 156 |
| Worked examples with concrete values (`text` traces) | 64 | 101 |
| Database terms with a hover definition | 0 | 112 (585 first uses marked) |

What changed:

- **Worked examples where there were only words**, for example:
  - the clause-by-clause evaluation order on six rows;
  - a B+ tree leaf split;
  - an LSM tree's keys through flushes, a tombstone and compaction;
  - a clock-sweep eviction;
  - the planner's cost arithmetic for two predicates;
  - hash and merge joins on tiny inputs;
  - a crash with ARIES redo and undo;
  - the same transaction under Read Committed vs Repeatable Read;
  - a DDL lock queue taking down a table;
  - asynchronous replication losing an acknowledged write;
  - split brain, a Raft commit, and an unrolled consistent-hashing ring;
  - Spanner's commit wait as steps;
  - lossy decomposition and normalization anomalies on real rows;
  - relational operators and division on two tiny tables.
- **Sentences rewritten**, not trimmed: 108 long sentences were split, and lists hidden inside sentences became bullet lists. No facts or links were removed.
- **A glossary** (`content/glossary.ts`). The first plain use of each term in a database lesson shows a short definition on hover or tap, with a link to the lesson that explains it. Lessons that define a term themselves are skipped. Words with everyday meanings ("page", "snapshot", "fan-out") are limited to the lessons where they mean the database thing.
- **Hidden deep dives no longer leave empty sections.** A one-line "Show" row names what's inside.

First-principles clarity is estimated at the track level (8.6 → 8.9) from these measured changes; the per-lesson table below was not re-scored for this round.

## Update 4: diagrams

Most worked examples were text traces, and 40 of 62 lessons had no diagram at all.

| Measure | Before | After |
|---|---|---|
| Lessons with a diagram | 22 | 59 |
| Diagrams that failed to render | 1 | 0 |
| Diagrams shown below 80% of their natural size (desktop column) | 7 of 22 | 0 of 59 |

What changed:

- **37 new diagrams**, each placed next to the text it illustrates, for example:
  - MVCC's two ways of keeping old versions (PostgreSQL's version chain in the table vs InnoDB's undo records);
  - which anomaly you're looking at, decided by what the other transaction did;
  - when an index scan becomes index-only;
  - attribute closure step by step;
  - scan and join choice by row count;
  - a Cassandra QUORUM write with a late replica;
  - the layers of database security;
  - cache-aside reads and invalidation;
  - the plan shape that makes UNION cost more than UNION ALL;
  - the SQL interview pattern to reach for, by what the question asks.
- **A broken diagram fixed.** The WAL lesson's commit path failed to render: a `;` inside a sequence-diagram message ends the statement in Mermaid. It now shows UPDATE and COMMIT as separate steps, which is also more accurate (the page is dirtied before the commit). The content validator now rejects `;` in sequence diagrams.
- **Readable at real size.** Every diagram was measured at its rendered width. Wide left-to-right chains became top-to-bottom, wide decision fans became left-to-right, and long labels got explicit line breaks. The smallest database diagram now renders at 81% of natural size; it was 31%.
- **Renderer settings** (site-wide). Mermaid 12 re-wrapped every label line longer than 120px, breaking hand-placed lines mid-phrase; the limit is now 200px. Sequence diagrams lost their 50px side margins, which only shrank them inside an already-padded figure. Six OS and Networks diagrams that relied on the old wrapping got explicit breaks; five are now at least as large as before, and OS page faults went from 96% to 89%.

Clarity is an estimate (8.9 → 9.0): a diagram helps most where a lesson had only prose, and many of these lessons already had a worked text trace.

The three lessons without a Mermaid diagram already have a visual: an interactive visualization (consistent hashing, joins) or the evaluation order drawn as a text pipeline with a six-row trace (SELECT basics).

## Update 5: transactions in Java and production (batch 1 of 5)

The database track was improved first, and the later tracks raised the bar. By the time the cross-domain round finished, this track had 1 Java block in 62 lessons (the OS track has 94), lab-based practice in 17 lessons, and production relevance of 8.1, the lowest dimension anywhere. This round starts closing that gap, one area at a time, with the ten transaction lessons (levels 9–11).

| Measure, ten transaction lessons | Before | After |
|---|---|---|
| Java blocks | 0 (and 1 Python) | 10 (no Python) |
| Lessons whose practice uses a lab | 3 | 10 |
| Interview questions | 68 | 85 |
| Practice items | 62 | 80 |
| Theory sentences over 30 words | 20 | 0 |

What changed:

- **Java where a backend developer meets transactions:**
  - JDBC transaction control, and Spring `@Transactional`'s traps: self-invocation, checked exceptions that commit, rollback-only marking (`UnexpectedRollbackException`), and `REQUIRES_NEW` holding two connections;
  - the serializable retry loop in JDBC, replacing a Python one, and why Spring's retry must wrap the transaction from outside;
  - lost updates hidden in JPA's "load, change a field, commit", and `@Version`, including the REST trap where reloading the entity defeats the check;
  - JPA lock modes, Spring Data `@Lock`, and a JDBC job-queue worker using `SKIP LOCKED`;
  - `ReentrantReadWriteLock`'s upgrade deadlock and `StampedLock`'s optimistic read, as the textbook protocols in Java;
  - MVCC in miniature with an `AtomicReference`, a tiny WAL-backed key-value store, a checksummed log reader, and a conflict-serializability checker.

  All ten blocks compile. The four that make behavioural claims were also run: the store survives a torn last record and keeps working after it, the log reader stops at a torn or corrupted record, the checker orders the lesson's schedules correctly, and the lock upgrade and conversion behave as described.
- **Production signals with real output:**
  - `EXPLAIN (ANALYZE, WAL)`, measured on PostgreSQL 18: updating a 9.6 MB table wrote 39.6 MB of WAL right after a checkpoint and 27.2 MB without one;
  - a replication slot holding back hundreds of gigabytes of WAL, and the query that shows it;
  - PostgreSQL's deadlock report, its SSI serialization-failure message, and its crash-recovery log lines;
  - PITR settings, invariant-check queries that catch anomalies after the fact, and which sessions really hold back vacuum.
- **Accuracy:**
  - The WAL lesson's monitoring advice was out of date: checkpoint counters moved from `pg_stat_bgwriter` to `pg_stat_checkpointer` in PostgreSQL 17.
  - The MVCC lesson said any idle-in-transaction session pins vacuum's horizon. Precisely, only one holding a transaction id (it has written) or a snapshot (a running query, Repeatable Read or Serializable, an open cursor) does.
  - During the cross-domain round, *Index Fundamentals*, *Index Design* and *SQL Joins* were corrected: they described MySQL's silent casts as PostgreSQL behaviour. PostgreSQL rejects `varchar = integer`, `uuid = text` and `text = bigint`, and silently casts only an integer column compared with `numeric` or `float8`.
- **Practice: 18 new items.** Every lesson's practice now uses a lab: the WAL recovery lab (atomicity and durability, the WAL rule, a checkpoint bounding redo), the isolation lab (write skew at Repeatable Read vs Serializable, row versions), the lock manager, and the schedule analyzer's timestamp tab. Each lab answer was checked by running the lab. Two of them first described an uncommitted update being undone, when the lab, like a real engine, simply loses a log record that was never flushed; both were rewritten.
- **Textbook names:** Elmasri & Navathe's lost update, temporary update and incorrect summary problems are mapped to the modern anomaly names, with a dirty-write timeline. Oracle's and SQL Server's isolation naming is noted.
- **Re-scored:** Locking's syllabus moves from 7 to 8. The first review marked it down for 2PL variants, timestamp ordering and multiple granularity; those now have their own lesson, which Locking links, though Locking itself still teaches only the basics.

Four batches remain: SQL and modeling (18 lessons), storage and indexing (15), distributed databases (15), and the four in-practice lessons.

## Update 6: SQL and modeling from Java (batch 2 of 5)

The second batch covers the 18 lessons on the relational model, data modeling and SQL. They had good SQL and lab-graded exercises, but no Java at all: nothing showed what a query, a NULL or a join looks like from the application side, which is where a backend developer meets them.

| Measure, 18 SQL and modeling lessons | Before | After |
|---|---|---|
| Java blocks | 0 (and 1 Python) | 18, in 15 lessons (no Python) |
| Lessons whose practice uses a lab | 11 | 18 |
| Interview questions | 129 | 151 |
| Practice items | 117 | 136 |
| Theory sentences over 30 words | 42 | 0 |

What changed:

- **Java where a backend developer meets SQL:**
  - `PreparedStatement` placeholders (no injection, one reusable statement), and PostgreSQL's driver reading the whole result into memory unless autocommit is off and a fetch size is set;
  - NULL through JDBC (`getInt` returns 0), wrapper types in JPA, and `Collectors.groupingBy` throwing on the null key that SQL's `GROUP BY` groups;
  - batch inserts, `reWriteBatchedInserts` and `COPY`, and why IDENTITY keys switch off Hibernate's batching;
  - JPA fan-out: a collection `JOIN FETCH` with pagination silently paginated in memory, `MultipleBagFetchException`, and paging ids first;
  - lists as one array parameter (`= ANY (?)`), a tree loaded with one recursive CTE instead of one query per node, and top-N per group as one native query with a tie-breaker;
  - ER constructs as JPA mappings (an `Enrollment` entity for M:N with attributes, the three inheritance strategies, lazy `@ManyToOne`), Java types for money, instants, dates and UUIDs, and stored functions, procedures and trigger-set columns seen from JPA;
  - attribute closure and a candidate-key finder in Java for the FD lesson.

  All 18 blocks compile. The candidate-key finder and the `BigDecimal` example were also run, and print what the lessons say. The Java checker now imports `java.math`; before, it accepted an unknown `BigDecimal` as a name the lesson defines instead of checking it.
- **Production practice:**
  - zero-downtime schema changes (expand, backfill, switch reads, contract), and which `ADD COLUMN` forms rewrite the table: checked on PostgreSQL 18, a constant default leaves the table's file alone and `clock_timestamp()` rewrites it;
  - proving a migrated table matches with a two-way `EXCEPT`, plus chunk hashes for large tables;
  - deleting millions of duplicates on a live table in committed batches, then `CREATE UNIQUE INDEX CONCURRENTLY`;
  - a window query whose sort spilled to disk (`Sort Method: external merge`), and four ways out;
  - keeping a denormalized counter correct under concurrency, checking whether an FD actually holds in existing data, and unique violations as SQLState 23505 and Spring's `DataIntegrityViolationException`.
- **Accuracy:** each new SQL claim was run on PostgreSQL 18 (PGlite). The two-way `EXCEPT` returns 3 rows where `NOT EXISTS` with `=` returns 5, the batched delete keeps exactly the lowest id per email, and `uuidv7()` exists in 18. The aggregation example used an `Order::city` that the playground's orders don't have; it now groups customers, where customer 40 has no city.
- **Practice: 19 new items.** Every lesson's practice now uses a lab: SQL Playground exercises (relational division, deleting duplicate logins, an active flag), the normalization lab (several candidate keys, 3NF but not BCNF), and the query plan lab (a point lookup with and without its index).
- **Re-scored:**
  - Practice reaches 9 in all 18 lessons: each has at least 6 items, 2 or more numericals or exercises, and a lab.
  - Interview rises in six lessons whose new questions are ones backend interviews ask: the relational model, ER modeling, schema design, SELECT basics, set operations, and views.
  - Production rises in 13. Set operations moves the most, 6 → 8: it had two production bullets and now has a migration check. Functional dependencies moves only 5 → 6, since checking an FD in data is its one production use.
  - Production stays put in five lessons. Keys, schema design and DML were already at 9. The array parameter in Semi & Anti Joins is too small a change to move it. The Java example in Why Databases teaches the idea rather than production practice.
  - First principles and syllabus are unchanged: this batch added applications, not theory. Set operations and views keep the lowest first-principles scores in the batch (7).

Three batches remain: storage and indexing (15 lessons), distributed databases (15), and the four in-practice lessons.

## Readiness by audience

| Audience | First review | Update 1 | Update 2 | Comment |
|---|---|---|---|---|
| **Freshers / campus placements / GATE-style theory** | 6.5 | 8.5 | **8.8** | Theory is now practised, not just read: numericals in every lesson, labs for serializability, timestamp ordering and extendible hashing, and SQL injection — a common fresher question — is covered. |
| **1–3 YOE backend (SQL, indexes, transactions, MVCC)** | 8.0 | 8.7 | **9.0** | 64 graded SQL exercises including safe data changes, production-flavoured exercises (keyset pagination, partition maintenance, bloat diagnosis, deadlock-free transfers), plus security, backups and engine differences. |
| **3–5+ YOE / distributed-systems rounds** | 7.5 | 8.0 | **8.4** | Design exercises (geo-partitioning, sagas, RPO/RTO-driven backup design, warehouse modeling) and PostgreSQL vs InnoDB internals. Still conceptual: no hands-on failover or consensus drills. |

## What is still missing (honest gaps)

- **Written exercises are self-graded.** MCQs, the 119 numericals and the 71 SQL Playground exercises are checked automatically; the 96 written exercises rely on comparing your answer with the worked solution.
- **Production relevance is still the weakest dimension (8.4).** Updates 5 and 6 raised it for the 28 transaction, SQL and modeling lessons; the 34 storage, indexing, distributed and in-practice lessons wait for the next three batches.
- **Diagrams are static.** They show one moment or one decision; stepping through a B+ tree split or a replication failover still needs a lab, and only some topics have one.
- **Topics covered only as sections, not full lessons:** time-series databases, search engines (inverted indexes beyond GIN), vector databases, stream processing, and zero-downtime schema migrations at scale.
- **No hands-on distributed drills.** Replication, failover and quorum labs are simulations; nothing replaces running Patroni or a Raft cluster and breaking it.
- **Engine coverage** is PostgreSQL-first with a dedicated MySQL comparison; Oracle and SQL Server still get only occasional notes.

## Per-lesson scorecard

Scores after update 6. Arrows show each change since update 1: update 2 for every lesson, then update 5 (transactions) or update 6 (SQL and modeling) for the lessons those batches covered. The first review's before/after table is in the git history (commit 82cc651).

| Lesson | Questions | Practice items | Content | First principles | Interview | Practice | Production | Syllabus | Overall |
|---|---|---|---|---|---|---|---|---|---|
| `db-anomalies` | 6 → 7 | 2 → 6 → 8 | 9 | 9 | 9 | 5 → **9** | 8 → **9** | 7 → **9** | 7.8 → 8.5 → **9.0** |
| `db-backups-pitr` | 8 | 6 (new) | 9 | 9 | 8 | 8 | 9 | 8 | **8.5** (new) |
| `db-btree` | 7 | 3 → 6 | 9 | 9 | 9 | 8 | 8 | 9 | 8.7 |
| `db-buffer-pool` | 6 | 3 → 6 | 9 | 9 | 9 | 7 → **8** | 9 | 8 | 8.5 → **8.7** |
| `db-cap-pacelc` | 6 | 2 → 6 | 9 | 9 | 9 | 5 → **8** | 8 | 9 | 8.2 → **8.7** |
| `db-clustered-indexes` | 6 | 2 → 6 | 9 | 8 | 9 | 5 → **8** | 8 | 7 | 7.7 → **8.2** |
| `db-column-stores` | 6 | 3 → 6 | 9 | 9 | 7 | 6 → **8** | 7 | 7 | 7.5 → **7.8** |
| `db-composite-covering-indexes` | 7 | 2 → 6 | 9 | 9 | 9 | 7 → **8** | 9 | 9 | 8.7 → **8.8** |
| `db-concurrency-protocols` | 8 → 9 | 5 → 7 → 8 | 9 | 8 | 8 → **9** | 7 → 8 → **9** | 7 → **8** | 9 | 8.0 → 8.2 → **8.7** |
| `db-consistency-models` | 6 | 2 → 6 | 9 | 9 | 9 | 5 → **8** | 8 | 9 | 8.2 → **8.7** |
| `db-consistent-hashing` | 6 | 2 → 6 | 9 | 9 | 9 | 6 → **9** | 8 | 9 | 8.3 → **8.8** |
| `db-crash-recovery` | 6 → 8 | 3 → 6 → 8 | 9 | 9 | 8 → **9** | 6 → 8 → **9** | 8 → **9** | 8 | 8.0 → 8.3 → **8.8** |
| `db-data-warehousing` | 8 | 6 (new) | 8 | 8 | 8 | 8 | 7 | 8 | **7.8** (new) |
| `db-distributed-sql` | 6 | 2 → 6 | 9 | 8 | 8 | 5 → **8** | 8 | 8 | 7.7 → **8.2** |
| `db-distributed-transactions` | 6 | 3 → 6 | 9 | 9 | 9 | 6 → **8** | 9 | 8 | 8.3 → **8.7** |
| `db-document-stores` | 6 | 2 → 6 | 9 | 8 | 9 | 5 → **8** | 8 | 8 | 7.8 → **8.3** |
| `db-er-modeling` | 6 → 8 | 3 → 6 → 7 | 9 | 8 | 8 → **9** | 6 → 8 → **9** | 7 → **8** | 8 | 7.7 → 8.0 → **8.5** |
| `db-explain` | 6 | 2 → 6 | 9 | 8 | 9 | 6 → **8** | 9 | 8 | 8.2 → **8.5** |
| `db-failover` | 6 | 3 → 6 | 9 | 9 | 9 | 6 → **8** | 9 | 8 | 8.3 → **8.7** |
| `db-functional-dependencies` | 6 → 7 | 3 → 6 → 7 | 9 | 8 | 8 | 7 → 8 → **9** | 5 → **6** | 8 | 7.5 → 7.7 → **8.0** |
| `db-graph-databases` | 6 | 2 → 6 | 8 | 8 | 7 | 5 → **8** | 7 | 7 | 7.0 → **7.5** |
| `db-index-design-practice` | 6 | 2 → 6 | 9 | 8 | 9 | 6 → **8** | 9 | 8 | 8.2 → **8.5** |
| `db-index-fundamentals` | 8 | 3 → 6 | 9 | 9 | 9 | 6 → **8** | 9 | 7 | 8.2 → **8.5** |
| `db-index-types-hashing` | 8 | 5 → 7 | 9 | 8 | 8 | 8 → **9** | 6 | 9 | 8.0 → **8.2** |
| `db-isolation-levels` | 7 → 9 | 2 → 6 → 8 | 9 | 9 | 9 | 6 → 8 → **9** | 9 | 8 | 8.3 → 8.7 → **8.8** |
| `db-keys-constraints` | 8 → 10 | 4 → 7 → 9 | 9 | 9 | 9 | 8 → **9** | 9 | 8 | 8.7 → **8.8** |
| `db-locking` | 8 → 10 | 2 → 6 → 8 | 9 | 8 | 9 | 6 → **9** | 9 | 7 → **8** | 8.0 → 8.5 → **8.7** |
| `db-lsm-trees` | 6 | 3 → 6 | 9 | 9 | 9 | 6 → **8** | 8 | 8 | 8.2 → **8.5** |
| `db-mvcc` | 6 → 7 | 2 → 6 → 7 | 9 | 9 | 8 → **9** | 5 → 8 → **9** | 9 | 9 | 8.2 → 8.7 → **9.0** |
| `db-normalization` | 7 → 8 | 4 → 7 → 8 | 9 | 9 | 9 | 9 | 8 → **9** | 8 | 8.7 → **8.8** |
| `db-nosql-landscape` | 6 | 3 → 6 | 9 | 8 | 9 | 6 → **7** | 8 | 9 | 8.2 → **8.3** |
| `db-optimistic-pessimistic` | 6 → 8 | 2 → 6 → 8 | 9 | 9 | 9 | 5 → 8 → **9** | 8 → **9** | 8 | 8.0 → 8.5 → **8.8** |
| `db-pages-records` | 6 | 4 → 7 | 9 | 9 | 8 | 7 → **8** | 7 | 8 | 8.0 → **8.2** |
| `db-partitioning` | 6 | 2 → 6 | 9 | 9 | 9 | 5 → **8** | 9 | 9 | 8.3 → **8.8** |
| `db-postgres-vs-mysql` | 7 | 6 (new) | 9 | 9 | 8 | 8 | 9 | 7 | **8.3** (new) |
| `db-query-lifecycle` | 6 | 2 → 6 | 9 | 9 | 8 | 5 → **8** | 8 | 8 | 7.8 → **8.3** |
| `db-query-optimization` | 7 | 3 → 6 | 9 | 8 | 9 | 7 → **8** | 9 | 7 | 8.2 → **8.3** |
| `db-quorums-consensus` | 6 | 3 → 6 | 9 | 9 | 9 | 7 → **9** | 8 | 8 | 8.3 → **8.7** |
| `db-redis-caching` | 8 | 2 → 6 | 9 | 9 | 9 | 6 → **8** | 9 | 9 | 8.5 → **8.8** |
| `db-relational-model` | 7 → 9 | 4 → 7 → 8 | 9 | 8 | 7 → **8** | 7 → 8 → **9** | 6 → **7** | 8 | 7.5 → 7.7 → **8.2** |
| `db-replication` | 7 | 3 → 6 | 9 | 9 | 9 | 7 → **8** | 9 | 8 | 8.5 → **8.7** |
| `db-scans-joins` | 6 | 4 → 6 | 9 | 9 | 9 | 7 → **8** | 8 | 8 | 8.3 → **8.5** |
| `db-schedules-serializability` | 8 → 9 | 5 → 7 → 8 | 9 | 9 | 8 → **9** | 8 → **9** | 6 → **7** | 9 | 8.2 → 8.3 → **8.7** |
| `db-schema-design` | 6 → 8 | 3 → 6 → 8 | 9 | 8 | 8 → **9** | 6 → 8 → **9** | 9 | 8 | 8.0 → 8.3 → **8.7** |
| `db-security` | 9 | 8 (new) | 8 | 9 | 8 | 8 | 9 | 8 | **8.3** (new) |
| `db-sharding` | 7 | 3 → 6 | 9 | 9 | 9 | 7 → **8** | 9 | 8 | 8.5 → **8.7** |
| `db-specialized-indexes` | 6 | 2 → 6 | 9 | 8 | 9 | 5 → **8** | 8 | 7 | 7.7 → **8.2** |
| `db-transactions-acid` | 7 → 10 | 3 → 6 → 9 | 9 | 9 | 9 | 6 → 8 → **9** | 9 | 8 | 8.3 → 8.7 → **8.8** |
| `db-wal-durability` | 6 → 8 | 3 → 6 → 8 | 9 | 9 | 8 → **9** | 6 → 8 → **9** | 9 | 8 | 8.2 → 8.5 → **8.8** |
| `db-why-databases` | 8 → 9 | 4 → 7 → 8 | 9 | 9 | 8 | 7 → 8 → **9** | 8 | 8 | 8.2 → 8.3 → **8.5** |
| `db-wide-column` | 6 | 3 → 6 | 9 | 8 | 9 | 6 → **8** | 8 | 8 | 8.0 → **8.3** |
| `sql-aggregation` | 9 → 10 | 4 → 7 → 8 | 9 | 8 | 9 | 8 → **9** | 8 → **9** | 9 | 8.5 → 8.7 → **8.8** |
| `sql-dml-ddl` | 7 → 8 | 4 → 7 → 8 | 9 | 8 | 9 | 8 → **9** | 9 | 8 | 8.5 → **8.7** |
| `sql-interview-patterns` | 9 → 10 | 2 → 7 | 9 | 8 | 9 | 6 → **9** | 8 → **9** | 8 | 8.0 → 8.5 → **8.7** |
| `sql-joins` | 8 → 9 | 3 → 6 → 7 | 9 | 9 | 9 | 8 → **9** | 8 → **9** | 8 | 8.5 → 8.7 → **8.8** |
| `sql-null-logic` | 7 → 8 | 5 → 7 → 8 | 9 | 9 | 9 | 9 | 8 → **9** | 9 | 8.8 → **9.0** |
| `sql-select-basics` | 7 → 8 | 3 → 6 → 7 | 9 | 8 | 8 → **9** | 6 → **9** | 8 → **9** | 8 | 7.8 → 8.3 → **8.7** |
| `sql-semi-anti-joins` | 6 → 7 | 3 → 6 → 7 | 9 | 9 | 9 | 7 → **9** | 8 | 8 | 8.3 → **8.7** |
| `sql-set-operations` | 6 → 7 | 3 → 6 → 7 | 9 | 7 | 7 → **8** | 7 → **9** | 6 → **8** | 8 | 7.3 → 7.7 → **8.2** |
| `sql-subqueries-ctes` | 7 → 8 | 3 → 6 → 7 | 9 | 8 | 9 | 7 → **9** | 8 → **9** | 8 | 8.2 → 8.5 → **8.7** |
| `sql-views-programmability` | 7 → 8 | 3 → 6 → 7 | 9 | 7 | 7 → **8** | 6 → **9** | 8 → **9** | 8 | 7.5 → 8.0 → **8.3** |
| `sql-window-functions` | 8 → 9 | 4 → 7 → 8 | 9 | 9 | 9 | 8 → **9** | 8 → **9** | 9 | 8.7 → 8.8 → **9.0** |
