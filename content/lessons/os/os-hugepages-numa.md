---
title: "Huge Pages and NUMA: Memory at Server Scale"
subject: os
level: 7
order: 5
summary: "Why 4 KB pages hurt big-memory workloads, when huge pages help (and when transparent huge pages hurt), and how non-uniform memory access changes performance on multi-socket servers."
depth: senior
difficulty: 4
minutes: 35
relevance: medium
stage: 4
prerequisites: [os-tlb, os-thrashing-working-set]
related: [os-paging, os-cpu-caches-contention, os-mlfq-real-schedulers, db-buffer-pool]
tags: [huge pages, transparent huge pages, thp, hugetlbfs, numa, numa node, local memory, remote memory, first touch, numactl, interleave, khugepaged]
---

## Mental Model

**Huge pages**: if a library catalog lists every page of every book, the catalog becomes enormous and slow to search. If it lists whole chapters instead, the catalog is 512× smaller and one entry covers far more text — but you lose the ability to lend out single pages, and a chapter must sit in one contiguous place on the shelf.

**NUMA**: a big server is really **two or more computers glued together**, each socket with its own memory controller and RAM. Every CPU can read every byte, but "your own" RAM is faster than the other socket's. Where your data lives relative to where your thread runs quietly decides a large chunk of performance.

## Definition

- **Huge page**: a page larger than the base 4 KB — on x86-64, **2 MB** (PMD-level) or **1 GB** (PUD-level) — mapped by a single page-table entry.
- **hugetlbfs / explicit huge pages**: a pre-reserved pool (`vm.nr_hugepages`) that applications map explicitly (`MAP_HUGETLB`, `SHM_HUGETLB`).
- **Transparent Huge Pages (THP)**: the kernel automatically uses 2 MB pages for eligible anonymous memory, either at fault time or by **khugepaged** collapsing 4 KB pages later.
- **NUMA (Non-Uniform Memory Access)**: an architecture where memory access latency and bandwidth depend on which **node** (socket/die) the memory is attached to relative to the accessing CPU.

## Why It Exists

- Huge pages: memory sizes grew a million-fold while the TLB grew only modestly. With 4 KB pages, a 256 GB buffer pool needs 67 million PTEs and suffers constant TLB misses ([TLB](lesson:os-tlb)). One 2 MB entry replaces 512 small ones.
- NUMA: a single shared memory bus can't feed dozens of cores; giving each socket its own memory controller scales bandwidth — at the price of non-uniform latency.

## How It Works

### Huge pages

| | 4 KB pages | 2 MB huge pages | 1 GB huge pages |
|---|---|---|---|
| PTEs to map 64 GB | 16,777,216 | 32,768 | 64 |
| Page-table memory for 64 GB | ~128 MB | ~256 KB | trivial |
| TLB reach (1,536 entries) | 6 MB | 3 GB | 1.5 TB (separate 1 GB TLB entries are few) |
| Allocation | Easy | Needs 2 MB contiguous physical memory | Usually reserved at boot |

With 4-level paging, a 2 MB page also shortens the page walk by one level.

**Explicit huge pages** (databases, DPDK, JVM `-XX:+UseLargePages` with hugetlbfs): reserved up front, never swapped, guaranteed. **THP** requires no application changes but has trade-offs:

