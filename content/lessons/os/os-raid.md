---
title: "RAID Fundamentals: Striping, Mirroring and Parity"
subject: os
level: 8
order: 6
summary: "How RAID 0, 1, 5, 6 and 10 trade capacity, performance and fault tolerance — including the RAID-5 write penalty, rebuild risk, and why RAID is not a backup."
depth: core
difficulty: 2
minutes: 25
relevance: medium
stage: 3
prerequisites: [os-storage-devices]
related: [os-storage-devices, db-replication, x-durability-chain]
tags: [raid, raid 0, raid 1, raid 5, raid 6, raid 10, striping, mirroring, parity, xor, write penalty, rebuild, hot spare]
---

## Mental Model

RAID combines several disks into one logical disk using three tricks:

- **Striping** — split data across disks so they work in parallel (speed, no safety).
- **Mirroring** — write every block to two disks (safety, costs half the capacity).
- **Parity** — store a checksum-like XOR of blocks so any one missing block can be recomputed (safety at lower capacity cost, but writes become expensive).

Every RAID level is a mix of these, trading **capacity**, **performance**, and **how many disk failures you survive**.

## Definition

**RAID (Redundant Array of Independent Disks)** is a technique that presents multiple physical disks as one logical volume, for performance (striping), redundancy (mirroring/parity), or both. Implemented in hardware controllers, software (Linux `md`, ZFS RAID-Z), or cloud storage layers.

## Why It Exists

Individual disks are slow and fail regularly (annualized failure rates of ~1–2% for HDDs). RAID lets a server keep running through disk failures and aggregate the throughput of many drives.

## How It Works

### Parity with XOR

For data blocks D1, D2, D3: `P = D1 ⊕ D2 ⊕ D3`. If D2 is lost: `D2 = D1 ⊕ D3 ⊕ P`. XOR is its own inverse, so any single missing block (data or parity) can be reconstructed.

### Levels compared (n disks of equal size)

| Level | Technique | Usable capacity | Survives | Read perf | Write perf | Typical use |
|---|---|---|---|---|---|---|
| **RAID 0** | Striping | n | **0 failures** | n× | n× | Scratch data, caches |
| **RAID 1** | Mirroring | n/2 (1 disk for a pair) | 1 per mirror | up to 2× | 1× (write both) | OS disks, small DBs |
| **RAID 5** | Striping + distributed single parity | n − 1 | 1 | (n−1)× | Small writes: **4 I/Os** each | Read-heavy, capacity-focused |
| **RAID 6** | Striping + double parity | n − 2 | 2 | (n−2)× | Small writes: **6 I/Os** each | Large arrays, large disks |
| **RAID 10** (1+0) | Striped mirrors | n/2 | 1 per mirror pair (up to n/2 if lucky) | n× | n/2× | Databases, write-heavy OLTP |

### The RAID-5 small-write penalty

Updating one data block requires keeping parity correct:

1. Read old data block.
2. Read old parity block.
3. Compute new parity = old parity ⊕ old data ⊕ new data.
4. Write new data block.
5. Write new parity block.

**4 I/Os per logical write** (2 reads + 2 writes); RAID 6 needs 6 (two parity blocks). Full-stripe writes avoid the penalty (compute parity from new data only). This is why RAID 5/6 are poor for random-write-heavy databases and RAID 10 is preferred.

**Write-hole problem**: a crash between writing data and parity leaves them inconsistent; a later reconstruction produces garbage. Mitigated by battery/flash-backed controller caches, journaling (Linux md write journal), or ZFS RAID-Z's copy-on-write full-stripe writes.

## Internal Mechanism

### Rebuild risk

When a disk fails in RAID 5, the array runs **degraded**: every read of the missing disk's data reads all other disks. Rebuilding onto a replacement requires reading *every* block of *every* surviving disk — for 16 TB drives, that's days of heavy I/O. During the rebuild:

- a second disk failure (disks from the same batch age together) loses the array;
- an **unrecoverable read error (URE)** on a surviving disk leaves a stripe unrecoverable.

With consumer drives rated at 1 URE per 10¹⁴ bits (~12.5 TB), reading 60 TB during a rebuild makes an error likely. Hence: **RAID 6 or RAID 10 for large drives**, hot spares, and scrubbing (periodically reading everything to catch latent errors early).

:::depth{level=advanced}
### Beyond classic RAID

- **Erasure coding** (Reed–Solomon, e.g., 10+4) generalizes parity: any k of n fragments reconstruct the data. Object stores (S3-class systems, Ceph, HDFS EC) use it across machines and racks for far better storage efficiency than 3× replication.
- **ZFS RAID-Z** avoids the write hole with variable-width COW stripes and checksums every block, so it can tell *which* copy is corrupt.
- In the cloud, you rarely build RAID yourself for durability — the provider replicates volumes — but you may still stripe volumes (RAID 0) to aggregate IOPS/throughput limits.
:::

