---
title: "The Durability Chain: What 'Saved' Really Means"
subject: x
level: 1
order: 3
summary: "Follow a committed write from the application through the database's WAL, write(), the page cache, fsync, the filesystem journal, the block layer, the device's write cache and flash — then to replicas and backups — and see which failure each link protects against."
depth: advanced
difficulty: 4
minutes: 40
relevance: high
stage: 3
prerequisites: [db-wal-durability, os-page-cache, os-storage-devices, db-replication]
related: [os-journaling, os-filesystem-internals, db-crash-recovery, db-failover, db-transactions-acid, db-lsm-trees, db-quorums-consensus]
tags: [durability, fsync, fdatasync, o_direct, page cache, write cache, power loss protection, filesystem journal, wal, group commit, synchronous_commit, replication, backups, rpo, failure domains]
---

## Mental Model

"Saved" is not one event; it's a **chain of copies**, each surviving a larger class of failure:

```text
app memory → DB WAL buffer → OS page cache → device write cache → persistent media → another machine → another zone → a backup
   (process crash)   (DB crash)      (kernel crash / power loss)   (disk failure)   (machine loss)  (zone loss)  (human error)
```

A write is only as durable as the **last link it has reached** when you acknowledge it. Every "fast" setting (async commit, no fsync, async replication, a volatile disk cache) shortens the chain — sometimes a reasonable trade, sometimes silent data loss.

## Definition

- **Durability**: once acknowledged, a write survives the failures you designed for.
- **`write()`**: copies data into the kernel page cache — survives the process crashing, not the machine losing power ([Page Cache](lesson:os-page-cache)).
- **`fsync()` / `fdatasync()`**: forces file data (and metadata, for fsync) to stable storage and waits for the device to confirm.
- **Device write cache**: DRAM on the SSD/controller; volatile unless protected by capacitors/battery (**power-loss protection**, PLP).
- **FUA / flush commands**: how the kernel asks the device to persist data rather than cache it.
- **Failure domain**: the scope of a failure — process, OS, machine, rack, zone, region, human.

## Why It Exists

Each layer buffers writes to be fast: databases batch WAL, the OS delays writeback, disks cache in DRAM. Buffering is only safe if something forces data through before claiming success. Knowing the chain lets you answer the real question behind "is it durable?": **durable against what?**

## How It Works

### Walking the chain for one COMMIT

| Link | What happens | Survives |
|---|---|---|
| 1. Application | builds the transaction | nothing yet |
| 2. DB WAL buffer | change + commit records in shared memory | nothing yet (DB process crash loses it) |
| 3. `write()` to WAL file | bytes in the OS page cache | DB process crash ✔; OS crash/power loss ✘ |
| 4. `fdatasync()` | kernel sends data + flush/FUA to the device; filesystem journal may commit metadata ([Journaling](lesson:os-journaling)) | power loss ✔ **if** the device honors flushes |
| 5. Device | data persisted in NAND (or in PLP-protected cache) | power loss ✔; device failure ✘ |
| 6. Synchronous replica | standby has flushed the WAL too | primary machine/disk loss ✔ |
| 7. Replica in another zone/region | same, farther away | zone/region loss ✔ (at latency cost) |
| 8. Backup + WAL archive | copies in object storage, retained over time | accidental DELETE, corruption, ransomware ✔ (via PITR) ([Crash Recovery](lesson:db-crash-recovery)) |

A default PostgreSQL COMMIT waits for link 4 (and 6 if synchronous replication is configured). Links 7–8 are asynchronous in most deployments, which is why RPO for regional disasters is usually seconds, not zero.

### Settings that cut the chain

| Setting | Effect | Risk |
|---|---|---|
| `synchronous_commit = off` (PG), `innodb_flush_log_at_trx_commit = 2` | ack after write() / periodic flush | lose last ~0.2–1 s of commits on OS crash/power loss; no corruption |
| `fsync = off` | never flush | **database corruption** on crash — never in production |
| Volatile disk cache without PLP, flushes ignored ("write cache enabled", some virtual disks) | device lies about persistence | lost or torn writes on power loss despite fsync |
| Async replication only | ack before replicas have data | lose the replication lag on primary failure ([Failover](lesson:db-failover)) |
| No off-site backups / untested restores | — | human error and disasters are unrecoverable |

### Group commit: making the chain affordable

An fsync costs ~0.05–2 ms on NVMe (more on network block storage, ~5–10 ms on HDDs). If each commit needed its own fsync, a device doing 1,000 flushes/s would cap you at 1,000 commits/s. Group commit makes one flush cover every commit waiting at that moment, so throughput grows with concurrency ([WAL](lesson:db-wal-durability)).

## Internal Mechanism

:::depth{level=advanced}
### fsync's sharp edges

- `fsync` on a file doesn't make a newly created file's **directory entry** durable — you must also fsync the directory (databases and careful applications do).
- After an fsync **error**, Linux may have already dropped the dirty pages; retrying fsync can report success while data is gone. PostgreSQL now treats fsync failure as a PANIC and recovers from WAL ("fsyncgate", 2018).
- `O_DIRECT` bypasses the page cache but does **not** imply durability; you still need `O_DSYNC`/fsync or FUA semantics.