- **Allocation latency**: at fault time the kernel may need to **compact** memory to find 2 MB contiguous — direct compaction stalls.
- **khugepaged** CPU usage collapsing pages in the background.
- **Memory bloat**: touching one byte in a 2 MB region allocates 2 MB.
- **COW amplification**: after fork, a single-byte write copies 2 MB (Redis's warning).

Hence common advice: THP `madvise` mode (only regions that ask for it via `madvise(MADV_HUGEPAGE)`), and explicit huge pages for databases.

### NUMA

```text
   Node 0                              Node 1
┌───────────────┐   interconnect   ┌───────────────┐
│ cores 0–31     │ ◀─────────────▶ │ cores 32–63    │
│ L3 cache       │  (UPI / Infinity│ L3 cache       │
│ memory ctrl    │   Fabric)       │ memory ctrl    │
│ 256 GB RAM     │                 │ 256 GB RAM     │
└───────────────┘                  └───────────────┘
local access ≈ 80–100 ns          remote access ≈ 1.3–2× slower, lower bandwidth
```

Linux's default policy is **first touch**: a page is allocated on the node of the CPU that first writes it. Consequences:

- A thread that initializes a big array on node 0, then worker threads on node 1 process it → all remote accesses.
- The scheduler may migrate threads away from their memory; **automatic NUMA balancing** tries to move pages or tasks back together (with some overhead from sampling faults).

Tools and policies:

```bash
$ numactl --hardware              # nodes, CPUs, memory, distance matrix
$ numactl --cpunodebind=0 --membind=0 ./db   # pin CPU and memory to node 0
$ numactl --interleave=all ./cache           # spread pages round-robin across nodes
$ numastat -p <pid>                           # per-node memory of a process
```

**Interleave** trades peak locality for even bandwidth and no hotspot — often best for a shared structure accessed by all cores (e.g., a large buffer pool). **Bind** is best for partitioned workloads (one process per socket).

## Internal Mechanism

:::depth{level=senior}
### Zone reclaim and the "swap insanity" story

Early MySQL deployments on 2-socket boxes famously swapped with plenty of free RAM: a single mysqld process with a huge InnoDB buffer pool filled node 0 first (first touch from the initializing thread); when node 0 ran out, the kernel (with `zone_reclaim_mode` or strict node preference) reclaimed/swapped on node 0 instead of using node 1's free memory. Fixes were `numactl --interleave=all`, disabling zone reclaim (now the default), and later `innodb_numa_interleave`. The lesson generalizes: a single huge process spanning sockets should usually interleave its big shared structures.

### NUMA and the scheduler

The scheduler's load balancing respects topology domains (SMT → core → LLC → NUMA node) and is reluctant to migrate across nodes. Pinning with cpusets/`taskset` gives determinism; Kubernetes' Topology Manager can align CPUs, memory and devices (NICs/GPUs) on the same node for latency-sensitive pods. PCIe devices are also NUMA-local: a NIC attached to socket 1 is best served by threads and memory on node 1.
:::

## Example

A 2-socket database server: same query, same data in RAM, run bound to node 0's CPUs with memory on node 0 vs memory forced to node 1:

| Configuration | Throughput |
|---|---|
| CPU node 0, memory node 0 | 1.00× |
| CPU node 0, memory node 1 | ~0.7–0.8× (memory-bound scans) |
| Interleaved memory | ~0.85–0.95× (balanced) |

Numbers vary by hardware; memory-bandwidth-heavy workloads suffer most.

## Complexity & Performance

- Huge pages typically give **5–30%** improvements for random-access, big-memory workloads (databases, JVMs with large heaps, in-memory analytics) by cutting TLB misses and page-walk cost.
- THP compaction stalls can add **milliseconds** of latency at page-fault time; khugepaged uses background CPU.
- Remote NUMA access adds tens of ns per miss and reduces bandwidth; cross-socket cache-line bouncing (shared locks, atomics) is far costlier than within a socket.

## Trade-offs

| Choice | Benefit | Cost |
|---|---|---|
| Explicit huge pages | Guaranteed, no compaction, fewer TLB misses | Must reserve up front; memory not usable otherwise; config burden |
| THP always | Automatic gains | Latency spikes, bloat, COW amplification |
| THP madvise | Opt-in for regions that benefit | Apps must opt in |
| NUMA bind | Best locality | Uneven memory usage; a node can run out while the other is free |
| NUMA interleave | Even bandwidth, no hotspot | Average latency higher than local |

## Failure Modes

- Latency spikes from THP compaction; memory bloat surprises in containers.
- Redis/MongoDB warnings about THP; Redis fork COW amplified by huge pages.
- NUMA imbalance: one node's memory exhausted → swapping or OOM while the other node has free memory (with strict binding).
- Hidden cross-socket traffic from a single global lock or atomic counter.

## In Production

- PostgreSQL: `huge_pages = try|on` with `vm.nr_hugepages` sized for shared_buffers; Oracle and SQL Server similarly. Many ops guides say disable THP for databases.
- JVM: `-XX:+UseTransparentHugePages` or `-XX:+UseLargePages`; ZGC/Shenandoah benefit from large pages.
- Kubernetes supports `hugepages-2Mi` as a resource; Topology Manager aligns NUMA resources.
- Check with `grep -i huge /proc/meminfo`, `/sys/kernel/mm/transparent_hugepage/enabled`, `numastat`.

## Deeper Connections

- TLB reach math: [TLB](lesson:os-tlb). Page-table memory: [Paging](lesson:os-paging).
- NUMA is another level of the memory hierarchy; cache-line contention across sockets magnifies [CPU Caches & Contention](lesson:os-cpu-caches-contention).
- Database buffer pools are the classic beneficiaries ([Buffer Pool](lesson:db-buffer-pool)).

## Common Misconceptions

- **"Huge pages always improve performance."** THP can cause latency spikes and bloat; benefits depend on access patterns.
- **"All RAM is equally fast."** On NUMA systems, remote memory is measurably slower.
- **"NUMA only matters for HPC."** Any 2-socket database or JVM server is NUMA.

## Interview Questions

### [L2 · why] Why do databases often use huge pages?

Large buffer pools span tens or hundreds of GB. With 4 KB pages, TLB reach covers a tiny fraction, so random page accesses incur frequent TLB misses and page walks, and each backend process needs huge page tables (PostgreSQL's per-process page tables for shared memory). 2 MB pages multiply TLB reach by 512, shorten page walks and shrink page tables, typically improving throughput and reducing memory overhead.

### [L3 · compare] Explicit huge pages vs transparent huge pages?

Explicit huge pages are reserved in advance (hugetlbfs) and mapped deliberately: guaranteed, never swapped, no compaction at runtime, but they must be sized up front and are unusable for other purposes. THP are allocated automatically by the kernel for anonymous memory: no configuration, but compaction can stall allocations, khugepaged uses CPU, memory can bloat, and fork COW becomes expensive — so many databases recommend disabling THP or using madvise mode.

### [L3 · conceptual] What is NUMA and what is the "first-touch" policy?

On multi-socket systems each socket has local memory; accessing another socket's memory is slower. Linux allocates a page on the node of the CPU that first touches it. If initialization happens on one node and processing on another, the workload ends up doing remote accesses; placement of initialization threads matters.

### [L4 · debugging] A 2-socket server running one large in-memory cache process shows high latency and one NUMA node nearly out of memory while the other is half empty, with swapping. What happened and how do you fix it?

The process allocated most memory on one node (first touch by an initializing thread, or strict binding), filling that node; the kernel reclaimed/swapped on that node rather than spilling (policy-dependent), while threads on the other node incur remote access. Fix: interleave the large shared structure across nodes (`numactl --interleave=all` or the application's NUMA option), ensure zone reclaim is off, or run one instance per node with CPU+memory binding (partition the cache).

## Practice

### [numeric 512] How many 4 KB pages are covered by one 2 MB huge page?

:::answer
2 MB / 4 KB = 2,097,152 / 4,096 = **512**.
:::

### [mcq] Why can transparent huge pages increase memory usage during Redis background saves?

- [ ] THP disables copy-on-write
- [x] A small write to a shared page copies the whole 2 MB page
- [ ] THP pages cannot be freed
- [ ] THP forces Redis to write the snapshot twice

COW works at page granularity; bigger pages mean bigger copies.

## Quick Revision

- Huge pages (2 MB/1 GB): fewer PTEs, bigger TLB reach, shorter walks → big-memory workloads 5–30% faster.
- Explicit (hugetlbfs, reserved) vs **THP** (automatic; compaction stalls, bloat, COW amplification → often disabled/madvise for DBs).
- **NUMA**: local memory fast, remote slower; **first touch** decides placement.
- Bind for partitioned workloads; **interleave** for big shared structures.
- Tools: `numactl`, `numastat`, `/proc/meminfo` Huge*, THP sysfs settings.
