# Database (DBMS + SQL) track — review and ratings

*Reviewed 13 October 2026, covering all 55 database lessons, then updated. The track now has 58 lessons.*

## Verdict

The database track was already **strong on mechanism and production reality** — accurate, current, and unusually good at explaining *why* (MVCC, WAL, query plans, replication). Its two real weaknesses were **interview drilling** (about 3.5 questions and 2 practice items per lesson) and **textbook coverage**: the classic DBMS theory that campus interviews and GATE-style exams ask about by name was thin or missing.

This update roughly doubles the question bank, adds three theory lessons, and fills the textbook gaps inside eleven existing lessons. **Overall: 7.5 → 8.1 out of 10.**

A note on honesty: I wrote these lessons in earlier sessions, so this is a review of my own work. I scored against what a strong interviewer would expect and what a student would need, not against the effort that went in. The "before" scores were recorded before any change was made.

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

Scores above 9 were reserved for material that would be hard to improve; nothing got a 10.

## Track-level scores

| Dimension | Before (55 lessons) | After (58 lessons) |
|---|---|---|
| Content accuracy & depth | 8.8 | 9.0 |
| First-principles clarity | 8.6 | 8.6 |
| Interview readiness | 6.9 | 8.6 |
| Practice / self-testing | 5.6 | 6.4 |
| Production relevance | 8.2 | 8.1 |
| Syllabus coverage | 7.2 | 8.1 |
| **Overall** | **7.5** | **8.1** |

## What was already strong

- **Accuracy.** Every version-specific claim was checked (PostgreSQL 12–18 features, InnoDB behaviour, Redis, MongoDB, Cassandra). Only one was wrong: Cassandra's Accord transactions were described as shipped in Cassandra 5, but they landed after 5.0. Fixed.
- **Mechanism-first explanations.** MVCC, WAL and recovery, B+ trees vs LSM trees, the buffer pool, isolation levels, and replication lag are explained from the problem up — better than most textbooks for engineers.
- **Production realism.** Failure modes, `pg_stat_*` signals, lock queues behind DDL, bloat from idle transactions, PMTU-style "it only breaks under load" stories.
- **SQL.** NULL logic, joins, anti-joins, window functions and the interview-patterns lesson are exactly what SQL rounds test, and the in-browser PostgreSQL playground lets you run them.

## What was weak (before this update)

1. **Thin question bank.** 191 interview questions across 55 lessons (3.5 per lesson); some lessons had 2. Classic questions were missing — "Can a primary key be NULL?", "DELETE vs TRUNCATE rollback", "dense vs sparse index", "conflict vs view serializability", "wait-die vs wound-wait".
2. **Little self-testing.** 115 practice items (2 per lesson), mostly MCQs; few numericals in the style exams use.
3. **Missing textbook theory**, which campus interviews and GATE ask about by name:
   - schedules, conflict/view serializability, precedence graphs, recoverable/cascadeless/strict schedules;
   - the 2PL family, intention locks, timestamp ordering, Thomas's write rule, validation-based protocols;
   - dense/sparse and primary/clustering/secondary indexes, multilevel-index arithmetic, static/extendible/linear hashing;
   - the three-schema architecture, DDL/DML/DCL/TCL, Codd's rules, relational division;
   - transaction states, deferred vs immediate modification, shadow paging;
   - join-cost formulas and external sort; B+ tree order numericals; file organization and blocking factor;
   - generalization/specialization/aggregation and "minimum number of tables" ER numericals;
   - cursors, stored procedures vs functions, trigger types, updatable views; GRANT/REVOKE.

## What this update changed

- **3 new lessons:** *Index Types & Hashing*, *Schedules & Serializability*, *Concurrency Control Protocols* — each with worked numericals, 8 interview questions and 5 practice items, wired into the fresher roadmap.
- **New textbook sections in existing lessons:** three-schema architecture and DBMS languages; Codd's rules and division; generalization/specialization/aggregation and table counting; 5NF and denormalization; FD-set equivalence and super-key counting; file organizations and blocking factor; B+ tree order numericals; join-cost formulas and external sort; heuristic vs cost-based optimization; transaction states; deferred vs immediate modification; shadow paging and textbook checkpoint recovery; cursors and stored procedures.
- **Question bank: 191 → 388** interview questions (every lesson now has at least 6), **practice: 115 → 171** items, with numericals whose answers are machine-checked by the validator.
- **Accuracy:** one factual fix (Cassandra Accord), plus several answers tightened while adding questions.

