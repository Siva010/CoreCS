---
title: "What Happens When You Call malloc(64)"
summary: "Why most allocations never reach the kernel: thread caches and size-class bins in the allocator, when it calls brk or mmap, why the kernel hands out only virtual memory, and how the first write turns it into a physical page."
subjects: [os]
order: 4
related: [os-dynamic-allocation, os-address-spaces, os-page-faults, os-paging, os-cow-mmap]
---

Your C code calls `char *p = malloc(64);` and then writes `p[0] = 'x';`. Several layers cooperate to turn that into real memory.

## [app] The request

The program asks for 64 bytes. It doesn't care where they come from — only that the returned pointer is valid, aligned (16 bytes on x86-64), and not in use by anything else.

## [runtime] Fast path: the thread cache

The allocator (glibc malloc, jemalloc, tcmalloc…) rounds 64 bytes up to a size class and checks the calling thread's cache (glibc: tcache) for a free chunk of that class. If one is there, it pops it off a free list and returns — tens of nanoseconds, no locks, no system call. Most small allocations end here ([Dynamic Allocation](lesson:os-dynamic-allocation)).

## [runtime] Slower path: arenas and bins

On a cache miss, the allocator looks in its arena's bins (lists of free chunks by size), may split a larger free chunk or take space from the "top" of the heap. Arenas are per-thread-ish to reduce lock contention; a lock is taken briefly here.

## [kernel] Out of heap: brk or mmap

If the arena has no room, the allocator asks the kernel for more address space: `brk()`/`sbrk()` to extend the heap segment, or `mmap()` for a new region. Large requests (glibc default ≥ 128 KB) get their own `mmap` so they can be returned to the OS with `munmap` when freed.

## [memory] The kernel hands out virtual memory only

`brk`/`mmap` just create or extend a virtual memory area in the process's address space and update bookkeeping. **No physical page is allocated yet** — the kernel is lazy, and with overcommit it may promise more memory than exists ([Address Spaces](lesson:os-address-spaces)).

## [app] malloc returns a pointer

The allocator writes its chunk header (size, flags) just before the returned address and hands back `p`. The program believes it has 64 bytes.

## [mmu] The first write faults

`p[0] = 'x'` touches a page with no page-table entry. The MMU raises a page fault; the kernel verifies the address is inside a valid, writable area, allocates a zeroed physical frame, installs the mapping, and restarts the instruction — the write succeeds ([Page Faults](lesson:os-page-faults)). Later accesses to that page cost nothing extra (until the TLB entry is evicted).

## [runtime] free(p) mostly doesn't return memory

`free(p)` puts the chunk back into the thread cache or bins for reuse. Memory usually isn't returned to the kernel (heap top trimming and `munmap` of large blocks are exceptions), which is why a process's RSS can stay high after freeing — and why fragmentation, not just leaks, can grow memory use over time.
