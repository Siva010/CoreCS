---
title: "Storage Devices: HDDs, SSDs, NVMe and Disk Scheduling"
subject: os
level: 8
order: 1
summary: "How spinning disks and flash actually work, why random vs sequential I/O matters so much, what IOPS, throughput and latency mean, and where classic disk scheduling still applies."
depth: core
difficulty: 3
minutes: 40
relevance: high
stage: 3
prerequisites: [os-hardware-model]
related: [os-filesystem-internals, os-page-cache, os-raid, db-lsm-trees, db-btree, os-io-models]
labs: [disk-scheduling]
tags: [hdd, ssd, nvme, seek time, rotational latency, iops, throughput, write amplification, ftl, garbage collection, trim, disk scheduling, sstf, scan, c-scan, look, io scheduler]
---

## Mental Model

- A **hard disk** is a record player: to read data, a mechanical arm must **seek** to the right track and wait for the platter to **rotate** the sector under the head. Moving the arm takes milliseconds — an eternity for a CPU. Reading many consecutive sectors after one seek is cheap; jumping around is catastrophically slow.
- An **SSD** is a warehouse of flash chips with no moving parts: any location is reachable in microseconds, and many chips work in parallel. But flash has a quirk — you can write a page only once before erasing it, and you can only erase big blocks — so the SSD runs its own internal "operating system" (the FTL) that shuffles data around, with its own garbage collector.

## Definition

- **Seek time**: time to move an HDD's head to the target track (~3–10 ms average).
- **Rotational latency**: time for the sector to rotate under the head — on average half a revolution (7,200 RPM → 8.33 ms per revolution → ~4.17 ms average).
- **Transfer time**: time to read the data once positioned (~100–250 MB/s sequential for HDDs).
- **IOPS**: I/O operations per second (usually small random reads/writes, e.g., 4 KB).
- **Throughput / bandwidth**: bytes per second (usually large sequential transfers).
- **Latency**: time per operation.
- **FTL (flash translation layer)**: SSD firmware mapping logical block addresses to physical flash pages, handling wear leveling and garbage collection.

## Why It Exists

Storage is where data survives power loss. Its performance characteristics — mechanical for HDDs, erase-before-write for flash — shape filesystems, databases (B-trees vs LSM trees), and OS I/O scheduling. You can't reason about database performance without them.

## How It Works

### HDD access time

```text
access time = seek + rotational latency + transfer
```

**Example**: 7,200 RPM disk, 4 ms average seek, 4 KB read at 150 MB/s:

- rotation: 60/7200 = 8.33 ms per revolution → average 4.17 ms
- transfer: 4 KB / 150 MB/s ≈ 0.027 ms
- **total ≈ 8.2 ms → ~120 random IOPS.**

Sequential read: after one seek, stream at 150 MB/s → 1 GB in ~7 s. Random 4 KB reads of the same 1 GB (262,144 reads × 8.2 ms): **~36 minutes**. That 300× gap is why HDD-era databases obsessed over sequential I/O.

### SSD internals

- Flash is organized in **pages** (4–16 KB, the unit of read/write) grouped into **erase blocks** (hundreds of pages, several MB — the unit of erase).
- Pages can't be overwritten in place: an update writes the new data to a fresh page and marks the old one **stale**. The FTL remaps the logical address.
- **Garbage collection**: to reclaim stale pages, the FTL copies still-valid pages out of a block and erases it. This background copying causes **write amplification** (the device writes more than the host asked) and occasional latency spikes.
- **Wear leveling**: each block endures a limited number of program/erase cycles (thousands for TLC/QLC), so the FTL spreads writes.
- **TRIM/discard**: the OS tells the SSD which logical blocks are no longer used, so GC doesn't copy dead data.
- **Over-provisioning**: spare capacity gives GC room, reducing amplification.

### NVMe

NVMe SSDs attach via PCIe with up to 64K queues × 64K commands each, designed for parallel flash and multicore CPUs. Typical: ~10–100 µs latency, hundreds of thousands to over a million random IOPS, several GB/s sequential. SATA SSDs are limited by the older AHCI interface (single queue of 32 commands, ~550 MB/s).

| | HDD (7,200 RPM) | SATA SSD | NVMe SSD |
|---|---|---|---|
| Random 4 KB read latency | ~5–10 ms | ~100 µs | ~10–100 µs |
| Random read IOPS | ~100–200 | ~50k–100k | 500k–1M+ |
| Sequential throughput | ~150–250 MB/s | ~550 MB/s | 3–14 GB/s |
| Random vs sequential gap | Huge (~100×+) | Moderate | Small (but still real) |

## Internal Mechanism

### Disk scheduling algorithms (for HDDs)

Given a queue of cylinder requests, the order matters because seeks dominate. Head at cylinder **53**, queue: **98, 183, 37, 122, 14, 124, 65, 67** (cylinders 0–199):

