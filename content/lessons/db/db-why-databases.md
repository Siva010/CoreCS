---
title: "Why Databases Exist: What a DBMS Does That Files Cannot"
subject: db
level: 0
order: 1
summary: "Start from a CSV file and add real requirements — concurrent users, crashes, queries, constraints, scale — and watch each one force a piece of database machinery into existence."
depth: beginner
difficulty: 1
minutes: 25
relevance: essential
stage: 1
prerequisites: []
related: [os-filesystem-internals, os-page-cache, db-relational-model, db-transactions-acid, db-wal-durability, x-durability-chain]
tags: [dbms, database management system, files vs database, data independence, acid, query language, concurrency, durability, oltp, olap]
---

## Mental Model

A database is **a program that owns your data so that your application doesn't have to solve the hard problems of storing it**. You describe *what* you want ("customers in Pune with an unpaid order"). The database decides *how* to find it, keeps it consistent while hundreds of clients change it at once, and makes sure a committed change survives a power cut.

Think of a bank teller. Customers never walk into the vault; they ask the teller, who checks the request, writes it in the ledger and fetches what's needed. A DBMS is the teller for your data: every program asks it, and only it touches the files.

The easiest way to understand every part of a DBMS is to start without one and watch things break.

## Definition

- **Database**: an organized collection of data.
- **DBMS (database management system)**: the software that stores, retrieves, protects and concurrently manages that data — PostgreSQL, MySQL, SQLite, Oracle, SQL Server, MongoDB, Cassandra.
- **Schema**: the declared structure of the data (tables, columns, types, constraints).
- **Query language**: a declarative way to ask for data — SQL for relational databases.

## Why It Exists

**The problem.** Imagine an online store keeping orders in `orders.csv`. Each new requirement breaks the file approach:

| Requirement | What goes wrong with plain files | DBMS mechanism that fixes it |
|---|---|---|
| Find one order among 50 million | Read the whole file every time — O(n) | **Indexes** (B+ trees) — O(log n) |
| Two web servers write at once | Interleaved writes corrupt lines; lost updates | **Concurrency control** (locks, MVCC) |
| Power fails mid-write | Half-written record; file may be unreadable | **Write-ahead log**, crash recovery |
| "Move ₹500 from A to B" | Debit written, crash before credit → money vanishes | **Transactions** (atomicity) |
| Email must be unique; order must reference a real customer | Every program must remember to check — some won't | **Constraints** enforced centrally |
| New question: "revenue per city last month" | Write and debug a new program | **Declarative queries + optimizer** |
| Add a column | Rewrite every file and every parser | **Data independence**: schema changes without rewriting apps |
| Some users may only see their own data | Filesystem permissions are all-or-nothing | **Access control** (roles, grants, row-level security) |
| Data grows beyond one disk / machine | Manual splitting | **Partitioning, replication** |

Every row of that table is a lesson later in this track. A DBMS is the accumulated answer to these problems — solved once, carefully, instead of badly in every application.

**The idea.** Stop letting every program touch the data file directly. Put *one* program in charge of the data, and make everyone else *ask* it. Because all reads and writes go through that one owner, it can index, lock, log and check constraints for everyone at once.

