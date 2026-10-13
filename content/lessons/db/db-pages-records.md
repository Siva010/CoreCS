---
title: "Pages and Records: How a Table Is Laid Out on Disk"
subject: db
level: 6
order: 1
summary: "Why databases read and write fixed-size pages, the slotted-page layout, row headers and tuple ids, heap files and free-space maps, oversized values (TOAST/overflow pages), fill factor, and torn-page protection."
depth: core
difficulty: 3
minutes: 40
relevance: high
stage: 2
prerequisites: [db-why-databases]
related: [os-storage-devices, os-page-cache, os-filesystem-internals, db-buffer-pool, db-btree, db-mvcc, db-wal-durability, db-column-stores]
tags: [page, block, slotted page, heap file, tuple, row header, ctid, tid, rowid, free space map, toast, overflow page, fill factor, row format, torn page, checksum]
---

## Mental Model

A database never reads "a row" from disk. It reads a **page** — a fixed-size block (8 KB in PostgreSQL, 16 KB in InnoDB) — containing many rows, because storage devices and the OS transfer data in blocks and the cost of one I/O is mostly fixed ([Storage Devices](lesson:os-storage-devices)). Everything above — buffer pool, indexes, WAL — speaks in pages.

Inside a page, rows are variable-length, get inserted, updated and deleted. The **slotted page** layout lets rows move within a page without changing their external address.

## Definition

- **Page (block)**: the unit of I/O and caching; identified by (file, page number).
- **Heap file**: a table stored as an unordered collection of pages (PostgreSQL tables; InnoDB instead stores rows inside the primary-key B+ tree).
- **Tuple / record**: a stored row version: header + column data.
- **Tuple id (TID / ctid / RID)**: the physical address of a row: (page number, slot number). Indexes in PostgreSQL point to TIDs.
- **Slot array (line pointers)**: per-page directory mapping slot numbers to byte offsets within the page.
- **Free space map (FSM)**: tracks roughly how much free space each page has, so inserts can find room.
- **Fill factor**: target fullness for pages on insert, leaving room for updates.

## Why It Exists

**The problem.** Rows are small and variable-sized; storage reads and writes in fixed blocks. Somehow tables of rows must be laid out on block devices.

**Why pages:**

- Disks/SSDs and the OS work in blocks (4 KB+); reading 8 KB costs about the same as reading 100 bytes.
- Fixed-size pages make caching simple (buffer frames are all the same size) and let the WAL describe changes as "page P, offset O".
- Variable-length rows inside fixed pages need indirection so that compaction and updates don't break every index pointing at a row.

