# Database (DBMS + SQL) track — review and ratings

*First reviewed 13 October 2026, covering all 55 database lessons, then improved in three rounds. The track now has 62 lessons.*

## Verdict

The database track was already **strong on mechanism and production reality** — accurate, current, and unusually good at explaining *why* (MVCC, WAL, query plans, replication). The first review found three weaknesses: **interview drilling**, **textbook coverage** of the classic theory campus interviews and GATE-style exams ask about by name, and **practice** — too few items to test yourself, almost all multiple choice.

- **Update 1** doubled the question bank, added three theory lessons and filled the textbook gaps. **7.5 → 8.1.**
- **Update 2** went after practice and the missing topics: every lesson now has at least 6 practice items (half of them numericals or written exercises), the SQL Playground grows from 18 to 64 graded exercises including data changes, two new interactive labs cover the new theory, and four new lessons cover security, backups/PITR, data warehousing and PostgreSQL vs MySQL. **8.1 → 8.4.**
- **Update 3** worked on understandability: long sentences split, a worked example with real values added wherever a mechanism was only described in prose, and hover definitions for 112 database terms. **8.4 → 8.5.**

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

| Dimension | First review (55 lessons) | After update 1 (58) | After update 2 (62) | After update 3 (62) |
|---|---|---|---|---|
| Content accuracy & depth | 8.8 | 9.0 | 9.0 | **9.0** |
| First-principles clarity | 8.6 | 8.6 | 8.6 | **8.9** |
| Interview readiness | 6.9 | 8.6 | 8.5 | **8.5** |
| Practice / self-testing | 5.6 | 6.4 | 8.3 | **8.3** |
| Production relevance | 8.2 | 8.1 | 8.1 | **8.1** |
| Syllabus coverage | 7.2 | 8.1 | 8.1 | **8.1** |
| **Overall** | **7.5** | **8.1** | **8.4** | **8.5** |

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

## Readiness by audience

| Audience | First review | Update 1 | Update 2 | Comment |
|---|---|---|---|---|
| **Freshers / campus placements / GATE-style theory** | 6.5 | 8.5 | **8.8** | Theory is now practised, not just read: numericals in every lesson, labs for serializability, timestamp ordering and extendible hashing, and SQL injection — a common fresher question — is covered. |
| **1–3 YOE backend (SQL, indexes, transactions, MVCC)** | 8.0 | 8.7 | **9.0** | 64 graded SQL exercises including safe data changes, production-flavoured exercises (keyset pagination, partition maintenance, bloat diagnosis, deadlock-free transfers), plus security, backups and engine differences. |
| **3–5+ YOE / distributed-systems rounds** | 7.5 | 8.0 | **8.4** | Design exercises (geo-partitioning, sagas, RPO/RTO-driven backup design, warehouse modeling) and PostgreSQL vs InnoDB internals. Still conceptual: no hands-on failover or consensus drills. |

## What is still missing (honest gaps)

- **Written exercises are self-graded.** MCQs, the 113 numericals and the 64 SQL Playground exercises are checked automatically; the 80 written exercises rely on comparing your answer with the worked solution.
- **Production relevance didn't move (8.1).** The rounds so far added practice, breadth and clarity, not more operational depth.
- **Diagrams are still missing in many lessons.** 40 of 62 have no Mermaid diagram; most of the new worked examples are text traces. Diagrams for B+ tree splits, MVCC version chains and replication topologies would help visual learners.
- **Topics covered only as sections, not full lessons:** time-series databases, search engines (inverted indexes beyond GIN), vector databases, stream processing, and zero-downtime schema migrations at scale.
- **No hands-on distributed drills.** Replication, failover and quorum labs are simulations; nothing replaces running Patroni or a Raft cluster and breaking it.
- **Engine coverage** is PostgreSQL-first with a dedicated MySQL comparison; Oracle and SQL Server still get only occasional notes.

## Per-lesson scorecard

Scores after update 2. Arrows show update 1 → update 2 where something changed; the first review's before/after table is in the git history (commit 82cc651).