| Algorithm | Order | Total head movement |
|---|---|---|
| **FCFS** | 98, 183, 37, 122, 14, 124, 65, 67 | **640** |
| **SSTF** (shortest seek time first) | 65, 67, 37, 14, 98, 122, 124, 183 | **236** |
| **SCAN** (elevator, moving toward 0 first) | 37, 14, (0), 65, 67, 98, 122, 124, 183 | **236** (53→0 = 53, 0→183 = 183) |
| **C-SCAN** (moving toward 199, jump back) | 65, 67, 98, 122, 124, 183, (199), (0), 14, 37 | **382** counting the return jump (146 + 199 + 37) |
| **LOOK** (like SCAN but turn at last request, moving up first) | 65, 67, 98, 122, 124, 183, 37, 14 | **299** (130 + 169) |
| **C-LOOK** (moving up, jump to lowest request) | 65, 67, 98, 122, 124, 183, 14, 37 | **322** (130 + 169 + 23) |

- **SSTF** minimizes movement greedily but can **starve** far requests.
- **SCAN/C-SCAN** give bounded waiting; **C-SCAN** gives more uniform wait times (treats cylinders as a circle).
- **LOOK/C-LOOK** avoid traveling to the disk's edge when no requests are there.

::lab{id=disk-scheduling}

### Linux I/O schedulers today

The block layer (blk-mq) offers `none`, `mq-deadline`, `bfq` and `kyber`. For NVMe SSDs, `none` is common — the device reorders internally and seek distance is meaningless. `mq-deadline` (with read/write expiry deadlines to prevent starvation) suits HDDs and many SATA devices; `bfq` provides fairness for desktops. The concern shifted from **seek distance** to **latency, fairness and queue depth**.

:::depth{level=advanced}
### Queue depth and Little's Law

SSDs achieve high IOPS only with many requests in flight (parallelism across flash channels). Little's Law: `IOPS = queue depth / latency`. At QD=1 with 80 µs latency: 12,500 IOPS; at QD=32: up to ~400k if the device scales. That's why async I/O (io_uring, AIO) and multiple threads are needed to saturate NVMe — and why a single-threaded synchronous reader looks "slow" on a fast SSD.
:::

## Example

Measuring a device with `fio`:

```bash
# random 4 KB reads, queue depth 32, direct I/O (bypass page cache)
$ fio --name=randread --rw=randread --bs=4k --iodepth=32 --ioengine=io_uring \
      --direct=1 --size=4G --runtime=30 --filename=/dev/nvme0n1
  read: IOPS=612k, BW=2390MiB/s, lat avg=52us, p99=110us
```

