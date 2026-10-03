---
title: "What Happens When You Run ./server"
summary: "From pressing Enter in a shell to your main() running: fork, exec, the ELF loader, the dynamic linker, a fresh address space built lazily by page faults, and the first system calls."
subjects: [os]
order: 2
related: [os-process-creation, os-program-execution, os-address-spaces, os-page-faults, os-cow-mmap, os-syscalls-interrupts]
---

You type `./server --port 8080` in bash and press Enter. Nothing in the program has run yet; the shell and the kernel do a surprising amount of work first.

## [shell] The shell parses the command line

Bash reads the line, splits it into words, expands variables and globs, and determines that `./server` is a path to an executable (not a builtin or alias). It sets up any redirections (`> out.log` would be opened now).

## [kernel] fork(): clone the shell

Bash calls `fork()` (really `clone()`). The kernel creates a new process: a new PID, a copy of the shell's file-descriptor table, signal dispositions and credentials, and a new address space that **shares** the shell's pages copy-on-write — no memory is copied yet ([Copy-on-Write](lesson:os-cow-mmap)). Both parent and child return from fork; the child sees 0.

## [shell] The child prepares, the parent waits

In the child, bash applies redirections (`dup2`) and resets signal handlers. The parent records the job and calls `waitpid()` (for a foreground job), sleeping until the child exits.

## [kernel] execve(): replace the program

The child calls `execve("./server", argv, envp)`. The kernel checks permissions, reads the file header — ELF magic `\x7fELF` — and **discards the old address space** (the shared COW pages from bash). It maps the program's segments (code read+execute, data read+write) from the file, sets up a fresh stack containing argv, envp and the auxiliary vector, and notes the interpreter path from the ELF `PT_INTERP` header: the dynamic linker ([Program Execution](lesson:os-program-execution)).

## [runtime] The dynamic linker loads shared libraries

Execution starts in `ld-linux.so`, not in your program. It reads the program's list of needed libraries (`libc.so.6`, `libssl.so`, …), `mmap`s each one (shared, read-only code pages are shared with every other process using the same library), resolves symbols and applies relocations, runs library initializers, and finally jumps to the program's entry point `_start`.

## [mmu] Page faults build the process lazily

None of those mappings are backed by physical memory yet. The first instruction fetched from a code page triggers a **page fault**; the kernel finds the page in the page cache (or reads it from disk), maps it, and resumes. Same for data, stack and heap pages as they're touched ([Page Faults](lesson:os-page-faults)). A process that maps 200 MB may only have 15 MB resident.

## [runtime] C runtime startup, then main()

`_start` calls `__libc_start_main`, which initializes libc (stdio buffers, thread-local storage, atexit handlers), runs constructors, and calls `main(argc, argv, envp)`. Your code is finally running.

## [kernel] The program's first system calls

A server immediately makes syscalls: `socket()`, `setsockopt()`, `bind()` to port 8080, `listen()`, then `epoll_create1()` and `epoll_wait()` — where it sleeps until a client arrives ([Socket Creation](uth:socket-create)). `strace -f ./server` shows every one of these steps, including execve, the dynamic linker's `openat`/`mmap` calls and the server's socket calls.

## [scheduler] The process is now a schedulable task

The kernel scheduler treats the process's main thread like any other task: it runs when runnable, sleeps in `epoll_wait`, and is woken by network interrupts. When it exits, the kernel frees its memory and descriptors, sends SIGCHLD to bash, and bash's `waitpid()` returns the exit status (`$?`).