| Lesson | Questions | Practice items | Content | First principles | Interview | Practice | Production | Syllabus | Overall |
|---|---|---|---|---|---|---|---|---|---|
| `db-anomalies` | 6 | 2 → 6 | 9 | 9 | 9 | 5 → **9** | 8 | 7 | 7.8 → **8.5** |
| `db-backups-pitr` | 8 | 6 (new) | 9 | 9 | 8 | 8 | 9 | 8 | **8.5** (new) |
| `db-btree` | 7 | 3 → 6 | 9 | 9 | 9 | 8 | 8 | 9 | 8.7 |
| `db-buffer-pool` | 6 | 3 → 6 | 9 | 9 | 9 | 7 → **8** | 9 | 8 | 8.5 → **8.7** |
| `db-cap-pacelc` | 6 | 2 → 6 | 9 | 9 | 9 | 5 → **8** | 8 | 9 | 8.2 → **8.7** |
| `db-clustered-indexes` | 6 | 2 → 6 | 9 | 8 | 9 | 5 → **8** | 8 | 7 | 7.7 → **8.2** |
| `db-column-stores` | 6 | 3 → 6 | 9 | 9 | 7 | 6 → **8** | 7 | 7 | 7.5 → **7.8** |
| `db-composite-covering-indexes` | 7 | 2 → 6 | 9 | 9 | 9 | 7 → **8** | 9 | 9 | 8.7 → **8.8** |
| `db-concurrency-protocols` | 8 | 5 → 7 | 9 | 8 | 8 | 7 → **8** | 7 | 9 | 8.0 → **8.2** |
| `db-consistency-models` | 6 | 2 → 6 | 9 | 9 | 9 | 5 → **8** | 8 | 9 | 8.2 → **8.7** |
| `db-consistent-hashing` | 6 | 2 → 6 | 9 | 9 | 9 | 6 → **9** | 8 | 9 | 8.3 → **8.8** |
| `db-crash-recovery` | 6 | 3 → 6 | 9 | 9 | 8 | 6 → **8** | 8 | 8 | 8.0 → **8.3** |
| `db-data-warehousing` | 8 | 6 (new) | 8 | 8 | 8 | 8 | 7 | 8 | **7.8** (new) |
| `db-distributed-sql` | 6 | 2 → 6 | 9 | 8 | 8 | 5 → **8** | 8 | 8 | 7.7 → **8.2** |
| `db-distributed-transactions` | 6 | 3 → 6 | 9 | 9 | 9 | 6 → **8** | 9 | 8 | 8.3 → **8.7** |
| `db-document-stores` | 6 | 2 → 6 | 9 | 8 | 9 | 5 → **8** | 8 | 8 | 7.8 → **8.3** |
| `db-er-modeling` | 6 | 3 → 6 | 9 | 8 | 8 | 6 → **8** | 7 | 8 | 7.7 → **8.0** |
| `db-explain` | 6 | 2 → 6 | 9 | 8 | 9 | 6 → **8** | 9 | 8 | 8.2 → **8.5** |
| `db-failover` | 6 | 3 → 6 | 9 | 9 | 9 | 6 → **8** | 9 | 8 | 8.3 → **8.7** |
| `db-functional-dependencies` | 6 | 3 → 6 | 9 | 8 | 8 | 7 → **8** | 5 | 8 | 7.5 → **7.7** |
| `db-graph-databases` | 6 | 2 → 6 | 8 | 8 | 7 | 5 → **8** | 7 | 7 | 7.0 → **7.5** |
| `db-index-design-practice` | 6 | 2 → 6 | 9 | 8 | 9 | 6 → **8** | 9 | 8 | 8.2 → **8.5** |
| `db-index-fundamentals` | 8 | 3 → 6 | 9 | 9 | 9 | 6 → **8** | 9 | 7 | 8.2 → **8.5** |
| `db-index-types-hashing` | 8 | 5 → 7 | 9 | 8 | 8 | 8 → **9** | 6 | 9 | 8.0 → **8.2** |
| `db-isolation-levels` | 7 | 2 → 6 | 9 | 9 | 9 | 6 → **8** | 9 | 8 | 8.3 → **8.7** |
| `db-keys-constraints` | 8 | 4 → 7 | 9 | 9 | 9 | 8 | 9 | 8 | 8.7 |
| `db-locking` | 8 | 2 → 6 | 9 | 8 | 9 | 6 → **9** | 9 | 7 | 8.0 → **8.5** |
| `db-lsm-trees` | 6 | 3 → 6 | 9 | 9 | 9 | 6 → **8** | 8 | 8 | 8.2 → **8.5** |
| `db-mvcc` | 6 | 2 → 6 | 9 | 9 | 8 | 5 → **8** | 9 | 9 | 8.2 → **8.7** |
| `db-normalization` | 7 | 4 → 7 | 9 | 9 | 9 | 9 | 8 | 8 | 8.7 |
| `db-nosql-landscape` | 6 | 3 → 6 | 9 | 8 | 9 | 6 → **7** | 8 | 9 | 8.2 → **8.3** |
| `db-optimistic-pessimistic` | 6 | 2 → 6 | 9 | 9 | 9 | 5 → **8** | 8 | 8 | 8.0 → **8.5** |
| `db-pages-records` | 6 | 4 → 7 | 9 | 9 | 8 | 7 → **8** | 7 | 8 | 8.0 → **8.2** |
| `db-partitioning` | 6 | 2 → 6 | 9 | 9 | 9 | 5 → **8** | 9 | 9 | 8.3 → **8.8** |
| `db-postgres-vs-mysql` | 7 | 6 (new) | 9 | 9 | 8 | 8 | 9 | 7 | **8.3** (new) |
| `db-query-lifecycle` | 6 | 2 → 6 | 9 | 9 | 8 | 5 → **8** | 8 | 8 | 7.8 → **8.3** |
| `db-query-optimization` | 7 | 3 → 6 | 9 | 8 | 9 | 7 → **8** | 9 | 7 | 8.2 → **8.3** |
| `db-quorums-consensus` | 6 | 3 → 6 | 9 | 9 | 9 | 7 → **9** | 8 | 8 | 8.3 → **8.7** |
| `db-redis-caching` | 8 | 2 → 6 | 9 | 9 | 9 | 6 → **8** | 9 | 9 | 8.5 → **8.8** |
| `db-relational-model` | 7 | 4 → 7 | 9 | 8 | 7 | 7 → **8** | 6 | 8 | 7.5 → **7.7** |
| `db-replication` | 7 | 3 → 6 | 9 | 9 | 9 | 7 → **8** | 9 | 8 | 8.5 → **8.7** |
| `db-scans-joins` | 6 | 4 → 6 | 9 | 9 | 9 | 7 → **8** | 8 | 8 | 8.3 → **8.5** |
| `db-schedules-serializability` | 8 | 5 → 7 | 9 | 9 | 8 | 8 → **9** | 6 | 9 | 8.2 → **8.3** |
| `db-schema-design` | 6 | 3 → 6 | 9 | 8 | 8 | 6 → **8** | 9 | 8 | 8.0 → **8.3** |
| `db-security` | 9 | 8 (new) | 8 | 9 | 8 | 8 | 9 | 8 | **8.3** (new) |
| `db-sharding` | 7 | 3 → 6 | 9 | 9 | 9 | 7 → **8** | 9 | 8 | 8.5 → **8.7** |
| `db-specialized-indexes` | 6 | 2 → 6 | 9 | 8 | 9 | 5 → **8** | 8 | 7 | 7.7 → **8.2** |
| `db-transactions-acid` | 7 | 3 → 6 | 9 | 9 | 9 | 6 → **8** | 9 | 8 | 8.3 → **8.7** |
| `db-wal-durability` | 6 | 3 → 6 | 9 | 9 | 8 | 6 → **8** | 9 | 8 | 8.2 → **8.5** |
| `db-why-databases` | 8 | 4 → 7 | 9 | 9 | 8 | 7 → **8** | 8 | 8 | 8.2 → **8.3** |
| `db-wide-column` | 6 | 3 → 6 | 9 | 8 | 9 | 6 → **8** | 8 | 8 | 8.0 → **8.3** |
| `sql-aggregation` | 9 | 4 → 7 | 9 | 8 | 9 | 8 → **9** | 8 | 9 | 8.5 → **8.7** |
| `sql-dml-ddl` | 7 | 4 → 7 | 9 | 8 | 9 | 8 → **9** | 9 | 8 | 8.5 → **8.7** |
| `sql-interview-patterns` | 9 | 2 → 7 | 9 | 8 | 9 | 6 → **9** | 8 | 8 | 8.0 → **8.5** |
| `sql-joins` | 8 | 3 → 6 | 9 | 9 | 9 | 8 → **9** | 8 | 8 | 8.5 → **8.7** |
| `sql-null-logic` | 7 | 5 → 7 | 9 | 9 | 9 | 9 | 8 | 9 | 8.8 |
| `sql-select-basics` | 7 | 3 → 6 | 9 | 8 | 8 | 6 → **9** | 8 | 8 | 7.8 → **8.3** |
| `sql-semi-anti-joins` | 6 | 3 → 6 | 9 | 9 | 9 | 7 → **9** | 8 | 8 | 8.3 → **8.7** |
| `sql-set-operations` | 6 | 3 → 6 | 9 | 7 | 7 | 7 → **9** | 6 | 8 | 7.3 → **7.7** |
| `sql-subqueries-ctes` | 7 | 3 → 6 | 9 | 8 | 9 | 7 → **9** | 8 | 8 | 8.2 → **8.5** |
| `sql-views-programmability` | 7 | 3 → 6 | 9 | 7 | 7 | 6 → **9** | 8 | 8 | 7.5 → **8.0** |
| `sql-window-functions` | 8 | 4 → 7 | 9 | 9 | 9 | 8 → **9** | 8 | 9 | 8.7 → **8.8** |
