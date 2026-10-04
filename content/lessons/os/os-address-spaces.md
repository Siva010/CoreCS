---
title: "Address Spaces: Stack, Heap, Static Memory and Virtual vs Physical"
subject: os
level: 6
order: 1
summary: "What a process's memory actually looks like, where variables and objects live, how the stack works, and why every process can believe it owns address 0x400000."
depth: beginner
difficulty: 2
minutes: 35
relevance: essential
stage: 1
prerequisites: [os-processes]
related: [os-dynamic-allocation, os-paging, os-page-faults, os-threads]
tags: [address space, virtual memory, physical memory, stack, heap, static memory, bss, data segment, stack frame, stack overflow, memory layout]
---

## Mental Model

Every process gets a **private map of a huge imaginary city** — its virtual address space. On this map, the code district is always in the same place, the stack always starts near the top and grows down, the heap grows up from near the bottom. Two processes can both have a house at "42 Main Street" (the same virtual address) because each has its own map. The OS and the hardware's **MMU** secretly translate each map address to a real plot of land (a physical RAM frame) — or to "not built yet" (a page fault) — without the process ever seeing physical addresses.

## Definition

- **Physical memory**: the actual RAM, addressed by physical addresses (frames).
- **Virtual address space**: the range of addresses a process can use (on x86-64, 128 TiB for user space with 4-level paging), translated to physical addresses by the MMU using per-process page tables.
- **Stack**: per-thread memory for function call frames — local variables, arguments, return addresses — allocated and freed automatically in LIFO order.
- **Heap**: memory for dynamically allocated objects (`malloc`, `new`), with lifetimes independent of function calls.
- **Static (global) memory**: `.data` (initialized globals/statics) and `.bss` (zero-initialized), allocated for the program's lifetime.
- **Text**: the program's machine code, read-only and executable.

## Why It Exists

**The problem.** RAM is one shared array of bytes. If every program uses real RAM addresses, every program has to know where the others live.

**Without it.** Before virtual memory, programs used physical addresses directly: they had to be loaded at specific locations, a bug could overwrite another program or the OS, and a program couldn't be larger than physical RAM. Virtual address spaces provide:

1. **Isolation** — a process can't even *name* another process's memory.
2. **Simplicity** — every program sees the same clean layout, starting at fixed addresses; linkers and compilers can assume it.
3. **Flexibility** — the OS can place pages anywhere in RAM, share them (libraries), or not load them at all (demand paging), and give processes more virtual memory than physical RAM.

**The idea.** Add one level of indirection. Programs use *made-up* addresses; hardware translates each one to a real address using a table the OS controls. Because the program never sees real addresses, it can't reach memory that isn't in its table — and the OS can rearrange real memory behind its back.