And `iostat -x 1` during production load: `r/s`, `w/s` (IOPS), `rkB/s` (throughput), `r_await` (latency in ms), `aqu-sz` (average queue size), `%util` (misleading for parallel devices like NVMe — 100% doesn't mean saturated).

## Complexity & Performance

- HDD: optimize for **sequential** access and request ordering; random I/O is the enemy.
- SSD: random reads are fine; **random small writes** cause amplification and GC; sequential/append-heavy writes are gentler (LSM trees, log-structured filesystems).
- Everything: batching and parallelism (queue depth) raise throughput; latency percentiles matter as much as averages (GC spikes).

## Trade-offs

- **HDD**: cheapest per TB, excellent sequential throughput, terrible random I/O → archives, backups, cold storage, big sequential logs.
- **SSD/NVMe**: fast random I/O, low latency, higher cost per TB, finite write endurance → databases, OLTP, everything latency-sensitive.
- **Scheduling**: throughput-optimal (SSTF) vs fair (SCAN/deadline).

## Failure Modes

- **Latency spikes from SSD garbage collection** under sustained random writes, especially when the drive is nearly full.
- **Write endurance exhaustion** from write-amplifying workloads (check SMART `Percentage Used`).
- **Volatile write caches** that lie about completion without power-loss protection — enterprise SSDs have capacitors; consumer drives may lose acknowledged writes on power failure.
- **Noisy neighbors** on shared cloud volumes (EBS gp2 burst credits exhaustion, IOPS caps).

## In Production

- Cloud block storage (AWS EBS, GCP PD) is **network-attached**: latency ~0.5–2 ms and provisioned IOPS/throughput limits — often the bottleneck for databases. Local NVMe instance storage is far faster but ephemeral.
- Databases choose data structures by device: B-trees (update in place, random writes) vs LSM trees (sequential writes, compaction) — see [LSM Trees](lesson:db-lsm-trees).
- Case study: [Slow queries from disk I/O](case:missing-index) shows how a missing index turns into random I/O.

## Deeper Connections

- Filesystems and the page cache sit on top of these devices ([Filesystem Internals](lesson:os-filesystem-internals), [Page Cache](lesson:os-page-cache)).
- Log-structured designs (LSM trees, WAL, Kafka) exist because sequential writes are cheap ([WAL](lesson:db-wal-durability)).
- RAID combines devices for performance and redundancy ([RAID](lesson:os-raid)).

## Common Misconceptions

- **"SSDs make random vs sequential irrelevant."** Random reads are fine, but random writes still cost amplification; sequential throughput is still higher and queue depth matters.
- **"%util = 100% means the disk is saturated."** For devices serving many requests in parallel (SSDs, RAID arrays), not necessarily.
- **"Disk scheduling algorithms matter on NVMe."** Seek distance doesn't exist on flash; modern concerns are fairness and latency.

## Interview Questions

### [L1 · compare] Compare HDDs and SSDs.

HDDs store data on spinning platters read by a moving head: access requires seek (~ms) plus rotational latency (~ms), so random I/O is ~100–200 IOPS while sequential throughput is decent. SSDs use flash with no moving parts: ~10–100 µs latency and hundreds of thousands of IOPS, but flash can't be overwritten in place, so SSDs need an FTL with garbage collection and wear leveling, causing write amplification and finite endurance. SSDs cost more per TB.

### [L2 · numerical] A disk spins at 10,000 RPM with 5 ms average seek. What is the average time to read a random 4 KB block (ignore transfer)?

Rotation: 60/10,000 = 6 ms per revolution → 3 ms average. Total ≈ 5 + 3 = **8 ms** (~125 IOPS).

### [L2 · numerical] Head at 53, queue 98, 183, 37, 122, 14, 124, 65, 67. Total head movement under SSTF?

53→65 (12) →67 (2) →37 (30) →14 (23) →98 (84) →122 (24) →124 (2) →183 (59) = **236** cylinders.

### [L2 · compare] SCAN vs C-SCAN?

SCAN moves the head back and forth across the disk servicing requests in both directions (like an elevator); requests near the middle get serviced more often than those at the edges. C-SCAN services requests in only one direction, then jumps back to the start without servicing, treating the disk as circular — giving more uniform waiting times.

### [L3 · why] What is write amplification in SSDs and why does it happen?

The ratio of data physically written to flash vs data written by the host. Flash pages can't be overwritten and erase happens in large blocks, so when the SSD reclaims space it must copy still-valid pages out of a block before erasing it. Random small writes scatter valid data, forcing more copying. It reduces throughput and endurance; mitigations are TRIM, over-provisioning, and sequential write patterns.

### [L3 · debugging] A PostgreSQL server on a cloud volume has fine CPU and memory but high query latency; iostat shows r_await of 12 ms and ~3,000 IOPS steady. What's going on?

The workload is I/O-bound and has likely hit the volume's provisioned IOPS limit (a flat ~3,000 IOPS is the default baseline for AWS gp3), causing queuing (latency 12 ms instead of ~1 ms). Options: provision more IOPS/throughput, move to local NVMe or a faster volume class, reduce I/O (more RAM for caching, better indexes to avoid scans, fewer random reads), and check for sequential scans or checkpoint write bursts.

### [L4 · design] You're choosing storage for a write-heavy time-series database ingesting 500k points/s. What properties of storage devices inform the design?

Random small writes are expensive on SSDs (amplification, GC) and devastating on HDDs, so batch and append: a WAL for durability plus in-memory buffering, flushing large sorted immutable files (LSM-style) with compression; compaction trades read and write amplification. Choose NVMe with power-loss protection for the WAL (fsync latency matters), provision throughput for compaction, monitor endurance, and tier older data to cheaper storage. Measure p99 fsync latency and GC spikes under sustained load, not just peak IOPS.

## Practice

### [numeric 236] Head at 53, requests 98, 183, 37, 122, 14, 124, 65, 67. Total head movement using SSTF?

:::answer
Order: 65, 67, 37, 14, 98, 122, 124, 183 → 12 + 2 + 30 + 23 + 84 + 24 + 2 + 59 = **236**.
:::

### [numeric 640] Same queue and head position using FCFS?

:::answer
|53−98| + |98−183| + |183−37| + |37−122| + |122−14| + |14−124| + |124−65| + |65−67| = 45 + 85 + 146 + 85 + 108 + 110 + 59 + 2 = **640**.
:::

### [numeric 4.17 ±0.02 unit=ms] What is the average rotational latency of a 7,200 RPM disk, in milliseconds?

:::answer
One revolution = 60/7200 s = 8.33 ms; average = half = **4.17 ms**.
:::

## Quick Revision

- HDD access = seek + rotational latency (half a revolution) + transfer → ~100–200 random IOPS.
- SSD: pages (write unit) in erase blocks (erase unit); FTL remaps; GC → **write amplification**; wear leveling; TRIM.
- NVMe: many deep queues; ~10–100 µs; needs queue depth (Little's Law) to reach peak IOPS.
- Disk scheduling (HDD): FCFS (fair, slow), SSTF (greedy, starves), SCAN/C-SCAN (elevator, bounded wait), LOOK/C-LOOK. Classic queue from 53: FCFS 640, SSTF 236.
- Linux blk-mq schedulers: none (NVMe), mq-deadline, bfq, kyber.
- Cloud volumes are network storage with IOPS caps.