### Atomicity at the device level

Devices guarantee atomic writes only at some granularity (often 512 B or 4 KB sectors). A database page (8–16 KB) can tear; hence full-page writes (PostgreSQL) and the doublewrite buffer (InnoDB) ([Pages & Records](lesson:db-pages-records)).

### Consensus as a durability link

In Raft-replicated systems, "committed" means a majority of nodes have **fsync'd** the entry. A cluster that acknowledges before fsync (for speed) can lose committed entries if a majority crashes simultaneously (e.g., a power event in one data center) ([Quorums & Consensus](lesson:db-quorums-consensus)).

### Applications have chains too

Message queues (acks after replication or not), object stores (acknowledge after N copies), and even `logger.info()` (buffered in the process) all have their own points of "durable enough". Ask each dependency the same question: acknowledged after what?
:::

## Example

An order service writes to PostgreSQL (NVMe with PLP, synchronous standby in another zone, asynchronous replica in another region, WAL archived to object storage every minute):

| Failure | Data lost? |
|---|---|
| App process crashes after COMMIT OK | no |
| PostgreSQL crashes | no (WAL replay) |
| Primary host loses power | no (fsync'd to PLP-protected SSD) |
| Primary zone destroyed | no (synchronous standby has every commit) |
| Whole region lost | up to the async replica's lag (seconds) |
| Engineer runs `DELETE FROM orders` | no — PITR from base backup + WAL archive to just before it (minus ≤ 1 minute of unarchived WAL if the primary is also lost) |

Each row is a link in the chain, chosen deliberately with its latency and cost.

## Complexity & Performance

- Commit latency ≈ fsync latency (+ synchronous replication RTT); throughput ≈ flushes/s × commits per flush.
- Every additional synchronous link adds its latency to every commit.

## Trade-offs

Durability against larger failure domains costs latency (synchronous links) or money (replicas, backups, PLP hardware). Choose per data class: payments demand long chains; analytics events may accept async commit.

## Failure Modes

- Consumer-grade or misconfigured storage ignoring flushes.
- Disabling fsync for benchmarks and forgetting.
- Assuming replicas are backups (they replicate deletes instantly).
- Backups never restored in a test — discovered broken during the disaster.
- Acknowledging to users before the chain reaches the promised link (e.g., queueing writes in memory).

## In Production

- Write down RPO/RTO per system and map each to chain links (sync replica? archive frequency? backup retention?).
- Verify: `pg_test_fsync` for storage flush latency, replication state (`sync_state`), archive success, periodic restore drills.

## Deeper Connections

- The same "log first, then apply" idea runs through filesystem journals, database WALs, LSM trees and Raft logs ([Journaling](lesson:os-journaling), [LSM Trees](lesson:db-lsm-trees), [Quorums & Consensus](lesson:db-quorums-consensus)).
- The durability chain is the "D" of ACID made physical ([Transactions](lesson:db-transactions-acid)).

## Common Misconceptions

- **"write() returned, so it's on disk."** It's in the page cache.
- **"fsync always means persistent."** Only if the device and virtualization layers honor flushes.
- **"We have replicas, so we don't need backups."** Replicas don't protect against logical errors.

## Interview Questions

### [L2 · how] What exactly makes a database COMMIT durable?

The commit record and all preceding WAL records are written and flushed to stable storage (fdatasync or O_DSYNC writes) before the database acknowledges the commit; the device must actually persist the data (not keep it in a volatile cache). With synchronous replication, a standby must also confirm it has flushed the WAL. Data pages are written later; recovery replays the WAL.

### [L3 · scenario] After a power outage, a database lost the last few seconds of acknowledged transactions despite fsync being on. What could explain it?

The storage stack acknowledged flushes without persisting data: a volatile write cache without power-loss protection, a RAID controller cache without battery, or a virtualization/storage layer ignoring flush requests. Alternatively, durability settings were relaxed (synchronous_commit off, innodb_flush_log_at_trx_commit = 2). Verify hardware PLP, controller/virtual disk cache settings and database configuration; test with pull-the-plug experiments.

## Practice

### [numeric 25000] An SSD completes one WAL flush every 2 ms. With group commit, each flush covers 50 transactions on average. What is the maximum commit throughput per second?

:::answer
500 flushes/s (1000 ms / 2 ms) × 50 commits per flush = **25,000** commits/s. Without group commit, it would be 500 commits/s.
:::

### [mcq] Which setting can corrupt a PostgreSQL database after a crash (rather than just losing recent commits)?

- [ ] synchronous_commit = off
- [x] fsync = off
- [ ] Asynchronous replication
- [ ] A longer checkpoint_timeout

Without fsync, data pages and WAL can reach disk in any order, violating the write-ahead rule; async commit only shortens the durability window.

## Quick Revision

- Durability is a chain: WAL buffer → page cache (write) → device (fsync) → persistent media → replicas → other zones → backups.
- Acknowledge only after the link that covers your failure model; COMMIT waits for fsync (+ sync replicas).
- Weak links: async commit (lose recent), fsync off (corrupt), lying caches, async replication (lose lag), no tested backups.
- Group commit makes fsync-per-commit affordable.
- Always ask: durable against what?
