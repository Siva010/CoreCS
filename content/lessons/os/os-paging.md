---
title: "Paging, Page Tables and Multi-Level Page Tables"
subject: os
level: 6
order: 3
summary: "How virtual addresses become physical addresses: pages and frames, the page-table entry, address-splitting arithmetic, and why page tables are trees."
depth: core
difficulty: 3
minutes: 50
relevance: essential
stage: 2
prerequisites: [os-address-spaces]
related: [os-tlb, os-page-faults, os-segmentation, os-hugepages-numa, os-cow-mmap]
visualizations: [address-translation]
tags: [paging, page table, page frame, page table entry, pte, virtual address, physical address, offset, multi-level page table, inverted page table, mmu, valid bit, dirty bit]
---

## Mental Model

Paging is a **giant lookup table in a library**. Memory is cut into fixed-size chunks — **pages** in virtual space, **frames** in physical RAM, both typically 4 KB. A virtual address is split into two parts:

- the **page number** — *which* chunk (look it up in the table to find the frame),
- the **offset** — *where inside* the chunk (copied unchanged).

Because every chunk is the same size, any page can go into any free frame. There are no holes of the wrong size — so **physical memory never suffers external fragmentation**. The cost is the table itself, which is why page tables are multi-level trees and why the TLB exists.

## Definition

- **Page**: fixed-size block of virtual memory. **Frame**: same-size block of physical memory.
- **Page table**: per-process data structure mapping virtual page numbers (VPN) to physical frame numbers (PFN), plus permission and status bits.
- **Page-table entry (PTE)**: one mapping — frame number + bits (valid/present, read/write, user/supervisor, executable, accessed, dirty, …).
- **MMU (memory-management unit)**: hardware that translates every virtual address using the page table (with the [TLB](lesson:os-tlb) as a cache).

## Why It Exists

**The problem.** Virtual addresses need to be translated to physical ones, and the translation table must stay small and fast. The question is *at what granularity* to translate.

**Without it.** Earlier schemes allocated each process one contiguous region (base + limit registers) or variable-sized segments. Both suffer from **external fragmentation** of physical memory and make growing a process painful ([Segmentation](lesson:os-segmentation)). Paging:

- eliminates external fragmentation (any frame fits any page),
- allows non-contiguous physical placement of a contiguous virtual range,
- enables per-page protection, sharing (map the same frame into several processes), demand paging and copy-on-write.

**The idea.** Fragmentation happens because pieces come in different sizes. So make *every* piece the same size. Then any free frame fits any page, and the translation only needs one number per page instead of one per byte.

**From idea to mechanism.** One table entry per page → a table per process (**page table**). That table is too big if stored flat → store it as a tree, skipping empty parts (**multi-level tables**). Walking the tree on every access is slow → cache recent answers (**TLB**, next lesson).

