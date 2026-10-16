---
title: "What Actually Happens When a Program Runs"
subject: os
level: 0
order: 3
summary: "From ./app on the command line to exit(): fork, exec, the loader, the address space, the fetch–execute loop, system calls, interrupts and the scheduler — the foundational mental model for everything else."
depth: beginner
difficulty: 2
minutes: 35
relevance: essential
stage: 1
prerequisites: [os-what-an-os-does, os-hardware-model]
related: [os-processes, os-process-creation, os-address-spaces, os-syscalls-interrupts, os-page-faults]
tags: [program execution, loader, elf, exec, dynamic linking, boot, fetch execute, compiler, linker, BIOS, UEFI, bootloader, JVM startup, class loading]
---

## Mental Model

Running a program is a **relay race between four runners**: the **shell** (asks for a new process), the **kernel** (creates it and loads the program), the **CPU** (executes instructions), and the **kernel again**. The kernel takes the baton back every time the program needs something it isn't allowed to do itself, and every time the timer says "your turn is over".

The single most useful fact: **a running program is almost never "just running".** It is constantly interrupted, preempted, page-faulting, making system calls and being rescheduled, thousands of times per second. The OS makes all of that invisible.

## Definition

**Program execution** is the sequence by which the OS turns an executable file into a running process. The OS:

- creates a process;
- maps the executable and its libraries into a new address space;
- sets up the stack and registers and transfers control to the program's entry point;
- services its system calls and faults while it runs;
- reclaims its resources when it exits.

## Why It Exists

**The problem.** A file on disk is inert bytes. The CPU can only execute instructions that sit in memory, at an address in its program counter. Getting from "bytes in a file" to "instructions the CPU is executing" takes work. To execute it, *someone* must:

- give it memory and put its code there,
- resolve the shared libraries it depends on,
- give it a stack, arguments and environment,
- give it a CPU (and take it away fairly),
- give it controlled access to files, network and devices,
- clean up after it no matter how it ends.

**Without it.** Every program would carry its own loader, its own memory bookkeeping and its own cleanup — and one buggy loader could trample everything else on the machine. Doing this per program would be chaos; the OS does it uniformly for all of them.

**The idea.** Split the job into small, general steps the kernel can do for anyone:

1. *make a container* (a process);
2. *fill it with a program* (exec);
3. *share the CPU with it* (scheduling);
4. *serve its requests* (system calls);
5. *empty it when done* (exit/wait).

Each step below is one of those.