:::callout[That's all it is]{type=insight}
Each process gets its own private numbering of memory, and the hardware looks up every address in a per-process table to find the real location. Isolation, a tidy layout and "more memory than RAM" all come from that lookup.
:::

## How It Works

### The layout (Linux x86-64, simplified)

```text
0x7fff_ffff_ffff ┌──────────────────────────┐  top of user space
                 │ stack (main thread) ↓     │  grows down; 8 MB limit by default
                 │                           │
                 │ mmap region               │  shared libraries, thread stacks,
                 │  (libc.so, libssl.so,     │  large malloc blocks, mapped files
                 │   thread stacks, …)       │
                 │                           │
                 │ heap ↑                    │  grows up via brk()
                 ├──────────────────────────┤
                 │ .bss   zero-initialized   │  static int counter;
                 │ .data  initialized        │  static int limit = 100;
                 │ .rodata constants         │  "hello"
                 │ .text  code (r-x)         │
0x0000_0040_0000 └──────────────────────────┘
0x0000_0000_0000   unmapped (null pointer dereferences fault here)
```

Addresses are randomized per run by **ASLR** (address space layout randomization) to make exploits harder.

### Where does each thing live?

```c
int limit = 100;               // .data  (static lifetime)
int counter;                   // .bss   (zero-initialized)
const char *msg = "hello";     // msg in .data; the string bytes in .rodata

void handle(int n) {           // code in .text
    int local = n * 2;         // stack (this call's frame)
    char buf[64];              // stack
    int *p = malloc(4096);     // p itself on the stack; the 4096 bytes on the heap
    static int calls = 0;      // .bss (static local: one copy for the whole program)
    calls++;
    free(p);
}
```

In Java/Python/Go: local primitive variables and references live on the stack (or in registers); **objects** live on the heap managed by a garbage collector (Go and the JVM may place objects on the stack if **escape analysis** proves they don't outlive the function).

### How the stack works

Why a separate stack at all: function calls nest and return in strict last-in-first-out order, so their memory can be managed with a single pointer — no searching, no free lists. Each function call pushes a **stack frame**: return address, saved registers, the caller's frame pointer, local variables. Returning pops it by moving the stack pointer — allocation and deallocation are just arithmetic on one register, which is why stack memory is extremely fast.

```text
higher addresses
┌──────────────┐
│ main's frame │
├──────────────┤
│ handle(n)    │  return addr → main, saved rbp, local, buf[64]
├──────────────┤  ← stack pointer (rsp) after handle's prologue
│ (free)       │
lower addresses
```

Every thread has its own stack; the stacks of all threads live in the same address space (so a pointer to a stack variable *can* be shared across threads — dangerous if the frame is gone).

## Internal Mechanism

### Mappings, not memory

The address space is mostly empty — 128 TiB of numbers, a few hundred MB used. Storing it as "a table entry per address" would be absurd, so the kernel stores *descriptions of ranges* instead. An address space is a list of **mappings** (Linux: VMAs — virtual memory areas), each with a range, permissions (r/w/x), and a backing: a file (code, libraries, mmap'd files) or anonymous memory (heap, stack). You can see them:

```bash
$ cat /proc/self/maps | head -5
55d0c3a00000-55d0c3a02000 r--p 00000000 08:01 131 /usr/bin/cat
55d0c3a02000-55d0c3a07000 r-xp 00002000 08:01 131 /usr/bin/cat
55d0c4c3f000-55d0c4c60000 rw-p 00000000 00:00 0   [heap]
7f2b9e200000-7f2b9e228000 r--p 00000000 08:01 812 /usr/lib/x86_64-linux-gnu/libc.so.6
7ffd6bb9e000-7ffd6bbbf000 rw-p 00000000 00:00 0   [stack]
```

Creating a mapping doesn't allocate RAM. Physical frames are assigned lazily when pages are first touched (a **page fault**), which is why `VSZ` (virtual size) is often far larger than `RSS` (resident set size). See [Paging](lesson:os-paging) and [Page Faults](lesson:os-page-faults).

### Kernel space

The upper half of the address space (on x86-64 canonical addresses starting 0xffff…) maps the kernel. It's present in every process's page tables (so a syscall doesn't need to switch page tables) but marked supervisor-only. After the Meltdown vulnerability, **KPTI** unmaps most of it while in user mode, at some syscall cost.

:::depth{level=advanced}
### Stack growth and guard pages

The main thread's stack grows on demand: touching just below the current stack triggers a page fault the kernel recognizes as stack growth (up to `ulimit -s`, default 8 MB). Thread stacks are fixed-size `mmap` regions with an unmapped **guard page** below them; overflowing into it causes a segfault instead of silently corrupting adjacent memory. "Stack clash" attacks tried to jump over guard pages with huge stack allocations; compilers now probe large frames page by page.
:::

## Example

Why this matters for a classic bug — returning a pointer to a local:

```c
char *greeting(void) {
    char buf[32];
    snprintf(buf, sizeof buf, "hello");
    return buf;            // BUG: buf's frame is popped on return
}
// The caller gets a pointer into the stack region that the next call will overwrite.
```

The memory still *exists* (the stack region is mapped), so the bug often "works" until another call overwrites it — a nondeterministic corruption. Fix: allocate on the heap, use a static buffer (not thread-safe), or let the caller pass a buffer.

## Complexity & Performance

| | Stack | Heap |
|---|---|---|
| Allocation | Move a pointer: ~1 ns | Allocator search/bookkeeping: ~20–100 ns (more under contention) |
| Deallocation | Automatic on return | Explicit `free` / GC |
| Size | Small (MBs per thread) | Large (GBs) |
| Lifetime | Tied to function call | Arbitrary |
| Locality | Excellent (hot, contiguous) | Depends on allocation patterns |
| Thread safety | Private per thread | Shared — needs synchronization |

## Trade-offs

- **Stack**: fastest, automatic, but limited in size and lifetime. Large arrays or deep recursion overflow it.
- **Heap**: flexible lifetime and size, but slower, fragmentable, and prone to leaks/use-after-free in manual languages or GC pauses in managed ones.
- **Static**: zero allocation cost, but global state complicates testing and thread safety.

## Failure Modes

- **Stack overflow**: infinite/deep recursion or huge local arrays → segfault (C) or `StackOverflowError` (Java) or `RecursionError` (Python, which limits depth itself).
- **Null pointer dereference**: address 0 is deliberately unmapped → `SIGSEGV`.
- **Dangling pointers** to popped stack frames or freed heap memory.
- **Buffer overflows** on the stack overwrite return addresses (classic exploit; mitigated by stack canaries, non-executable stacks, ASLR).
- **Address space exhaustion** in 32-bit processes (only 3–4 GB of virtual space).

## In Production

- `VSZ` vs `RSS` in `ps`/`top`: don't panic about huge VSZ (e.g., JVM or Go reserve large virtual ranges); RSS is what uses RAM. `PSS` (proportional set size) divides shared pages fairly among sharers.
- Container memory limits count resident memory (plus page cache charged to the cgroup), not virtual size.
- Thread stack size matters when running thousands of threads: 8 MB virtual each is fine (not resident), but setting large `-Xss` values in Java multiplies memory use.

## Deeper Connections

- The heap's allocator: [Dynamic Memory Allocation](lesson:os-dynamic-allocation).
- The translation machinery: [Paging](lesson:os-paging), [TLB](lesson:os-tlb).
- Lazy allocation and copy-on-write: [Page Faults](lesson:os-page-faults), [Copy-on-Write & mmap](lesson:os-cow-mmap).
- Database processes map huge shared memory regions for buffer pools — same mechanism ([Buffer Pool](lesson:db-buffer-pool)).

## Common Misconceptions

- **"Local variables are always on the stack, objects always on the heap."** Compilers keep locals in registers; JIT/Go escape analysis puts non-escaping objects on the stack.
- **"Virtual memory means using disk as RAM."** Swapping is one use; the core purpose is isolation and flexible mapping.
- **"A 20 GB VSZ means the process uses 20 GB."** Virtual size includes reserved but untouched ranges and shared libraries.
- **"The heap is one contiguous block."** Modern allocators use `brk` for small allocations and `mmap` for large ones, spread across the address space.

## Interview Questions

### [L1 · compare] What is the difference between stack and heap memory?

The stack holds function call frames (locals, arguments, return addresses) per thread; allocation is automatic and very fast (pointer arithmetic), lifetime is tied to the call, and size is limited. The heap holds dynamically allocated data shared by all threads; allocation is explicit (malloc/new) or GC-managed, slower, arbitrary lifetime and size, and can fragment or leak.

### [L1 · conceptual] What are the segments of a process's memory layout?

Text (code, read-only/executable), data (initialized globals/statics), BSS (zero-initialized globals/statics), heap (dynamic allocations growing upward), memory-mapped region (shared libraries, mmap'd files, thread stacks), and stack (growing downward). The kernel occupies the upper part of the address space, inaccessible from user mode.

### [L2 · why] Why does each process have its own virtual address space?

Isolation (a process can't access another's memory because it can't even form its physical addresses), a uniform layout that simplifies compilers and linkers, and flexibility for the OS to place, share, lazily load, or swap pages transparently.

### [L2 · trace] What happens if a function returns a pointer to a local array?

The function's frame is popped on return; the pointer refers to stack memory that is still mapped but logically free. The next function calls overwrite it, so the data changes unpredictably. It's undefined behavior in C/C++ — the program may appear to work, crash, or corrupt data.

### [L3 · debugging] A C service crashes with SIGSEGV only under heavy load, in deep recursive JSON parsing of large payloads. What's likely and how do you fix it?

Stack overflow: deeply nested input drives recursion depth beyond the thread's stack size (worker threads may have smaller stacks than the main thread); the access hits the guard page → SIGSEGV. Confirm with a core dump showing a huge call depth. Fix: limit nesting depth (also a DoS defense), convert recursion to iteration with an explicit heap-allocated stack, or increase thread stack size as a stopgap.

### [L3 · compare] VSZ is 30 GB but RSS is 2 GB for a JVM. Is that a problem?

Not necessarily. VSZ counts all mapped virtual ranges — the JVM reserves address space for the heap maximum, code cache, metaspace, thread stacks, and mapped libraries/files — most of which may never be touched. RSS (2 GB) is the physical memory actually resident. Watch RSS, container memory usage and GC metrics instead.

### [L4 · design] You're designing a system that runs 20,000 concurrent tasks. Memory-wise, what changes between using OS threads and goroutines/virtual threads?

OS threads each need a fixed stack mapping (default 8 MB virtual, typically tens to hundreds of KB resident as used) plus kernel structures; 20,000 threads mean large virtual reservations, significant resident stack memory and scheduler overhead. Goroutines start with ~2–8 KB growable stacks allocated on the heap and move/grow as needed; virtual threads store stack frames on the heap when unmounted. So memory scales with *actual* stack depth, making 20,000 tasks cheap. Trade-off: deep recursion on user-level stacks costs copying/growth, and blocking in native code can pin carriers.

## Practice

### [mcq] Where is a `static int count = 0;` declared inside a function stored?

- [ ] On the stack
- [ ] On the heap
- [x] In the BSS segment
- [ ] In the text segment

Static locals live for the whole program; zero-initialized ones go to BSS.

### [mcq] Why is address 0 typically unmapped in a process's address space?

- [ ] Because the kernel lives there
- [x] So that null pointer dereferences fault immediately
- [ ] Because the stack starts at 0
- [ ] It isn't; code starts at 0

Leaving the first pages unmapped turns null dereferences into immediate SIGSEGVs rather than silent corruption.

## Quick Revision

- Virtual address space = private map; MMU + page tables translate to physical frames.
- Layout: text → data/rodata/bss → heap ↑ … mmap region … ↓ stack; kernel above, inaccessible; ASLR randomizes.
- Stack: per thread, LIFO frames, ~1 ns alloc, limited (8 MB default main thread).
- Heap: shared, malloc/new or GC, flexible, slower, fragmentation/leaks.
- Static: `.data` (initialized), `.bss` (zero).
- Mappings ≠ RAM: VSZ ≫ RSS is normal; pages allocated on first touch.
- Bugs: stack overflow, dangling pointers to frames, buffer overflows.