:::callout[That's all it is]{type=insight}
A table is a pile of 8 KB pages. Each page has a small directory at the front (slots) and rows packed from the back. A row's address is (page, slot), so rows can move inside the page without anyone noticing.
:::

## How It Works

### The slotted page

The design question: rows have different sizes and come and go, yet indexes need stable addresses for them. Answer: add one level of indirection inside the page.

```text
┌──────────────────────────── 8 KB page ────────────────────────────┐
│ page header: LSN, checksum, flags, lower, upper, free-space ptrs  │
│ slot array → [1: off 8100, len 60] [2: off 8020, len 80] [3: …]   │  grows →
│                                                                   │
│                        free space                                 │
│                                                                   │
│                          ← grows       [tuple 3][tuple 2][tuple 1]│
└───────────────────────────────────────────────────────────────────┘
```

- The slot array grows from the front; tuples are placed from the end backwards; free space is in the middle.
- A row's address is (page, **slot**), not (page, byte offset). The page can compact itself (defragment tuples) and just update slot offsets — external pointers stay valid.
- Deleting a row marks its slot unused/dead; space is reclaimed by compaction (and, in MVCC systems, only after no transaction can see the old version — [MVCC](lesson:db-mvcc)).

### Inside a tuple

PostgreSQL heap tuple ≈ 23-byte header + null bitmap + aligned column data:

| Header field | Purpose |
|---|---|
| `xmin`, `xmax` | Creating and deleting transaction ids → visibility for MVCC |
| `ctid` | Pointer to the newer version of this row (update chains) |
| infomask bits | Hint bits (committed/aborted), has-nulls, etc. |
| null bitmap | One bit per column |

Columns are stored in declaration order with **alignment padding** (e.g., an 8-byte `bigint` must start at an 8-byte boundary) — ordering columns from widest fixed-width to narrowest can save space in very large tables.

### Large values

The page design assumes rows are much smaller than a page. A 1 MB JSON document breaks that assumption, so it needs a separate path. A row must fit in a page. Values larger than ~2 KB are compressed and/or moved out of line:

- PostgreSQL **TOAST**: large `text`/`jsonb`/`bytea` values are stored in a side table in chunks; the row holds a pointer. Queries that don't select the column never read it.
- InnoDB: large columns go to **overflow pages**, with a prefix or pointer kept in the row (depending on row format).

### Finding space for inserts

The **free space map** answers "which page has at least N bytes free?" without scanning. New rows go to a page with room, or a new page is appended. Heaps don't order rows — insert order and page order drift apart as space is reused.

### Fill factor

`ALTER TABLE t SET (fillfactor = 80)` leaves 20% of each page free on insert. Later updates can place the new row version **on the same page**, which in PostgreSQL enables HOT updates (no new index entries) — valuable for update-heavy tables ([DML](lesson:sql-dml-ddl)).

### File organization: how pages hold a table

The textbook names for "in what order are a table's records placed in its pages?":

| Organization | Records placed | Insert | Equality search | Range search |
|---|---|---|---|---|
| **Heap (unordered)** | wherever there is space | cheap (append / free-space map) | scan ~half the file on average | full scan |
| **Sequential (sorted)** | in key order | expensive (shift or overflow pages) | binary search: ~log₂(b) block reads | binary search, then read consecutive blocks |
| **Hashed** | page chosen by hash(key) | cheap | ~1 block read | useless (order destroyed) |
| **Clustered / index-organized** | in a B+ tree by key | log-time | log-time | log-time + consecutive leaves |

Real systems: PostgreSQL tables are heaps with separate indexes; InnoDB tables are index-organized by primary key ([Clustered Indexes](lesson:db-clustered-indexes)); hashing appears as hash indexes and partitions ([Index Types & Hashing](lesson:db-index-types-hashing)).

### Records, blocking factor and spanning

- **Fixed-length records** (all fields fixed size) let the k-th record be found by arithmetic; **variable-length records** (text, NULLs, JSON) need offsets inside the record and a slot directory per page.
- **Blocking factor** = records per block = ⌊block size ÷ record size⌋ for **unspanned** records (a record never crosses a block boundary; the leftover bytes are wasted). **Spanned** records may continue in the next block — no waste, but some reads touch two blocks. Databases use unspanned layout plus out-of-line storage (TOAST, overflow pages) for big values.
- File size in blocks = ⌈records ÷ blocking factor⌉. Example: 4,096-byte blocks, 100-byte records → bfr = 40; 1,000,000 records → 25,000 blocks. A full scan reads 25,000 blocks; binary search on a sorted file needs about ⌈log₂ 25,000⌉ = 15 block reads.

## Internal Mechanism

:::depth{level=advanced}
### Page LSN and the WAL rule

Each page header stores the **LSN** (log sequence number) of the last WAL record that modified it. Before a dirty page is written to disk, the WAL up to that LSN must be durable — the write-ahead rule. During recovery, a WAL record is replayed only if the page's LSN is older than the record's, making redo idempotent ([Crash Recovery](lesson:db-crash-recovery)).

### Torn pages

An 8 KB database page spans two 4 KB filesystem blocks (or several 512-byte sectors). A crash mid-write can leave half old, half new — a **torn page** that neither the old nor the new WAL record can repair by replaying a delta.

- PostgreSQL: **full-page writes** — the first modification of a page after each checkpoint logs the entire page image in the WAL, so recovery can restore it wholesale.
- InnoDB: the **doublewrite buffer** — pages are first written to a doublewrite area, fsynced, then written in place; a torn in-place page is restored from the doublewrite copy.

Page **checksums** detect corruption from the storage stack when a page is read.

### Row stores vs column stores

This lesson describes a **row-oriented (N-ary)** layout: all columns of a row together — ideal for fetching or updating whole rows (OLTP). Analytical engines store each column separately (PAX/columnar layouts) so scans read only needed columns and compress well ([Column Stores](lesson:db-column-stores)).
:::

## Example

How many rows fit on a page? A table with `(id bigint, customer_id bigint, status text ~8 bytes, total numeric ~8 bytes, created_at timestamptz)`:

- Tuple header 23 → padded to 24 bytes; data ≈ 8 + 8 + 9 + 8 + 8 ≈ 41 → ~48 with alignment; plus a 4-byte slot → ~76 bytes per row.
- (8192 − 24-byte page header) / 76 ≈ **107 rows per page**.
- 100 million rows ≈ 935,000 pages ≈ **7.3 GB** before indexes.

Such estimates let you predict whether a table's hot part fits in memory and how long a full scan takes (7.3 GB at ~1 GB/s ≈ 7 s from a fast SSD; far longer when competing with other I/O).

## Complexity & Performance

- Cost of a query ≈ number of pages touched (from the buffer pool or disk), not rows.
- A point lookup by TID: 1 page. A full scan: all pages, sequentially (fast per page, large in total).
- Wider rows → fewer rows per page → more pages per scan and lower cache hit rates.

## Trade-offs

- **Page size**: larger pages → better sequential throughput and fewer B+ tree levels; smaller pages → less wasted I/O for random point reads and less write amplification per change.
- **Heap + separate indexes (PostgreSQL)** vs **index-organized tables (InnoDB)**: heap inserts are cheap and secondary indexes point directly at rows, but updates move row versions (requiring index updates unless HOT); clustered tables keep rows in key order (fast range scans by PK) but secondary lookups go through the PK ([Clustered Indexes](lesson:db-clustered-indexes)).

## Failure Modes

- **Bloat**: dead tuples and half-empty pages accumulate (MVCC updates/deletes without timely vacuum), so scans read far more pages than live data requires.
- **Wide rows** with rarely used large columns slowing every scan — split the table vertically or rely on TOAST (and don't `SELECT *`).
- **Disabling full-page writes/doublewrite** for speed on storage that can tear writes → unrecoverable corruption after a crash.

## In Production

- `pg_relation_size`, `pgstattuple` and bloat estimates tell you how many pages a table really occupies versus its live data; `VACUUM FULL`/`pg_repack` rewrite it compactly.
- WAL volume spikes right after checkpoints are often full-page writes — a known cost that tuning checkpoint intervals trades against recovery time.

## Deeper Connections

- The page is where OS and database meet: the database's 8 KB page is read via the filesystem, possibly through the OS page cache ([Page Cache](lesson:os-page-cache)).
- Slot indirection is the same trick as virtual memory: a stable logical address mapped to a movable physical location ([Paging](lesson:os-paging)).

## Common Misconceptions

- **"The database reads the rows you ask for."** It reads the pages containing them.
- **"Deleting rows shrinks the file."** Space is reused internally; the file shrinks only after a rewrite (VACUUM FULL, OPTIMIZE TABLE) or truncation of empty trailing pages.
- **"Row order in the table matches insert order."** Heaps reuse free space anywhere.

## Interview Questions

### [L2 · why] Why do databases use fixed-size pages rather than reading individual rows?

Storage and the OS transfer data in blocks, and each I/O has a large fixed cost, so reading a page of many rows costs about the same as reading one. Fixed-size pages make buffer management uniform, let the WAL reference changes by page, and allow indexes to point at page-level addresses.

### [L2 · how] What is a slotted page and why does it help?

A page layout with a header, a slot array growing from the front and tuples growing from the back. A row is addressed by (page, slot); the slot stores the tuple's current offset. The page can compact or move tuples internally by updating the slot, so indexes and other references to (page, slot) remain valid while supporting variable-length rows.

### [L3 · how] What is a torn page and how do PostgreSQL and InnoDB protect against it?

A crash during a page write can leave a page partially updated because the database page is larger than the atomic write unit of the storage stack. PostgreSQL logs a full image of each page on its first modification after a checkpoint (full-page writes), so recovery restores the complete page before replaying later changes. InnoDB writes pages to a doublewrite buffer first and restores torn pages from it. Checksums detect corruption.

### [L1 · compare] Heap file vs sorted file vs hashed file — what is each good at?

A heap places records anywhere there's space: inserts are cheap, but every search is a scan unless an index exists. A sorted (sequential) file keeps key order: equality and range searches use binary search (~log₂ b block reads), but inserts must shift records or use overflow pages. A hashed file places each record by hash(key): equality lookups take about one block read, inserts are cheap, but range queries and ordered scans are useless. Real engines combine a heap or clustered B+ tree with secondary indexes to get cheap inserts *and* fast lookups.

### [L2 · numerical] Records are 100 bytes, blocks are 4,096 bytes, unspanned. How many blocks for 1,000,000 records, and how many block reads for a binary search?

Blocking factor = ⌊4096 / 100⌋ = 40 records per block (96 bytes wasted per block). Blocks = ⌈1,000,000 / 40⌉ = 25,000. Binary search on a file sorted by the search key takes ⌈log₂ 25,000⌉ = 15 block reads; a linear search averages 12,500 (and reads all 25,000 when the key is absent).

### [L2 · compare] Fixed-length vs variable-length records? Spanned vs unspanned?

Fixed-length records make addressing trivial (record k is at offset k × size) but waste space for short values; variable-length records save space and handle text and NULLs, at the cost of per-record offsets and a slot directory to locate them. Unspanned records fit wholly inside one block (simpler, wastes the tail of each block); spanned records may cross blocks (no waste, but some reads touch two blocks). Databases use variable-length, unspanned records and move oversized values out of line.

## Practice

### [numeric 128] A table's rows occupy 64 bytes each, including the slot pointer, and 8,192 bytes per page are usable (ignore the header). How many rows fit per page?

:::answer
8192 / 64 = **128** rows per page.
:::

### [mcq] In PostgreSQL, what does an index entry point to?

- [ ] The row's primary key value
- [x] The row's physical tuple id (page number, slot)
- [ ] A byte offset in the table file
- [ ] The WAL record that created the row

PostgreSQL indexes store TIDs; InnoDB secondary indexes store the primary key instead.

### [numeric 25000] A table has 1,000,000 fixed-length records of 100 bytes in 4,096-byte blocks, unspanned. How many blocks does it occupy?

:::answer
Blocking factor = ⌊4096 / 100⌋ = 40 records per block. Blocks = ⌈1,000,000 / 40⌉ = **25,000**.
:::

### [mcq] Which file organization makes `WHERE id BETWEEN 1000 AND 2000` the most expensive, assuming no index?

- [ ] Sorted on id
- [ ] Clustered B+ tree on id
- [x] Hashed on id
- [ ] All the same

Hashing scatters neighbouring keys across blocks, so a range needs a full scan; sorted and clustered layouts read a contiguous run.

## Quick Revision

- Page = unit of I/O and caching (8 KB PG, 16 KB InnoDB). Cost ≈ pages touched.
- Slotted page: slot array + tuples from the end; address = (page, slot); compaction doesn't break pointers.
- Tuple header: xmin/xmax/ctid for MVCC; null bitmap; alignment padding.
- Large values → TOAST / overflow pages. FSM finds free space. Fill factor leaves room for same-page updates.
- Page LSN enforces write-ahead logging; full-page writes / doublewrite prevent torn pages.
- File organizations: heap (cheap insert, scan search) · sorted (binary search, costly insert) · hashed (O(1) equality, no ranges) · clustered B+ tree.
- Blocking factor = ⌊B / R⌋ (unspanned); blocks = ⌈n / bfr⌉; binary search ≈ ⌈log₂ blocks⌉ reads.