## Readiness by audience

| Audience | Before | After | Comment |
|---|---|---|---|
| **Freshers / campus placements / GATE-style theory** | 6.5 | **8.5** | The textbook gaps were the main problem; they're now covered with numericals. |
| **1–3 YOE backend (SQL, indexes, transactions, MVCC)** | 8.0 | **8.7** | Was already good; more follow-up questions now. |
| **3–5+ YOE / distributed-systems rounds** | 7.5 | **8.0** | Accurate and well connected, but conceptual — no hands-on Raft or failover drills, and judgment comes from operating systems, not reading. |

## What is still missing (honest gaps)

- **Practice is still the weakest dimension (6.4).** About 3 items per lesson, mostly MCQs. Only the SQL playground's 18 graded exercises are truly hands-on. More SQL exercises graded against PostgreSQL would be the single biggest improvement.
- **No interactive widgets for the new theory:** a precedence-graph / serializability checker, an extendible-hashing simulator and a timestamp-ordering stepper would fit the site's labs well.
- **Topics not covered at all:**
  - data warehousing (star/snowflake schemas, fact and dimension tables, slowly changing dimensions);
  - database security (SQL injection, row-level security in depth, encryption at rest/in transit, auditing);
  - backup and restore operations as a practised skill (PITR drills, `pg_basebackup`, restore testing);
  - CDC/ETL pipelines beyond the outbox pattern;
  - time-series databases.
- **Engine coverage is PostgreSQL-first.** MySQL/InnoDB differences are called out where they matter; Oracle and SQL Server get only occasional notes.
- **Production relevance of the new lessons is lower (6–7)** by nature: they teach theory interviewers ask about, not things you tune in production. Each one links to the practical lesson that applies it.

## Per-lesson scorecard

Arrows show before → after; a bold number changed in this update.

