// Plain-language definitions for database jargon. In database lessons, the
// first plain-text use of each term (outside code, links and headings) gets a
// dotted underline with this definition on hover or tap, linking to the lesson
// that explains it. A lesson that defines the term itself (its `lesson`, or any
// lesson where the term appears in bold) is left alone.
//
// Keep definitions short (≤ ~30 words) and free of other jargon where possible.
// Acronyms (all capitals) match case-sensitively; everything else ignores case.
// A trailing "s"/"es" is matched automatically.

export interface GlossaryEntry {
  term: string;
  aliases?: string[];
  def: string;
  lesson: string;
  /** Lesson ids (or id prefixes ending in "-") where the word usually means something else. */
  exclude?: string[];
  /** If set, only these lessons get the hover definition (for words with a common everyday sense). */
  only?: string[];
}

export const GLOSSARY: GlossaryEntry[] = [
  // ── Foundations and SQL ──
  { term: "primary key", def: "The column (or columns) chosen to identify each row: unique and never NULL.", lesson: "db-keys-constraints" },
  { term: "foreign key", def: "A column whose values must match a key in another table, so a row can't point at something that doesn't exist.", lesson: "db-keys-constraints" },
  { term: "candidate key", def: "A smallest set of columns that uniquely identifies every row. A table can have several; one becomes the primary key.", lesson: "db-keys-constraints" },
  { term: "surrogate key", def: "A meaningless generated identifier (an auto-increment number or a UUID) used as the key instead of real data like an email.", lesson: "db-keys-constraints" },
  { term: "NULL", def: "SQL's marker for an unknown or missing value. Comparing anything with it gives UNKNOWN, not true or false.", lesson: "sql-null-logic" },
  { term: "window function", def: "A calculation over a set of related rows (rank, running total, previous value) that keeps every row instead of collapsing them like GROUP BY.", lesson: "sql-window-functions" },
  { term: "CTE", aliases: ["common table expression"], def: "A named subquery written with WITH at the top of a query, so a complex query reads as a sequence of steps.", lesson: "sql-subqueries-ctes" },
  { term: "materialized view", def: "A stored copy of a query's result. Fast to read, but stale until it's refreshed.", lesson: "sql-views-programmability" },
  { term: "sargable", def: "Usable by an index: the column appears on its own in the condition, not wrapped in a function or arithmetic.", lesson: "sql-select-basics" },
  { term: "prepared statement", def: "A query sent once with placeholders, then executed many times with different values; the database parses (and may plan) it only once.", lesson: "db-query-lifecycle" },

  // ── Modeling ──
  { term: "functional dependency", aliases: ["functional dependencies"], def: "A rule X → Y: any two rows that agree on X must also agree on Y (an email determines a name).", lesson: "db-functional-dependencies" },
  { term: "normalization", def: "Organizing tables so each fact is stored exactly once, in the table whose key it describes.", lesson: "db-normalization" },
  { term: "denormalization", def: "Deliberately storing a fact in more than one place to make reads cheaper, at the cost of keeping the copies in sync.", lesson: "db-normalization" },

  // ── Storage and indexing ──
  { term: "page", exclude: ["sql-", "db-index-fundamentals", "db-redis-caching", "db-optimistic-pessimistic", "db-document-stores", "db-query-optimization", "db-partitioning"], def: "The fixed-size block (8 KB in PostgreSQL, 16 KB in InnoDB) that a database reads, caches and writes as one unit.", lesson: "db-pages-records" },
  { term: "tuple", def: "One stored row (or one version of a row). In relational theory, one fact in a table.", lesson: "db-pages-records" },
  { term: "heap", exclude: ["sql-", "db-scans-joins"], def: "A table stored as pages in no particular order; indexes point into it to find rows.", lesson: "db-pages-records" },
  { term: "TID", aliases: ["ctid"], def: "A row's physical address: (page number, slot number). PostgreSQL indexes store TIDs to find rows.", lesson: "db-pages-records" },
  { term: "buffer pool", def: "The database's own in-memory cache of disk pages. A page found there costs no disk read.", lesson: "db-buffer-pool" },
  { term: "B+ tree", def: "A shallow, balanced tree of pages: leaves hold keys in sorted order, upper levels route searches. A lookup reads one page per level.", lesson: "db-btree" },
  { term: "fanout", aliases: ["fan-out"], only: ["db-lsm-trees", "db-index-types-hashing", "db-composite-covering-indexes", "db-clustered-indexes", "db-pages-records", "db-index-fundamentals", "db-specialized-indexes"], def: "How many children each tree node has. Hundreds per page is what keeps a B+ tree only 3–4 levels deep.", lesson: "db-btree" },
  { term: "page split", def: "When a full B+ tree page is divided into two to make room for a new key.", lesson: "db-btree" },
  { term: "LSM tree", aliases: ["LSM"], def: "A storage structure that collects writes in memory and flushes them as sorted, never-modified files that are merged in the background.", lesson: "db-lsm-trees" },
  { term: "memtable", def: "The in-memory sorted buffer where an LSM tree collects recent writes before flushing them to a file.", lesson: "db-lsm-trees" },
  { term: "SSTable", def: "An immutable file of sorted key-value pairs written by an LSM tree.", lesson: "db-lsm-trees" },
  { term: "compaction", def: "Merging LSM files into new ones, dropping overwritten and deleted values.", lesson: "db-lsm-trees" },
  { term: "tombstone", def: "A marker recording that a key was deleted, so older copies of the value elsewhere are ignored until cleanup.", lesson: "db-lsm-trees" },
  { term: "Bloom filter", def: "A tiny summary of a file's keys that can answer \"definitely not here\" without reading the file (with a small chance of a false \"maybe\").", lesson: "db-lsm-trees" },
  { term: "column store", aliases: ["columnar"], def: "A database that stores each column separately, so analytical queries read only the columns they use.", lesson: "db-column-stores" },
  { term: "OLTP", def: "Online transaction processing: many short transactions that read or change a few rows by key (orders, payments).", lesson: "db-column-stores" },
  { term: "OLAP", def: "Online analytical processing: few, large queries that scan and aggregate many rows (reports, dashboards).", lesson: "db-column-stores" },
  { term: "secondary index", def: "An index stored separately from the table, whose entries point back to rows by address or by primary key.", lesson: "db-index-fundamentals" },
  { term: "selectivity", def: "The fraction of rows a condition matches. A small fraction means an index is worth using.", lesson: "db-index-fundamentals" },
  { term: "composite index", aliases: ["multi-column index"], def: "An index on several columns, sorted by the first, then by the second within each first value, and so on.", lesson: "db-composite-covering-indexes" },
  { term: "covering index", def: "An index that contains every column a query needs, so the table itself never has to be read.", lesson: "db-composite-covering-indexes" },
  { term: "index-only scan", def: "A plan that answers a query from index pages alone, without visiting the table.", lesson: "db-composite-covering-indexes" },
  { term: "clustered index", def: "An index whose leaves contain the table's rows, so the table itself is stored in key order (InnoDB's primary key).", lesson: "db-clustered-indexes" },
  { term: "partial index", def: "An index containing only the rows that match a condition, such as status = 'pending'.", lesson: "db-specialized-indexes" },
  { term: "GIN", def: "PostgreSQL's inverted index: maps each word, JSON key or array element to the rows containing it.", lesson: "db-specialized-indexes" },
  { term: "BRIN", def: "A tiny PostgreSQL index storing min and max values per block range; useful when data is physically in order, like append-only time data.", lesson: "db-specialized-indexes" },

  // ── Query execution ──
  { term: "query planner", aliases: ["planner", "query optimizer"], def: "The part of the database that decides how to run a query, by estimating the cost of alternative plans and picking the cheapest.", lesson: "db-query-lifecycle" },
  { term: "sequential scan", aliases: ["seq scan", "full table scan"], def: "Reading every page of a table in order, checking each row.", lesson: "db-scans-joins" },
  { term: "bitmap scan", aliases: ["bitmap heap scan", "bitmap index scan"], def: "Collect matching row addresses from an index, sort them by page, then read each needed page once.", lesson: "db-scans-joins" },
  { term: "nested loop", aliases: ["nested-loop join"], def: "A join that, for each row on one side, looks up matching rows on the other; fast when that lookup uses an index.", lesson: "db-scans-joins" },
  { term: "hash join", def: "A join that builds a hash table on the smaller input, then probes it once for each row of the larger input.", lesson: "db-scans-joins" },
  { term: "merge join", def: "A join that walks two inputs sorted on the join key side by side, like merging two sorted lists.", lesson: "db-scans-joins" },
  { term: "EXPLAIN", def: "Shows the plan the database chose for a query. EXPLAIN ANALYZE also runs it and reports actual row counts and times.", lesson: "db-explain" },

  // ── Transactions and concurrency ──
  { term: "transaction", exclude: ["sql-window-functions"], def: "A group of statements the database treats as one step: all or nothing, isolated from others, and permanent once committed.", lesson: "db-transactions-acid" },
  { term: "ACID", def: "Atomicity, consistency, isolation, durability: the four promises a transaction makes.", lesson: "db-transactions-acid" },
  { term: "WAL", aliases: ["write-ahead log"], def: "Write-ahead log: an append-only record of every change, flushed to disk at commit before the data pages are written. Replaying it recovers from crashes.", lesson: "db-wal-durability" },
  { term: "LSN", def: "Log sequence number: a record's position in the WAL. Each page remembers the LSN of the last change applied to it.", lesson: "db-wal-durability" },
  { term: "checkpoint", def: "A point after which all earlier changes are on disk, so crash recovery can start replaying the log from there.", lesson: "db-wal-durability" },
  { term: "fsync", def: "The system call that forces a file's buffered writes onto stable storage. Until it returns, \"written\" data may still be only in memory.", lesson: "db-wal-durability" },
  { term: "dirty read", def: "Reading another transaction's change before it has committed (it might still be rolled back).", lesson: "db-anomalies" },
  { term: "non-repeatable read", def: "Reading the same row twice in one transaction and getting different values, because someone committed a change in between.", lesson: "db-anomalies" },
  { term: "phantom", aliases: ["phantom read"], exclude: ["db-distributed-transactions"], def: "A row that appears or disappears when a transaction repeats a range query, because another transaction inserted or deleted it.", lesson: "db-anomalies" },
  { term: "lost update", def: "Two transactions read the same value and both write back a new one, so one of the changes silently disappears.", lesson: "db-anomalies" },
  { term: "write skew", def: "Two transactions each check a rule, then update different rows. Each was fine alone; together they break the rule.", lesson: "db-anomalies" },
  { term: "precedence graph", def: "A graph with an edge Ti → Tj for each pair of conflicting operations where Ti's came first. A cycle means no equivalent serial order exists.", lesson: "db-schedules-serializability" },
  { term: "serializable", aliases: ["serializability"], def: "The strongest isolation guarantee: the result equals running the transactions one at a time, in some order.", lesson: "db-schedules-serializability" },
  { term: "isolation level", def: "How much concurrently running transactions can see of each other's changes: Read Committed, Repeatable Read or Serializable.", lesson: "db-isolation-levels" },
  { term: "Read Committed", def: "Isolation level where each statement sees only data committed before that statement started.", lesson: "db-isolation-levels" },
  { term: "Repeatable Read", def: "Isolation level where the whole transaction reads one snapshot (PostgreSQL); MySQL also locks ranges for locking reads.", lesson: "db-isolation-levels" },
  { term: "snapshot isolation", def: "Each transaction reads one consistent snapshot and fails if it updates a row someone else changed meanwhile. Still allows write skew.", lesson: "db-isolation-levels" },
  { term: "shared lock", def: "A lock many transactions can hold at once, typically for reading; it blocks exclusive locks.", lesson: "db-locking" },
  { term: "exclusive lock", def: "A lock only one transaction can hold, typically for writing; it blocks every other lock on the same item.", lesson: "db-locking" },
  { term: "deadlock", def: "Two or more transactions each waiting for a lock another one holds. The database breaks the cycle by aborting one.", lesson: "db-locking" },
  { term: "gap lock", aliases: ["next-key lock"], def: "InnoDB's lock on the space between index entries, stopping inserts into a range another transaction is reading.", lesson: "db-locking" },
  { term: "two-phase locking", aliases: ["2PL", "strict 2PL"], def: "Take locks as you need them and release none until you have them all (in practice, hold them until commit). Guarantees serializability.", lesson: "db-concurrency-protocols" },
  { term: "MVCC", def: "Multi-version concurrency control: updates create new row versions, and each transaction reads the versions matching its snapshot, so readers and writers don't block each other.", lesson: "db-mvcc" },
  { term: "snapshot", exclude: ["db-backups-pitr", "db-data-warehousing", "db-failover", "db-normalization", "db-schema-design", "db-crash-recovery", "db-sharding", "db-redis-caching", "db-document-stores", "db-security"], def: "The set of committed changes a transaction (or statement) is allowed to see, fixed when it starts.", lesson: "db-mvcc" },
  { term: "xmin", aliases: ["xmax"], def: "Transaction ids stamped on a PostgreSQL row version: xmin created it, xmax deleted or replaced it.", lesson: "db-mvcc" },
  { term: "VACUUM", aliases: ["autovacuum"], def: "PostgreSQL's cleanup that removes row versions no transaction can see any more and makes their space reusable.", lesson: "db-mvcc" },
  { term: "HOT update", def: "Heap-only tuple update in PostgreSQL: the new row version stays on the same page, so no index entries are added.", lesson: "db-mvcc" },
  { term: "undo log", def: "Where InnoDB keeps old row versions, used to roll back and to show older snapshots to readers.", lesson: "db-mvcc" },
  { term: "optimistic concurrency control", aliases: ["optimistic locking", "OCC"], def: "Work without locks, then check at write time that nothing you read has changed; retry if it has.", lesson: "db-optimistic-pessimistic" },
  { term: "idempotent", aliases: ["idempotency"], def: "Safe to repeat: doing it twice has the same effect as doing it once.", lesson: "db-optimistic-pessimistic" },
  { term: "ARIES", def: "The classic crash-recovery algorithm: analyse the log, redo every change, then undo transactions that never committed.", lesson: "db-crash-recovery" },
  { term: "PITR", aliases: ["point-in-time recovery"], def: "Point-in-time recovery: restore a backup, then replay the log up to a chosen moment, such as just before a bad DELETE.", lesson: "db-backups-pitr" },
  { term: "RPO", def: "Recovery point objective: how much recent data you can afford to lose, measured in time.", lesson: "db-backups-pitr" },
  { term: "RTO", def: "Recovery time objective: how long recovery is allowed to take before service is back.", lesson: "db-backups-pitr" },

  // ── Distributed ──
  { term: "replica", aliases: ["follower", "standby", "read replica"], def: "A copy of the database that applies the primary's changes in the same order; it may serve reads.", lesson: "db-replication" },
  { term: "replication lag", def: "How far a replica is behind the primary, in bytes of log or seconds. Reads from a lagging replica can be stale.", lesson: "db-replication" },
  { term: "failover", def: "Promoting a replica to be the new primary after the primary fails.", lesson: "db-failover" },
  { term: "split brain", def: "Two nodes both acting as primary and accepting different writes, so the data's history forks.", lesson: "db-failover" },
  { term: "fencing", def: "Making sure an old primary can no longer accept writes: power it off, revoke its lease, or reject its requests.", lesson: "db-failover" },
  { term: "partition pruning", def: "Skipping the partitions of a table that can't contain matching rows.", lesson: "db-partitioning" },
  { term: "shard", aliases: ["sharding"], def: "One of several independent databases that each hold a slice of the data, chosen by a key.", lesson: "db-sharding" },
  { term: "shard key", def: "The column that decides which shard a row lives on, such as tenant_id or user_id.", lesson: "db-sharding" },
  { term: "consistent hashing", def: "Placing servers and keys on a hash ring, so adding or removing a server moves only about 1/N of the keys.", lesson: "db-consistent-hashing" },
  { term: "virtual nodes", aliases: ["vnodes"], def: "Placing each server at many points on a hash ring, which evens out how much data each one owns.", lesson: "db-consistent-hashing" },
  { term: "quorum", def: "Enough replicas (often a majority) that any two such groups share at least one member.", lesson: "db-quorums-consensus" },
  { term: "consensus", def: "Getting several nodes to agree on one sequence of decisions even when some crash (Raft, Paxos).", lesson: "db-quorums-consensus" },
  { term: "Raft", def: "A consensus algorithm: an elected leader appends commands to a log and a command counts once a majority has stored it.", lesson: "db-quorums-consensus" },
  { term: "linearizability", aliases: ["linearizable"], def: "Every operation appears to happen instantly at one point in time, so a read always sees the latest completed write — as if there were one copy.", lesson: "db-consistency-models" },
  { term: "eventual consistency", aliases: ["eventually consistent"], def: "If writes stop, all replicas eventually agree; until then, reads may return old values.", lesson: "db-consistency-models" },
  { term: "read-your-writes", def: "A guarantee that you always see your own earlier writes, even when reading from replicas.", lesson: "db-consistency-models" },
  { term: "CAP theorem", aliases: ["CAP"], def: "When the network splits replicas apart, each request must either wait/fail (consistency) or answer from local data (availability).", lesson: "db-cap-pacelc" },
  { term: "two-phase commit", aliases: ["2PC"], def: "Ask every participant to prepare, then send all of them the same commit-or-abort decision.", lesson: "db-distributed-transactions" },
  { term: "saga", def: "A sequence of local transactions, each with a compensating action that undoes it if a later step fails.", lesson: "db-distributed-transactions" },
  { term: "transactional outbox", aliases: ["outbox"], def: "Write the data change and the event to publish in one local transaction; a relay sends the event afterwards, so neither can happen without the other.", lesson: "db-distributed-transactions" },

  // ── In practice ──
  { term: "SQL injection", def: "An attack where input pasted into SQL text changes what the query does. Prevented with parameterized queries.", lesson: "db-security" },
  { term: "row-level security", aliases: ["RLS"], def: "Database policies that filter which rows each session can see or change, for example one tenant's rows.", lesson: "db-security" },
  { term: "star schema", def: "A warehouse layout: one large fact table of measurements joined to small descriptive dimension tables.", lesson: "db-data-warehousing" },
  { term: "fact table", def: "A warehouse table with one row per measured event (a sale, a click), holding the numbers and keys to its dimensions.", lesson: "db-data-warehousing" },
  { term: "dimension table", def: "A warehouse table of descriptive attributes (product, customer, date) used to filter and group the facts.", lesson: "db-data-warehousing" },
  { term: "CDC", aliases: ["change data capture"], def: "Change data capture: streaming every insert, update and delete out of a database, usually by reading its log.", lesson: "db-data-warehousing" },
];