:::callout[That's all it is]{type=insight}
Running a program = make an empty process, map the file into its memory, point the CPU at the first instruction, and then keep interrupting it to share the machine. Everything else is detail on one of those steps.
:::

## How It Works

You type `./server --port 8080` in a shell:

::::steps[From command to running process]
1. **The shell parses** the command line, then calls `fork()`: the kernel creates a new child process that is a near-copy of the shell (copy-on-write, so nothing is actually copied yet).
2. **The child calls `execve("./server", argv, envp)`.** The kernel checks permissions, reads the file header (on Linux, **ELF**), and *throws away* the child's old address space.
3. **The kernel builds a new address space**: it maps the executable's `.text` (code, read+execute) and `.data` (read+write) segments, sets up a zero-filled `.bss`, an empty heap, and a stack.
4. **It places `argv`, `envp` and the auxiliary vector on the new stack** and sets the stack pointer. For a dynamically linked program, it sets the program counter to the **dynamic loader** (`ld-linux.so`), not to your `main`.
5. **Return to user mode.** The dynamic loader maps shared libraries (`libc.so`, `libssl.so`…) with `mmap`, performs relocations, then jumps to the program's `_start`, which calls libc initialization and finally **`main()`**.
6. **The program runs.** The CPU fetches and executes instructions. Nothing is loaded from disk until touched: the first access to each code or data page causes a **page fault**, and the kernel reads that page in (**demand paging**).
7. **System calls** (`socket`, `bind`, `listen`, `accept`, `read`, `write`) trap into the kernel whenever the program needs I/O.
8. **The timer interrupt** fires every few milliseconds; the scheduler may switch to another process (a **context switch**) and later switch back. The program never notices.
9. **Exit.** `main` returns → libc calls `exit()` → the kernel closes file descriptors, frees memory, and leaves a small exit record (a **zombie**) until the parent (the shell) collects the status with `wait()`.
::::

```mermaid
sequenceDiagram
    participant Shell
    participant Kernel
    participant Child
    Shell->>Kernel: fork()
    Kernel-->>Shell: returns child PID
    Kernel-->>Child: returns 0 (child starts)
    Child->>Kernel: execve("./server")
    Note over Kernel: discard old address space, map ELF, build stack
    Kernel-->>Child: start at dynamic loader, then _start, then main()
    Shell->>Kernel: wait(child)
    Note over Shell: shell blocks
    Child->>Kernel: many syscalls, page faults, preemptions
    Child->>Kernel: exit(0)
    Kernel-->>Shell: wait returns status 0
```

### The same steps for `java -jar app.jar`

A Java program goes through every step above, and then a second, similar process inside the JVM:

```text
shell        fork + execve("/usr/bin/java", ["java", "-jar", "app.jar"])
kernel       maps the `java` launcher (an ordinary ELF program), starts the dynamic loader
ld.so        maps libc and libjvm.so (the JVM itself is a shared library)
launcher     creates the JVM: reserves the heap with mmap, starts GC and JIT compiler threads
JVM          opens app.jar, finds Main-Class in the manifest, loads that class
class load   other classes are loaded, verified and linked only when first used
execution    bytecode starts in the interpreter; hot methods are JIT-compiled to machine code
```

Class loading is the JVM's version of demand paging: nothing is loaded until it is needed. That is why the first requests to a fresh JVM are slow. Code paths run in the interpreter, classes load, and the JIT compiler hasn't optimized anything yet.

## Internal Mechanism

### From source code to a running program

Before `exec` can load a program, it has to be built. Textbooks name four tools:

1. **Compiler**: turns source code (`main.c`) into assembly for the target CPU.
2. **Assembler**: turns assembly into an **object file** (`main.o`): machine code with holes for anything defined elsewhere, such as `printf`.
3. **Linker**: combines object files and libraries into one executable, filling in the addresses of functions and variables. Static linking copies library code in; dynamic linking records which shared libraries to load at start.
4. **Loader**: at run time, maps the executable into memory and prepares it to run. On Linux this is the kernel's `execve` plus the dynamic loader `ld.so`.

Java splits the same work differently. `javac` produces bytecode, not machine code. Linking happens lazily at run time, when the JVM's class loaders resolve one class's reference to another. Machine code is produced last, by the JIT compiler, for hot methods only.

### The executable file format

The kernel needs instructions for *how* to lay the file out in memory — which bytes are code, which are data, where to start. That's what an executable format is: a table of contents for the loader. An ELF file contains headers describing the **segments** to map (with permissions and file offsets) and the **entry point** address. A dynamically linked program also names its **interpreter** (the dynamic loader) and lists the libraries it needs. `readelf -l ./server` shows the program headers.

### Static vs dynamic linking

The problem: almost every program uses the same libraries (`libc`, `libssl`). One option is for each program to carry its own copy. That's simple, but duplicated on disk and in RAM, and every copy must be rebuilt to fix a bug. The other is for programs to share one copy that's found and wired up at start. That's shared and patchable, but startup has work to do and the right version must be installed.

| | Static | Dynamic |
|---|---|---|
| Libraries | Copied into the executable | Loaded at start from `.so` files |
| Startup | Faster (no symbol resolution) | Slower (loader resolves symbols; lazy binding helps) |
| Memory | Each program has its own copy | Shared library pages shared by all processes |
| Updates | Rebuild to patch a library bug | Patch the `.so` once |
| Deployment | One self-contained binary (Go default) | Needs compatible libraries installed |

### Demand paging at startup

Why not just read the whole file into memory? Because most of a program is never used in a given run (error paths, unused features), and reading 200 MB before running line one would make every start slow. So: `exec` does not read the whole program into RAM. It sets up **mappings**: "virtual pages 0x400000–0x480000 correspond to this file at these offsets". The first instruction fetch from `main`'s page faults; the kernel finds the page in the page cache (or reads it from disk), maps it, and restarts the instruction. This is why a 200 MB binary can start in milliseconds and why a program's first request is often slower than later ones ("cold start"). See [Page Faults](lesson:os-page-faults).

### The CPU is shared continuously

Even a program in a tight loop is interrupted by the timer (Linux typically uses a 1–4 ms tick or tickless scheduling with a comparable granularity). Each time, the kernel's scheduler decides whether to continue it or switch to another runnable thread. A program with 4 threads on a 2-core machine is multiplexed onto the cores constantly.

### Before any of this: booting

What runs the very first program? Firmware (**UEFI/BIOS**) initializes hardware and loads a **bootloader** (GRUB, systemd-boot) from disk. The bootloader loads the **kernel image** and an initial RAM filesystem (**initramfs**) into memory and jumps to the kernel. The kernel initializes memory management, interrupt handling, drivers and the scheduler, mounts the root filesystem, and starts **PID 1** (`systemd` or `init`) — the ancestor of every other user process. From then on, every process is created by `fork`/`exec` (or `clone`) from an existing one.

```text
power on     firmware (UEFI, or legacy BIOS) runs from flash: checks the hardware, finds a boot disk
firmware     loads the bootloader (GRUB, systemd-boot) from the disk's EFI system partition
bootloader   loads the kernel image and the initramfs into RAM and jumps to the kernel's entry point
kernel       in kernel mode: page tables, interrupts, scheduler, drivers; mounts the real root filesystem
PID 1        the first user-mode process, init (systemd on most Linux systems)
systemd      starts services in dependency order: network, sshd, ... and `java -jar app.jar`
```

Everything before PID 1 runs in kernel mode. Every process after it, including your JVM, descends from PID 1.

## Example

See the loader and libraries a program uses, and the syscalls at startup:

```bash
$ ldd /usr/bin/curl | head -3
    linux-vdso.so.1 (0x00007ffd...)
    libcurl.so.4 => /lib/x86_64-linux-gnu/libcurl.so.4
    libssl.so.3 => /lib/x86_64-linux-gnu/libssl.so.3

$ strace -f -e trace=execve,openat,mmap curl -s https://example.com -o /dev/null 2>&1 | head -6
execve("/usr/bin/curl", ["curl", "-s", ...], ...) = 0
openat(AT_FDCWD, "/etc/ld.so.cache", O_RDONLY|O_CLOEXEC) = 3
mmap(NULL, 67408, PROT_READ, MAP_PRIVATE, 3, 0) = 0x7f...
openat(AT_FDCWD, "/lib/x86_64-linux-gnu/libcurl.so.4", O_RDONLY|O_CLOEXEC) = 3
...
```

`linux-vdso.so.1` is a tiny library the kernel maps into every process so that calls like `gettimeofday` can run **without** a real system call.

## Visualization

::viz{id=process-lifecycle}

## Complexity & Performance

- `fork`+`exec` of a small program: ~0.5–2 ms (dominated by page-table setup, dynamic loading and page faults). Interpreted runtimes add their own startup (JVM class loading, Python imports) — often 50 ms to seconds.
- The first execution of any code path triggers page faults and cold caches; this is why services use **warm-up** traffic before taking production load and why serverless platforms fight "cold starts".

## Trade-offs

- **Demand paging** makes startup fast and memory-efficient but moves cost into the first execution of each code path (latency spikes).
- **Dynamic linking** saves memory and eases patching but adds startup cost and "works on my machine" dependency problems — one reason containers and static Go binaries are popular.

## Failure Modes

- `exec format error` — wrong architecture or missing interpreter line.
- `error while loading shared libraries: libX.so: cannot open shared object file` — dynamic loader can't find a dependency.
- `Argument list too long` (`E2BIG`) — `argv`+`envp` exceed the kernel limit placed on the new stack.
- Out-of-memory during startup with overcommit disabled — mappings can be refused up front.

## In Production

- **Container entrypoints**: your binary is `exec`'d as PID 1 inside the container. If it doesn't handle `SIGTERM` or reap children, shutdowns hang and zombies accumulate.
- **Graceful restarts**: servers like Nginx re-`exec` a new binary while keeping listening sockets open (file descriptors survive `exec` unless marked close-on-exec).
- **Startup latency** matters for autoscaling and serverless: precompiled binaries, smaller images, snapshotting (Firecracker) and class-data sharing (JVM CDS) all attack the steps above.

## Deeper Connections

- Every step here is its own lesson: [process creation](lesson:os-process-creation), [address spaces](lesson:os-address-spaces), [page faults](lesson:os-page-faults), [system calls](lesson:os-syscalls-interrupts), [context switches](lesson:os-context-switch).
- The same pattern — create a context, lazily load what's needed, multiplex on shared resources, clean up at the end — appears in database sessions (connection → backend process → buffer pool pages loaded on demand).

## Common Misconceptions

- **"exec creates a new process."** `exec` *replaces* the program inside the existing process (same PID). `fork`/`clone` creates processes.
- **"The whole program is loaded into memory when it starts."** Only mappings are created; pages load on first touch.
- **"main() is the first code that runs."** The dynamic loader, `_start`, and libc initialization (plus C++ static constructors) run first.

## Interview Questions

### [L1 · trace] What happens when you run a program from the shell?

The shell forks a child process; the child calls `execve`, which replaces its address space with the new program: the kernel maps the executable's segments, sets up the stack with arguments and environment, and starts execution at the dynamic loader, which maps shared libraries and jumps to `_start` → `main`. Pages load lazily via page faults. While running, the program makes system calls for I/O and is periodically preempted by the scheduler. On exit, the kernel frees resources, and the shell, blocked in `wait`, collects the exit status.

### [L1 · compare] What is the difference between a linker and a loader?

The **linker** runs at build time. It combines object files and libraries into one executable and resolves references between them, so a call to `printf` gets an address (static linking) or a record saying "find `printf` in libc.so at start" (dynamic linking). The **loader** runs every time the program starts. It maps the executable's segments into a new address space, sets up the stack and jumps to the entry point; on Linux that is `execve` in the kernel plus the dynamic loader `ld.so`, which maps shared libraries and fills in the remaining addresses. In Java, linking is deferred further: class loaders link classes lazily, on first use.

### [L1 · trace] What happens between pressing the power button and your program running?

Firmware (UEFI or BIOS) runs from flash, checks the hardware and loads a bootloader from the boot disk. The bootloader (GRUB) loads the kernel image and an initramfs into memory and jumps to the kernel. The kernel, in kernel mode, initializes memory management, interrupts, the scheduler and drivers, mounts the root filesystem, and starts the first user-mode process, init (PID 1, usually systemd). Init starts services, one of which may run `java -jar app.jar`; every user process descends from PID 1.

### [L2 · compare] Static vs dynamic linking — trade-offs?

Static linking copies library code into the binary: self-contained, faster startup, no dependency issues, but larger binaries, no memory sharing between processes, and every library patch needs a rebuild. Dynamic linking loads shared libraries at runtime: smaller binaries, shared physical pages across processes, patch once for all programs, but slower startup and runtime dependency/version problems.

### [L2 · why] Why can a 500 MB executable start in a fraction of a second?

Because `exec` only creates memory mappings; it doesn't read the file. Pages are loaded on first access (demand paging), and many are probably already in the page cache from previous runs. Only the pages actually touched during startup are faulted in.

### [L3 · debugging] A service's first request after deploy takes 2 s while later ones take 20 ms. What's going on and how would you fix it?

Cold start: code and data pages are faulted in on first use, caches (CPU, page cache, application caches, connection pools, JIT compilation in JVM/.NET, DNS, TLS sessions) are empty. Fixes: warm-up requests before marking the instance ready (readiness probe), pre-establishing pools, ahead-of-time compilation or class-data sharing, and keeping minimum instances warm. Verify with page-fault counts (`perf stat -e page-faults`) and timing breakdowns.

### [L3 · what-if] What happens to open file descriptors across fork and exec?

`fork` duplicates the file descriptor table: parent and child share the same open-file entries (and offsets). `exec` keeps descriptors open by default — which is how the shell wires up stdin/stdout/stderr and pipes before exec'ing a program — except those flagged `FD_CLOEXEC` (`O_CLOEXEC`), which are closed automatically. Forgetting `O_CLOEXEC` leaks descriptors (and sometimes secrets or sockets) into child programs.

### [L4 · design] You need to cut service startup time from 30 s to under 2 s for autoscaling. How would you approach it?

Measure first: split startup into process exec/loading, runtime initialization (JVM, class loading, imports), dependency connections (DB pools, service discovery, TLS handshakes), cache warming and framework reflection. Then attack the biggest: lazy initialization for rarely-used components, ahead-of-time compilation/native images or CDS, smaller dependency graphs, parallelizing independent connections, snapshotting a warmed process (CRaC, Firecracker snapshots), and making readiness depend only on what's needed for the first requests. Accept trade-offs: lazy init moves latency to first use.

## Practice

### [mcq] After a successful execve(), which of these is the SAME as before the call?

- [ ] The program's code
- [ ] The heap contents
- [x] The process ID
- [ ] The stack contents

`exec` replaces the program image but the process — its PID, parent, and (non-CLOEXEC) file descriptors — remains.

### [exercise] Explain why `strace ./hello` for a dynamically linked C "hello world" shows several `openat` and `mmap` calls before the single `write`.

:::solution
The kernel starts the dynamic loader first. The loader opens `/etc/ld.so.cache` to find library paths, opens `libc.so.6`, and `mmap`s its segments (code read-exec, data read-write), then performs relocations. Only after libc is initialized does `main` run and call `printf`, which eventually issues one `write(1, "hello\n", 6)`. A statically linked build would skip almost all of this.
:::

### [mcq] You run `java -jar app.jar`. Which of these runs first?

- [ ] The `main` method of the jar's Main-Class
- [ ] The static initializer of the Main-Class
- [x] The dynamic loader, mapping libc and libjvm.so into the `java` process
- [ ] The JIT compiler, compiling `main` to machine code

`java` is an ordinary dynamically linked program, so the kernel starts `ld.so` first. Only after the JVM is created does it load the Main-Class (running its static initializer) and call `main`, at first in the interpreter.

### [numeric 3072] A program touches 12 MB of its code and data during startup, none of it in the page cache yet. Pages are 4 KB and there is no read-ahead. How many major page faults does startup cause?

:::answer
Each 4 KB page is faulted in on first touch: 12 MB / 4 KB = 12 × 1024 / 4 = **3072** major faults, each waiting for a disk or SSD read. Read-ahead normally cuts this a lot by reading neighbouring pages of the file in the same I/O.
:::

### [numeric 250] With a scheduler tick of 4 ms, how many times per second does the timer give the kernel a chance to preempt a CPU-bound thread on one core?

:::answer
1000 ms / 4 ms = **250** timer interrupts per second. On each one the scheduler may let the thread continue or switch to another runnable thread.
:::

### [exercise] Compare the path from source code to running machine code for a C program and for a Java program. Name the tool or component that does each step.

:::solution
**C**: the compiler turns `main.c` into assembly; the assembler produces `main.o` with unresolved references such as `printf`; the linker produces the executable (static, or recording `libc.so` as needed). At run time the loader — `execve` plus `ld.so` — maps the program and its libraries. The CPU then runs machine code that existed before the program started.

**Java**: `javac` turns `Main.java` into `Main.class` bytecode, which no CPU runs directly. At run time the OS loads the `java` launcher (itself a C program) and `libjvm.so`. The JVM's class loaders find, verify and link classes on first use, the interpreter runs the bytecode, and the JIT compiler turns hot methods into machine code while the program runs. Machine code for Java exists only after the program has been running for a while, which is why JVM warm-up exists.
:::

## Quick Revision

- Shell → `fork()` (new process) → child `execve()` (replace program) → kernel maps ELF segments + stack → dynamic loader → `_start` → `main`.
- Pages load **lazily** via page faults (demand paging) → fast start, slower first requests.
- While running: **syscalls** for I/O, **timer interrupts** for preemption, **page faults** for memory.
- Exit → kernel frees resources → **zombie** until the parent `wait()`s.
- `exec` keeps the **PID** and open fds (unless `O_CLOEXEC`).
- Boot: firmware → bootloader → kernel → PID 1 → everything else via fork/exec.