:::callout[That's all it is]{type=insight}
A database is the single program allowed to touch your data files. Everyone else sends it requests. Indexes, transactions, logs and constraints are the tricks it uses to answer fast, stay correct under concurrency, and survive crashes.
:::

## How It Works

```mermaid
flowchart TD
    A["application: SQL over a connection"] --> P["parser → planner/optimizer"]
    P --> E["executor"]
    E --> I["access methods: tables (heap), indexes (B+ tree)"]
    I --> B["buffer pool: cached pages in RAM"]
    B --> D[("data files on disk")]
    E --> T["transaction manager: locks / MVCC"]
    T --> W["write-ahead log (WAL)"]
    W --> D2[("log files — fsync'd on COMMIT")]
```

Follow one request, `UPDATE orders SET status = 'paid' WHERE id = 42`, through the boxes:

1. **Connection.** The app sends the SQL text over a network connection ([connection management](lesson:x-connection-management)).
2. **Parser and planner.** The parser checks the grammar. The planner then picks a strategy. Here: "use the primary-key index to find order 42", because statistics say the table is big and the index is precise.
3. **Executor and buffer pool.** The executor follows that plan. It asks the **buffer pool** (the database's own in-memory cache of disk pages) for the index pages and the page holding order 42. Pages already in memory cost nothing; others are read from disk ([Buffer Pool](lesson:db-buffer-pool)).
4. **Transaction manager.** Before changing the row, the database makes sure no other transaction is changing the same row at the same moment. It also makes sure readers still see a consistent version ([Isolation Levels](lesson:db-isolation-levels)).
5. **Write-ahead log.** The change is first appended to the **write-ahead log** (WAL), a sequential diary of every change. The page in memory is updated too, but written to the data file later.
6. **Commit.** On `COMMIT`, the database forces the log to disk and only then replies "done". If the power fails one second later, replaying the log restores the change. That is what makes it durable ([WAL](lesson:db-wal-durability)).

### The three-schema architecture (ANSI/SPARC)

The textbook way to describe *data independence* — the property that lets storage change without breaking applications — is to split the database into three levels, each with its own schema:

| Level | Schema | Who sees it | Example |
|---|---|---|---|
| **External (view)** | many external schemas | individual users and applications | a `customer_summary` view showing name and city only |
| **Conceptual (logical)** | one logical schema | DBAs, designers | tables, columns, types, keys, constraints |
| **Internal (physical)** | one physical schema | the storage engine | heap files, B+ tree indexes, page layout, compression |

Between the levels sit **mappings**. Change one level and only the mapping to its neighbour must change:

- **Physical data independence**: change the internal schema (add an index, move a table to faster disks, switch to a column store) without changing the conceptual schema or any query. Almost every DBMS achieves this.
- **Logical data independence**: change the conceptual schema (split a table, add a column) without changing external schemas or applications — usually by redefining a view to present the old shape. Harder, and only partly achieved in practice.

Two concrete cases:

- You add an index on `orders(city)`. Only the internal level changed. Every existing query keeps working and simply gets faster: **physical** independence.
- You split `customers` into `customers` and `customer_addresses`, then create a view named after the old shape that joins them back together. The reports that read the old shape don't change: **logical** independence.

### DBMS languages

| Group | Purpose | Statements |
|---|---|---|
| **DDL** (data definition) | define and change structure | `CREATE`, `ALTER`, `DROP`, `TRUNCATE`, `RENAME`, `COMMENT` |
| **DML** (data manipulation) | read and change data | `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `MERGE` |
| **DCL** (data control) | permissions | `GRANT`, `REVOKE` |
| **TCL** (transaction control) | transaction boundaries | `BEGIN`/`START TRANSACTION`, `COMMIT`, `ROLLBACK`, `SAVEPOINT` |

(Some books file `SELECT` separately as DQL.) The categories matter in practice: in MySQL and Oracle most DDL **commits implicitly**, so a `ROLLBACK` after an `ALTER TABLE` does nothing; in PostgreSQL DDL is transactional.

### Where the DBMS sits: tiers

- **1-tier**: application and database in one process or machine (SQLite inside a mobile app).
- **2-tier (client–server)**: clients connect straight to the database server (a desktop app talking to PostgreSQL). Simple, but every client needs credentials and a connection.
- **3-tier**: browser → application server → database. The application tier holds business logic, pools connections and is the only thing allowed to reach the database — the default for web systems ([Connection Management](lesson:x-connection-management)).

## Internal Mechanism

:::depth{level=advanced}
### Why a database doesn't simply trust the filesystem

The OS already provides files, a page cache and journaling ([Filesystems](lesson:os-filesystem-internals)), so why do databases reimplement caching and logging?

- **Journaling protects filesystem metadata, not your application's invariants.** It guarantees the directory tree survives; it knows nothing about "debit and credit must both happen".
- **The OS page cache evicts by its own policy.** A database knows that an index root page is hotter than a sequential-scan page. It must also control *when* dirty pages reach disk relative to log records (the WAL rule). Many engines use `O_DIRECT` to bypass the page cache; PostgreSQL deliberately uses it as a second-level cache ([Page Cache](lesson:os-page-cache)).
- **`write()` returning is not durability.** Data sits in the page cache until `fsync()`. The database decides exactly which bytes must be durable at commit time — only the log — and writes data pages lazily.
:::

## Example

The same question, both ways:

```python
# Without a database: read everything, filter in code, hope nobody is writing.
total = 0
with open("orders.csv") as f:
    for line in f:
        cid, city, amount, status = line.rstrip().split(",")
        if city == "Pune" and status == "unpaid":
            total += float(amount)
```

```sql
-- With a database: say what you want; the planner may use an index on (city, status),
-- and you see a consistent snapshot even while other sessions insert orders.
SELECT sum(amount)
FROM orders
WHERE city = 'Pune' AND status = 'unpaid';
```

The SQL version is shorter, but that is the least important difference. It is **correct under concurrency, fast at scale and survives crashes** — none of which the script provides.

## Complexity & Performance

- Full scan: proportional to table size. Index lookup: O(log n) page reads — typically 3–4 pages even for hundreds of millions of rows, and the top levels are cached.
- A commit costs at least one durable log write (an `fsync`, ~0.05–10 ms depending on the device). Databases batch many commits into one flush ("group commit") to amortize it.

## Trade-offs

- **Database vs files**: a DBMS adds a server process, a network hop, a schema and operational work (backups, upgrades). For write-once logs or blobs, files or object storage are often better — store the file in S3 and its metadata in the database.
- **Embedded vs client-server**: SQLite runs inside your process (no network, one writer at a time) — ideal for mobile apps, tests and small sites. PostgreSQL/MySQL run as servers for many concurrent clients.
- **OLTP vs OLAP**: transactional databases optimize many small reads/writes by key; analytical databases (column stores) optimize scanning billions of rows for aggregates ([Column Stores](lesson:db-column-stores)).

## Failure Modes

- **Reimplementing a database in the application** — ad-hoc locking with files, hand-written uniqueness checks — usually works in testing and fails under concurrency.
- **Treating the database as a dumb store** — no constraints, all logic in the app — leads to invalid data the moment a second application or a manual fix touches it.
- **Assuming "saved" means durable** — e.g., turning off `fsync` or using async commit for speed without understanding what can be lost ([Durability Chain](lesson:x-durability-chain)).

## In Production

- Most backend incidents involving data are about the mechanisms above: slow queries (indexes/plans), lock waits and deadlocks (concurrency), replica lag (replication), running out of connections, or disk filling with WAL.
- "Boring" relational databases are the default for business data because they give transactions, constraints and flexible queries in one place. Specialized stores are added for specific access patterns ([NoSQL Landscape](lesson:db-nosql-landscape)).

## Deeper Connections

- The buffer pool is the OS page-replacement problem again, solved by the database for its own pages ([Page Replacement](lesson:os-page-replacement)).
- WAL, filesystem journaling and Raft logs are the same idea: **write down what you intend before you do it**, so a crash can be repaired ([Durability Chain](lesson:x-durability-chain)).
- Isolation is the database version of synchronizing threads ([Concurrency Everywhere](lesson:x-concurrency-everywhere)).

## Common Misconceptions

- **"A database is just a place to put tables."** The hard parts are concurrency, durability and query planning — tables are the interface.
- **"SQL is slow; code is fast."** The planner often beats hand-written loops because it knows data statistics and can use indexes; moving filtering into application code usually means shipping far more data over the network.
- **"NoSQL means no schema."** The schema still exists — it moves from the database into every piece of code that reads the data.

## Interview Questions

### [L1 · why] Why use a DBMS instead of storing data in files?

A DBMS provides, in one place: efficient access via indexes and a query optimizer, safe concurrent access (locking/MVCC), atomic transactions, durability and crash recovery via a write-ahead log, integrity constraints, access control, and data independence (the schema can evolve without rewriting every program). With files, each application would have to reimplement these — and would get concurrency and crash safety wrong.

### [L1 · conceptual] What is data independence?

The separation between how data is stored and how applications see it. **Physical independence**: you can add an index, change storage or partition a table without changing queries. **Logical independence**: you can change the schema (e.g., add columns, use views) with minimal impact on applications.

### [L2 · compare] When would you choose SQLite over PostgreSQL?

SQLite is an embedded library: zero administration, one file, excellent read performance and no network hop — ideal for mobile/desktop apps, tests, edge devices, and small or read-heavy websites. It allows one writer at a time, so write-heavy multi-user servers, multiple application hosts sharing one database, or needs like replication and fine-grained access control point to PostgreSQL.

### [L2 · why] Why do databases implement their own cache (buffer pool) instead of relying on the OS page cache?

They need control the OS can't provide: choosing eviction with knowledge of access patterns (index roots vs one-off scans), ordering writes so log records reach disk before the data pages they describe (the WAL rule), and avoiding double caching. Some engines bypass the OS cache entirely with O_DIRECT; PostgreSQL uses a buffer pool plus the OS cache.

### [L1 · conceptual] Explain the three-schema architecture. What are physical and logical data independence?

Three levels: external (user views), conceptual (the logical schema: tables, keys, constraints) and internal (physical storage: files, indexes, page layout), connected by mappings. Physical data independence means changing the internal level — adding an index, re-partitioning, changing storage — doesn't change the logical schema or queries; nearly every DBMS provides it. Logical data independence means changing the logical schema — splitting a table, adding columns — doesn't break external views or applications, typically by redefining views to keep the old shape; it's harder and only partly achievable.

### [L1 · compare] What are DDL, DML, DCL and TCL? Give two statements of each.

DDL defines structure (`CREATE TABLE`, `ALTER TABLE`, `DROP`, `TRUNCATE`). DML reads and changes rows (`SELECT`, `INSERT`, `UPDATE`, `DELETE`). DCL manages permissions (`GRANT`, `REVOKE`). TCL controls transactions (`COMMIT`, `ROLLBACK`, `SAVEPOINT`). A practical follow-up: DDL commits implicitly in MySQL and Oracle but is transactional in PostgreSQL, and `TRUNCATE` is DDL even though it removes data.

### [L1 · compare] DBMS vs RDBMS?

A DBMS is any system that manages stored data (hierarchical, network, document, key-value…). An RDBMS is a DBMS based on the relational model: data in tables (relations), relationships expressed by matching key values, integrity enforced through keys and constraints, and a declarative query language (SQL). Interviewers usually want the consequences: an RDBMS gives normalized storage, joins on any column, constraints, and ACID transactions as standard; many non-relational systems trade some of those for scale or flexibility ([NoSQL Landscape](lesson:db-nosql-landscape)).

### [L2 · design] Why do web applications use a 3-tier architecture instead of letting browsers talk to the database?

Security (database credentials and the database port are never exposed; the app tier enforces authorization per request), connection management (thousands of browsers would need thousands of database connections; the app tier pools a few), and logic placement (validation, business rules and caching live in one place that can be scaled horizontally). The database stays a private, protected resource behind the application.

## Practice

### [mcq] A web app stores orders in a JSON file. Two requests append orders at the same moment and one order disappears. Which DBMS capability addresses this?

- [ ] Indexing
- [x] Concurrency control
- [ ] Query optimization
- [ ] Normalization

Concurrent read-modify-write of the same file lost one update — the classic race condition that concurrency control (locks/MVCC) exists to prevent.

### [mcq] Which component makes a committed transaction survive a power failure?

- [ ] The buffer pool
- [ ] The query planner
- [x] The write-ahead log, forced to disk at commit
- [ ] The index

Data pages may be written much later; durability comes from the log being flushed before COMMIT returns.

### [mcq] A team adds an index and moves a table to SSD storage; no query or view changes. Which property made that possible?

- [x] Physical data independence
- [ ] Logical data independence
- [ ] Referential integrity
- [ ] Atomicity

Changes to the internal (physical) schema are absorbed by the internal–conceptual mapping.

### [mcq] Which statement is DCL?

- [ ] `TRUNCATE TABLE logs`
- [ ] `SAVEPOINT before_items`
- [x] `REVOKE INSERT ON orders FROM analyst`
- [ ] `MERGE INTO stock …`

`GRANT`/`REVOKE` control permissions. `TRUNCATE` is DDL, `SAVEPOINT` is TCL, `MERGE` is DML.

### [mcq] The `customers` table is split into `customers` and `customer_addresses`, and a view with the old shape is created so existing reports keep working unchanged. Which property does this demonstrate?

- [ ] Physical data independence
- [x] Logical data independence
- [ ] Referential integrity
- [ ] Atomicity

The conceptual (logical) schema changed; the external schema seen by the reports didn't, because the view now maps the new tables to the old shape. Changing indexes or storage without touching queries would be physical data independence.

### [numeric 20 unit=seconds] Orders live in an unsorted 10 GB file read sequentially at 500 MB/s. How long does finding one order by id take in the worst case? (1 GB = 1,000 MB.)

:::answer
Without an index the whole file may have to be read: 10,000 MB ÷ 500 MB/s = **20** seconds per lookup. A B+ tree index answers the same question with about 3–4 page reads — under a millisecond on SSD. That gap is one of the reasons a DBMS exists.
:::

### [exercise] A small company keeps orders in one CSV file per day, edited by two apps. Name four problems they will hit and the DBMS mechanism that solves each.

:::solution
- **Lost or interleaved writes** when two apps append at once → concurrency control (locks/MVCC) and transactions.
- **Half-written files after a crash** (an order without its lines) → atomicity and durability through the write-ahead log.
- **Slow questions across thousands of files** ("all orders by customer 42 this year") → a query language plus indexes and an optimizer.
- **Invalid or duplicate data** (an order for a non-existent customer, the same order twice) → constraints: primary keys, foreign keys, CHECK.

Others worth naming: access control (roles and GRANT instead of file permissions), backups and point-in-time recovery, and data independence (changing the format without rewriting every reader).
:::

## Quick Revision

- A DBMS solves once what every application would otherwise solve badly: fast access, concurrency, atomicity, durability, integrity, security, evolution.
- Pipeline: SQL → parser → planner → executor → access methods → buffer pool → disk; changes go to the WAL first, flushed on COMMIT.
- Filesystem journaling ≠ transactions; `write()` ≠ durable.
- OLTP (many small transactions) vs OLAP (large scans/aggregates); embedded (SQLite) vs client-server (PostgreSQL).
- Three-schema architecture: external (views) → conceptual (logical) → internal (physical). Physical independence is easy; logical independence is partial (views help).
- DDL (`CREATE/ALTER/DROP/TRUNCATE`) · DML (`SELECT/INSERT/UPDATE/DELETE`) · DCL (`GRANT/REVOKE`) · TCL (`COMMIT/ROLLBACK/SAVEPOINT`). DDL auto-commits in MySQL/Oracle.
- Web systems are 3-tier: the app server owns credentials, pooling and business rules.