## Example

Capacity and tolerance with 8 × 4 TB disks:

| Level | Usable | Failures tolerated |
|---|---|---|
| RAID 0 | 32 TB | 0 |
| RAID 5 | 28 TB | 1 |
| RAID 6 | 24 TB | 2 |
| RAID 10 | 16 TB | 1 guaranteed (up to 4 if in different mirror pairs) |

Random write IOPS (each disk ~150 IOPS, 8 disks = 1,200 raw): RAID 10 ≈ 600, RAID 5 ≈ 300, RAID 6 ≈ 200.

## Complexity & Performance

- RAID 0 and 10 scale reads and writes with disks.
- Parity RAID reads scale well; small random writes pay 4× (RAID 5) or 6× (RAID 6) I/O.
- Degraded and rebuilding arrays perform much worse — plan capacity for degraded mode.

## Trade-offs

Capacity efficiency (RAID 5/6) vs write performance and rebuild safety (RAID 10); cost of disks vs cost of downtime and data loss.

## Failure Modes

- Second failure or URE during a long rebuild.
- Write hole after power loss with parity RAID.
- Controller failure (hardware RAID metadata tied to a controller model).
- **Logical errors replicate instantly**: `rm -rf`, application bugs, ransomware and corruption are faithfully mirrored.

## In Production

- **RAID is not a backup.** It protects against disk failure only; backups (point-in-time, off-site, tested restores) protect against deletion, corruption and disasters.
- Databases on bare metal typically use RAID 10 on SSDs; distributed systems (Cassandra, Kafka, HDFS) often skip RAID and rely on replication across machines.

## Deeper Connections

- Replication across machines is RAID 1 at the system level — with network partitions and consistency problems added ([Replication](lesson:db-replication)).
- Quorums and erasure coding generalize "survive k failures" ([Quorums & Consensus](lesson:db-quorums-consensus)).

## Common Misconceptions

- **"RAID is a backup."** It isn't.
- **"RAID 5 is safe for large arrays."** Long rebuilds on large drives make second failures and UREs a real risk.
- **"RAID 10 can survive any two failures."** Only if the two failed disks are in different mirror pairs.

## Interview Questions

### [L1 · compare] Compare RAID 0, 1, 5 and 10.

RAID 0 stripes data for speed with no redundancy — any disk failure loses everything. RAID 1 mirrors data for redundancy at 50% capacity. RAID 5 stripes data with distributed parity: survives one failure with n−1 capacity but has a small-write penalty (4 I/Os). RAID 10 stripes across mirrored pairs: fast reads and writes and good fault tolerance, at 50% capacity — preferred for write-heavy databases.

### [L2 · how] How does parity allow RAID 5 to recover a failed disk?

Each stripe's parity block is the XOR of its data blocks. XOR is reversible: any single missing block equals the XOR of all the remaining blocks in the stripe (including parity), so the controller reconstructs it on reads and rebuilds it onto a replacement disk.

### [L2 · numerical] Why does a small write in RAID 5 cost 4 disk I/Os?

To update one data block and keep parity consistent: read the old data, read the old parity, write the new data, and write the new parity computed as old parity ⊕ old data ⊕ new data — two reads plus two writes.

### [L3 · why] Why is RAID 5 considered risky with very large disks?

Rebuilding after a failure must read every block of every surviving disk; with multi-TB drives this takes many hours to days, during which the array has no redundancy. A second disk failure or a single unrecoverable read error during the rebuild can make data unrecoverable. RAID 6 or RAID 10 reduce this risk.

## Practice

### [numeric 28] Eight 4 TB disks in RAID 5: usable capacity in TB?

:::answer
(n − 1) × 4 TB = 7 × 4 = **28 TB**.
:::

### [mcq] Which RAID level offers no fault tolerance at all?

- [x] RAID 0
- [ ] RAID 1
- [ ] RAID 5
- [ ] RAID 10

RAID 0 only stripes.

## Quick Revision

- Striping (speed), mirroring (copy), parity (XOR reconstruction).
- RAID 0: n capacity, 0 failures. RAID 1: n/2, mirrors. RAID 5: n−1, 1 failure, small write = 4 I/Os. RAID 6: n−2, 2 failures, 6 I/Os. RAID 10: n/2, fast writes, 1 per pair.
- Rebuilds on large disks are long and risky (second failure, UREs) → RAID 6/10, scrubbing, hot spares.
- Write hole with parity RAID.
- **RAID is not a backup.**