:::callout[That's all it is]{type=insight}
Chop memory into 4 KB pages. Keep a table saying "virtual page N lives in physical frame M". The bottom 12 bits of an address pass through unchanged; only the page number is looked up.
:::

## How It Works

### Address translation arithmetic

For page size `2^d` bytes, the low `d` bits of a virtual address are the **offset**; the remaining high bits are the **VPN**.

```text
virtual address (32-bit, 4 KB pages → d = 12)
┌────────────────────────── 20 bits ──────────────────┬────── 12 bits ─────┐
│                 VPN (virtual page number)            │   offset           │
└──────────────────────────────────────────────────────┴────────────────────┘
                     │ page table lookup                        │ unchanged
                     ▼                                          ▼
physical address   [ PFN (frame number) ]                   [ offset ]
```

**Worked example**: 32-bit addresses, 4 KB pages. Virtual address `0x0001_3ABC`.

- Offset = low 12 bits = `0xABC`.
- VPN = `0x0001_3ABC >> 12` = `0x13` (= 19).
- Page table says VPN 19 → PFN `0x7F2`.
- Physical address = `(0x7F2 << 12) | 0xABC` = `0x7F2ABC`.

### The page-table entry

| Bit / field | Meaning | Used for |
|---|---|---|
| Present / valid | Page is in RAM | Missing → page fault |
| PFN | Physical frame number | Translation |
| R/W | Writable? | Protection; COW (marked read-only) |
| U/S | User-accessible? | Kernel pages are supervisor-only |
| NX | No-execute | Non-executable stacks/heaps (security) |
| Accessed (A) | Set by hardware on access | Page replacement (clock algorithm) |
| Dirty (D) | Set by hardware on write | Must write back before evicting |

### Why a flat page table doesn't work

32-bit address space, 4 KB pages → 2²⁰ = 1,048,576 entries × 4 bytes = **4 MB per process**, even if the process uses only a few MB of memory. For 64-bit (48-bit virtual addresses) a flat table would need 2³⁶ entries × 8 bytes = **512 GB**. Impossible.

### Multi-level page tables

The fix follows from noticing that almost all of a 64-bit address space is empty — so don't store entries for empty regions. A tree lets you skip whole empty branches. Split the VPN into several indexes; each level is a page-sized table pointing to the next level. Unused regions simply have no lower-level tables.

**Two-level, 32-bit, 4 KB pages** (classic x86): 10-bit directory index, 10-bit table index, 12-bit offset.

```text
| 10 bits: page directory index | 10 bits: page table index | 12 bits: offset |
CR3 → page directory (1024 entries) → page table (1024 entries) → frame + offset
```

A process using 8 MB of contiguous memory needs 1 directory page + 2 page tables = 12 KB of page tables instead of 4 MB.

**x86-64 four-level paging** (48-bit virtual addresses): 9 + 9 + 9 + 9 bits of index + 12 bits of offset. Each table is 512 entries × 8 bytes = 4 KB. Levels: PML4 → PDPT → PD → PT. (Five-level paging, 57-bit addresses, exists for machines with huge memory.)

::viz{id=address-translation}

### The cost: memory accesses per translation

Without caching, a 4-level walk needs **4 memory reads** to find the PTE, then the 5th access for the data itself. That's why the **TLB** caches translations ([TLB](lesson:os-tlb)) and why CPUs also cache upper-level entries in page-walk caches.

## Internal Mechanism

### Page table size math (classic interview numericals)

For a single-level table: `entries = 2^(virtual address bits − offset bits)`; `size = entries × PTE size`.

- 32-bit VA, 4 KB pages, 4-byte PTEs → 2²⁰ × 4 B = **4 MB**.
- 32-bit VA, 8 KB pages → 2¹⁹ entries × 4 B = **2 MB**.
- Number of frames: physical memory size / page size; PFN bits = log₂(frames). 4 GB RAM / 4 KB = 2²⁰ frames → 20-bit PFN.

For multi-level tables with page-sized tables: entries per table = page size / PTE size; bits per level = log₂(entries per table). With 4 KB pages and 8-byte PTEs → 512 entries → 9 bits per level; 48 − 12 = 36 bits of VPN → 36 / 9 = **4 levels**.

### Alternatives

- **Inverted page table**: one entry per *physical frame* (storing which process/VPN occupies it), searched via a hash. Table size is proportional to RAM, not virtual space; lookups are slower and sharing is awkward. Used historically by PowerPC and IA-64.
- **Hashed page tables**: hash the VPN into buckets — useful for sparse 64-bit spaces.

:::depth{level=advanced}
### Who walks the page table?

On x86 and ARM, a **hardware page walker** reads the tables on a TLB miss — the OS only builds the tables and handles faults. MIPS and some older architectures used **software-managed TLBs**: a TLB miss trapped to the kernel, which walked its own structures and inserted the entry. Hardware walking is faster; software walking allows arbitrary page-table formats.

### Page tables and shared memory

Two processes share a frame by having PTEs in both page tables point to the same PFN — how shared libraries, `MAP_SHARED` mappings and fork's copy-on-write work. The kernel tracks, per physical page, how many mappings point to it (`struct page` refcounts and reverse mappings) so it can unmap it everywhere when evicting.
:::

## Example

Reading a process's page table through `/proc` (requires root to see PFNs):

```bash
# Virtual→physical for an address using /proc/<pid>/pagemap: each 8-byte entry per page
# bit 63 = present, bits 0–54 = PFN. Tools like `page-types` or small scripts decode it.
$ sudo ./virt2phys <pid> 0x7ffd6bbbe000
vpn=0x7ffd6bbbe present=1 pfn=0x1a2f34 phys=0x1a2f34000
```

Useful mostly to prove that consecutive virtual pages are scattered across physical memory.

## Complexity & Performance

- Translation cost with a TLB hit: ~0–1 cycle (in parallel with cache access). With a miss: a page walk of up to 4 levels (often cached in L1/L2 and page-walk caches: ~10–100 cycles; to DRAM: hundreds).
- Page-table memory: roughly 0.2% of mapped memory with 4 KB pages (8-byte PTE per 4 KB) plus upper levels — noticeable for processes mapping hundreds of GB, and multiplied when many processes map the same large shared region (PostgreSQL's shared buffers). Huge pages cut this ([Huge Pages & NUMA](lesson:os-hugepages-numa)).

## Trade-offs

| Page size | Pros | Cons |
|---|---|---|
| Small (4 KB) | Little internal fragmentation, fine-grained protection and sharing | Big page tables, more TLB misses |
| Large (2 MB / 1 GB huge pages) | Fewer TLB misses, tiny page tables | Internal fragmentation, costly COW (copying 2 MB), allocation difficulty |

Multi-level tables save memory for sparse address spaces but add memory accesses per walk.

## Failure Modes

- **Page faults** for non-present pages (normal) or invalid accesses (segfault).
- **Page-table bloat** when many processes map large shared regions with small pages.
- **TLB thrashing** when the working set spans more pages than the TLB can cover.
- **Internal fragmentation**: on average half a page wasted per mapping region's last page.

## In Production

- `/proc/meminfo` `PageTables:` shows total page-table memory — worth checking on database servers with hundreds of backend processes each mapping large shared memory.
- Huge pages for databases and JVMs (`vm.nr_hugepages`, `-XX:+UseLargePages`) reduce page-table and TLB overhead.
- Memory protection bits power security features: NX stacks, W^X JIT policies, guard pages.

## Deeper Connections

- The TLB caches this lookup: [TLB](lesson:os-tlb).
- A non-present PTE leads to [page faults](lesson:os-page-faults) and demand paging; the accessed/dirty bits drive [page replacement](lesson:os-page-replacement).
- Databases reimplement the idea: a **buffer pool page table** maps page IDs to buffer frames ([Buffer Pool](lesson:db-buffer-pool)); B+ tree nodes are pages.

## Common Misconceptions

- **"Paging means swapping to disk."** Paging is the translation scheme; moving pages to disk (swap) is optional.
- **"Paging eliminates fragmentation."** It eliminates *external* fragmentation of physical memory; internal fragmentation remains.
- **"The OS translates every address."** The hardware MMU does; the OS only sets up tables and handles faults.

## Interview Questions

### [L1 · conceptual] What is paging?

A memory-management scheme that divides virtual memory into fixed-size pages and physical memory into same-size frames, and maps pages to frames through a per-process page table. It allows non-contiguous physical allocation, eliminates external fragmentation, and enables protection, sharing and demand paging.

### [L1 · how] How is a virtual address translated to a physical address in paging?

Split the virtual address into a page number (high bits) and an offset (low bits). Use the page number to look up the page-table entry (via the TLB or a page-table walk) to get the frame number. The physical address is the frame number concatenated with the unchanged offset. If the entry isn't valid, the MMU raises a page fault.

### [L2 · numerical] A system has 32-bit virtual addresses, 4 KB pages and 4-byte page-table entries. How large is a single-level page table?

Offset = 12 bits, so 20 bits of page number → 2²⁰ entries × 4 bytes = **4 MB** per process.

### [L2 · why] Why do we use multi-level page tables?

A flat table must have an entry for every virtual page even if unused — 4 MB per process for 32-bit, and impossibly large for 64-bit address spaces. Multi-level tables form a tree where unused regions have no lower-level tables, so memory is proportional to the used address space. The cost is extra memory accesses per translation, mitigated by the TLB.

### [L2 · numerical] 48-bit virtual addresses, 4 KB pages, 8-byte PTEs, page-sized tables. How many levels are needed?

Offset 12 bits → 36 bits of VPN. Each 4 KB table holds 4096 / 8 = 512 entries = 9 bits of index. 36 / 9 = **4 levels** (x86-64's PML4 → PDPT → PD → PT).

### [L3 · compare] What are the trade-offs of larger page sizes?

Larger pages mean fewer entries (smaller page tables), fewer TLB misses (more memory covered per entry), and fewer page faults for sequential access. Downsides: more internal fragmentation, coarser protection/sharing, more expensive copy-on-write and page-outs, and harder allocation of large contiguous physical blocks.

### [L3 · compare] What is an inverted page table and when would you use it?

A single system-wide table with one entry per physical frame, recording which process and virtual page occupy it. Its size scales with physical memory, not with the huge virtual address space, but lookups require searching (typically hashing on process ID + VPN), and sharing a frame among several virtual pages is awkward. Used where virtual spaces are very large relative to RAM (historically PowerPC, IA-64).

### [L4 · design] A PostgreSQL server with 400 connections and 64 GB shared_buffers shows 20 GB of PageTables in /proc/meminfo. Explain and propose fixes.

Each backend process maps the shared-buffer region with its own page tables. With 4 KB pages, mapping 64 GB needs ~128 MB of PTEs per process once fully touched; hundreds of processes multiply that into tens of GB. Fixes: use huge pages for shared memory (`huge_pages = on` with pre-allocated `vm.nr_hugepages`) — 2 MB pages cut PTE memory by 512× — and reduce the number of backends with a connection pooler (PgBouncer).

## Practice

### [numeric 4] With 32-bit virtual addresses, 4 KB pages and 4-byte PTEs, how many MB does a single-level page table occupy?

:::answer
2³² / 2¹² = 2²⁰ entries × 4 B = 4 × 2²⁰ B = **4 MB**.
:::

### [exercise] With 4 KB pages, virtual address 0x3A7F9 maps through a page table where VPN 0x3A → PFN 0x1C. What is the physical address?

:::solution
Offset = low 12 bits = `0x7F9`. VPN = `0x3A7F9 >> 12` = `0x3A`. PFN = `0x1C`. Physical = `(0x1C << 12) | 0x7F9` = **`0x1C7F9`**.
:::

### [numeric 20] A machine has 4 GB of physical memory and 4 KB pages. How many bits are needed for the physical frame number?

:::answer
4 GB / 4 KB = 2³² / 2¹² = 2²⁰ frames → **20 bits**.
:::

## Quick Revision

- Pages (virtual) and frames (physical), same size (4 KB typical).
- Address = VPN | offset; physical = PFN | offset. Offset bits = log₂(page size).
- PTE: present, PFN, R/W, U/S, NX, accessed, dirty.
- Flat table size = 2^(VA bits − offset bits) × PTE size → 4 MB for 32-bit/4 KB/4 B.
- Multi-level: entries per table = page size / PTE size; x86-64: 4 levels × 9 bits + 12-bit offset.
- No external fragmentation of physical memory; internal fragmentation remains.
- Walks cost memory accesses → TLB. Inverted tables scale with RAM.