| Lesson | Questions | Practice items | Content | First principles | Interview | Practice | Production | Syllabus | Overall |
|---|---|---|---|---|---|---|---|---|---|
| `db-anomalies` | 3 → 6 | 2 → 2 | 9 | 9 | 7 → **9** | 5 | 8 | 6 → **7** | 7.3 → **7.8** |
| `db-btree` | 4 → 7 | 2 → 3 | 9 | 9 | 8 → **9** | 7 → **8** | 8 | 7 → **9** | 8.0 → **8.7** |
| `db-buffer-pool` | 3 → 6 | 2 → 3 | 9 | 9 | 7 → **9** | 6 → **7** | 9 | 8 | 8.0 → **8.5** |
| `db-cap-pacelc` | 3 → 6 | 2 → 2 | 9 | 9 | 7 → **9** | 5 | 8 | 9 | 7.8 → **8.2** |
| `db-clustered-indexes` | 3 → 6 | 2 → 2 | 9 | 8 | 7 → **9** | 5 | 8 | 7 | 7.3 → **7.7** |
| `db-column-stores` | 2 → 6 | 2 → 3 | 8 → **9** | 9 | 5 → **7** | 5 → **6** | 7 | 7 | 6.8 → **7.5** |
| `db-composite-covering-indexes` | 4 → 7 | 2 → 2 | 9 | 9 | 8 → **9** | 7 | 9 | 9 | 8.5 → **8.7** |
| `db-concurrency-protocols` | 8 (new) | 5 (new) | 9 | 8 | 8 | 7 | 7 | 9 | **8.0** (new) |
| `db-consistency-models` | 3 → 6 | 2 → 2 | 9 | 9 | 7 → **9** | 5 | 8 | 9 | 7.8 → **8.2** |
| `db-consistent-hashing` | 3 → 6 | 2 → 2 | 9 | 9 | 7 → **9** | 6 | 8 | 9 | 8.0 → **8.3** |
| `db-crash-recovery` | 3 → 6 | 2 → 3 | 9 | 9 | 6 → **8** | 5 → **6** | 8 | 6 → **8** | 7.2 → **8.0** |
| `db-distributed-sql` | 3 → 6 | 2 → 2 | 9 | 8 | 6 → **8** | 5 | 8 | 8 | 7.3 → **7.7** |
| `db-distributed-transactions` | 3 → 6 | 2 → 3 | 9 | 9 | 7 → **9** | 5 → **6** | 9 | 8 | 7.8 → **8.3** |
| `db-document-stores` | 3 → 6 | 2 → 2 | 8 → **9** | 8 | 7 → **9** | 5 | 8 | 8 | 7.3 → **7.8** |
| `db-er-modeling` | 3 → 6 | 2 → 3 | 8 → **9** | 8 | 6 → **8** | 5 → **6** | 7 | 5 → **8** | 6.5 → **7.7** |
| `db-explain` | 3 → 6 | 2 → 2 | 9 | 8 | 7 → **9** | 6 | 9 | 8 | 7.8 → **8.2** |
| `db-failover` | 3 → 6 | 2 → 3 | 9 | 9 | 7 → **9** | 5 → **6** | 9 | 8 | 7.8 → **8.3** |
| `db-functional-dependencies` | 3 → 6 | 2 → 3 | 9 | 8 | 6 → **8** | 6 → **7** | 5 | 7 → **8** | 6.8 → **7.5** |
| `db-graph-databases` | 2 → 6 | 2 → 2 | 8 | 8 | 5 → **7** | 5 | 7 | 7 | 6.7 → **7.0** |
| `db-index-design-practice` | 3 → 6 | 2 → 2 | 9 | 8 | 7 → **9** | 6 | 9 | 8 | 7.8 → **8.2** |
| `db-index-fundamentals` | 4 → 8 | 2 → 3 | 9 | 9 | 7 → **9** | 5 → **6** | 9 | 5 → **7** | 7.3 → **8.2** |
| `db-index-types-hashing` | 8 (new) | 5 (new) | 9 | 8 | 8 | 8 | 6 | 9 | **8.0** (new) |
| `db-isolation-levels` | 4 → 7 | 2 → 2 | 9 | 9 | 8 → **9** | 6 | 9 | 8 | 8.2 → **8.3** |
| `db-keys-constraints` | 5 → 8 | 3 → 4 | 9 | 9 | 7 → **9** | 7 → **8** | 9 | 8 | 8.2 → **8.7** |
| `db-locking` | 5 → 8 | 2 → 2 | 9 | 8 | 8 → **9** | 6 | 9 | 6 → **7** | 7.7 → **8.0** |
| `db-lsm-trees` | 3 → 6 | 2 → 3 | 9 | 9 | 7 → **9** | 5 → **6** | 8 | 8 | 7.7 → **8.2** |
| `db-mvcc` | 3 → 6 | 2 → 2 | 9 | 9 | 6 → **8** | 5 | 9 | 8 → **9** | 7.7 → **8.2** |
| `db-normalization` | 4 → 7 | 3 → 4 | 9 | 9 | 8 → **9** | 8 → **9** | 8 | 7 → **8** | 8.2 → **8.7** |
| `db-nosql-landscape` | 3 → 6 | 2 → 3 | 8 → **9** | 8 | 7 → **9** | 5 → **6** | 8 | 8 → **9** | 7.3 → **8.2** |
| `db-optimistic-pessimistic` | 3 → 6 | 2 → 2 | 9 | 9 | 7 → **9** | 5 | 8 | 7 → **8** | 7.5 → **8.0** |
| `db-pages-records` | 3 → 6 | 2 → 4 | 9 | 9 | 6 → **8** | 5 → **7** | 7 | 5 → **8** | 6.8 → **8.0** |
| `db-partitioning` | 3 → 6 | 2 → 2 | 9 | 9 | 7 → **9** | 5 | 9 | 8 → **9** | 7.8 → **8.3** |
| `db-query-lifecycle` | 3 → 6 | 2 → 2 | 9 | 9 | 6 → **8** | 5 | 8 | 7 → **8** | 7.3 → **7.8** |
| `db-query-optimization` | 4 → 7 | 2 → 3 | 9 | 8 | 8 → **9** | 6 → **7** | 9 | 7 | 7.8 → **8.2** |
| `db-quorums-consensus` | 3 → 6 | 2 → 3 | 9 | 9 | 7 → **9** | 6 → **7** | 8 | 8 | 7.8 → **8.3** |
| `db-redis-caching` | 5 → 8 | 2 → 2 | 9 | 9 | 8 → **9** | 6 | 9 | 9 | 8.3 → **8.5** |
| `db-relational-model` | 3 → 7 | 2 → 4 | 8 → **9** | 8 | 5 → **7** | 5 → **7** | 6 | 5 → **8** | 6.2 → **7.5** |
| `db-replication` | 4 → 7 | 2 → 3 | 9 | 9 | 8 → **9** | 6 → **7** | 9 | 8 | 8.2 → **8.5** |
| `db-scans-joins` | 3 → 6 | 2 → 4 | 9 | 9 | 7 → **9** | 5 → **7** | 8 | 5 → **8** | 7.2 → **8.3** |
| `db-schedules-serializability` | 8 (new) | 5 (new) | 9 | 9 | 8 | 8 | 6 | 9 | **8.2** (new) |
| `db-schema-design` | 3 → 6 | 2 → 3 | 9 | 8 | 6 → **8** | 5 → **6** | 9 | 8 | 7.5 → **8.0** |
| `db-sharding` | 4 → 7 | 2 → 3 | 9 | 9 | 8 → **9** | 6 → **7** | 9 | 8 | 8.2 → **8.5** |
| `db-specialized-indexes` | 3 → 6 | 2 → 2 | 9 | 8 | 7 → **9** | 5 | 8 | 6 → **7** | 7.2 → **7.7** |
| `db-transactions-acid` | 4 → 7 | 2 → 3 | 9 | 9 | 7 → **9** | 5 → **6** | 9 | 6 → **8** | 7.5 → **8.3** |
| `db-wal-durability` | 3 → 6 | 2 → 3 | 9 | 9 | 6 → **8** | 5 → **6** | 9 | 6 → **8** | 7.3 → **8.2** |
| `db-why-databases` | 4 → 8 | 2 → 4 | 8 → **9** | 9 | 6 → **8** | 5 → **7** | 8 | 5 → **8** | 6.8 → **8.2** |
| `db-wide-column` | 3 → 6 | 2 → 3 | 8 → **9** | 8 | 7 → **9** | 5 → **6** | 8 | 8 | 7.3 → **8.0** |
| `sql-aggregation` | 5 → 9 | 2 → 4 | 9 | 8 | 8 → **9** | 6 → **8** | 8 | 8 → **9** | 7.8 → **8.5** |
| `sql-dml-ddl` | 4 → 7 | 2 → 4 | 9 | 8 | 7 → **9** | 6 → **8** | 9 | 6 → **8** | 7.5 → **8.5** |
| `sql-interview-patterns` | 5 → 9 | 2 → 2 | 9 | 8 | 8 → **9** | 6 | 8 | 7 → **8** | 7.7 → **8.0** |
| `sql-joins` | 5 → 8 | 2 → 3 | 9 | 9 | 8 → **9** | 7 → **8** | 8 | 7 → **8** | 8.0 → **8.5** |
| `sql-null-logic` | 4 → 7 | 3 → 5 | 9 | 9 | 7 → **9** | 7 → **9** | 8 | 8 → **9** | 8.0 → **8.8** |
| `sql-select-basics` | 4 → 7 | 2 → 3 | 8 → **9** | 8 | 6 → **8** | 5 → **6** | 8 | 7 → **8** | 7.0 → **7.8** |
| `sql-semi-anti-joins` | 4 → 6 | 2 → 3 | 9 | 9 | 8 → **9** | 6 → **7** | 8 | 8 | 8.0 → **8.3** |
| `sql-set-operations` | 2 → 6 | 3 → 3 | 8 → **9** | 7 | 5 → **7** | 7 | 6 | 7 → **8** | 6.7 → **7.3** |
| `sql-subqueries-ctes` | 4 → 7 | 2 → 3 | 9 | 8 | 7 → **9** | 6 → **7** | 8 | 7 → **8** | 7.5 → **8.2** |
| `sql-views-programmability` | 3 → 7 | 2 → 3 | 8 → **9** | 7 | 5 → **7** | 5 → **6** | 8 | 5 → **8** | 6.3 → **7.5** |
| `sql-window-functions` | 5 → 8 | 3 → 4 | 9 | 9 | 8 → **9** | 7 → **8** | 8 | 8 → **9** | 8.2 → **8.7** |
