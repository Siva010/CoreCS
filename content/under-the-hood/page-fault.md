---
title: "What Happens on a Page Fault"
summary: "A load instruction misses in the TLB, the page walk finds no valid mapping, and the CPU traps. The kernel decides whether it's a minor fault, a major fault needing disk I/O, a copy-on-write, or a segmentation fault — then resumes the instruction as if nothing happened."
subjects: [os]
order: 5
related: [os-page-faults, os-paging, os-tlb, os-page-replacement, os-cow-mmap, os-page-cache]
---

A thread executes `mov rax, [rbx]` where `rbx` points into a memory-mapped file the process hasn't touched yet.

## [cpu] The load needs a translation

The CPU needs the physical address for the virtual address in `rbx`. It checks the TLB — miss ([TLB](lesson:os-tlb)).

## [mmu] Page-table walk

The MMU walks the 4-level page table from CR3: PML4 → PDPT → PD → PT (each step a memory access, possibly cached). The final page-table entry has its **present bit clear**. The walk fails.

## [cpu] Trap: page-fault exception

The CPU raises exception #14 (page fault), saves the faulting instruction's state, puts the faulting virtual address in CR2 and an error code (read/write, user/kernel, present/not-present) on the stack, and jumps to the kernel's handler in kernel mode.

## [kernel] Is the address legal?

The handler looks up the address in the process's list of virtual memory areas (VMAs). Outside any VMA, or a write to a read-only area → **SIGSEGV** (segmentation fault), usually killing the process. Here, the address is inside a file-backed, readable mapping → legitimate fault ([Page Faults](lesson:os-page-faults)).

## [kernel] Minor or major?

The kernel checks the **page cache** for that file offset ([Page Cache](lesson:os-page-cache)):

- **Minor fault**: the page is already in RAM (another process read it, or read-ahead fetched it). Just map it: ~1 µs.
- **Major fault**: not in RAM. The kernel allocates a frame (maybe evicting another page — [Page Replacement](lesson:os-page-replacement)), issues a read to the storage device, and puts the thread to sleep.

## [disk] Major fault: the I/O

The block layer submits the read; the NVMe device completes it in ~50–100 µs (a spinning disk: ~5–10 ms) and raises an interrupt. The kernel marks the page up to date and wakes the thread. Other threads ran on the CPU meanwhile.

## [kernel] Install the mapping

The kernel writes the page-table entry: physical frame number, present bit, permissions (read-only for now; a private writable mapping would later take a **copy-on-write** fault on the first write — [Copy-on-Write](lesson:os-cow-mmap)). It updates the page's reference bit and LRU lists.

## [cpu] Retry the instruction

The handler returns; the CPU re-executes `mov rax, [rbx]`. This time the page walk succeeds, the TLB caches the translation, and the load completes. The program never knew — except for the time spent: a major fault costs ~10,000× more than a normal memory access, which is why `perf stat -e major-faults` and `/proc/<pid>/stat` fault counters matter for latency.
