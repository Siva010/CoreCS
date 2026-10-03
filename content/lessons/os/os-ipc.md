---
title: "Inter-Process Communication: Pipes, Sockets, Shared Memory & More"
subject: os
level: 1
order: 5
summary: "Isolated processes still need to talk. A tour of the IPC mechanisms — what each one actually does in the kernel, and when to pick which."
depth: core
difficulty: 2
minutes: 30
relevance: high
stage: 2
prerequisites: [os-process-creation]
related: [os-signals, os-cow-mmap, cn-sockets, os-file-descriptors]
tags: [ipc, pipe, fifo, unix domain socket, shared memory, message queue, mmap, semaphore]
---

## Mental Model

Processes live in sealed houses (separate address spaces). To communicate, they either:

- **pass notes through the kernel's mail slot** — pipes, sockets, message queues: the kernel copies bytes from one process into a kernel buffer and then into the other process. Safe and simple, but every byte is copied twice and every exchange costs system calls; or
- **share a room** — shared memory: the kernel maps the *same physical pages* into both address spaces. No copying at all, but now both processes can trample each other's data, so they must coordinate with synchronization primitives.

Everything in IPC is a trade-off between these two ideas: **copying through the kernel (safe, simple) vs sharing memory (fast, dangerous)**.

## Definition

**Inter-process communication (IPC)** is any mechanism that lets separate processes exchange data or synchronize. The main mechanisms on Unix-like systems are pipes, named pipes (FIFOs), Unix domain sockets, network sockets, message queues, shared memory, memory-mapped files, signals and semaphores.

## Why It Exists

Process isolation is a feature — but real systems are built from cooperating processes: a shell pipeline, a web server and its workers, a database's postmaster and backends, a browser's renderer and GPU processes, microservices on one host. IPC restores communication *selectively* and under the kernel's control.

## How It Works

### The mechanisms at a glance

| Mechanism | Data model | Direction | Related processes only? | Copies | Typical use |
|---|---|---|---|---|---|
| **Pipe** (`pipe()`) | Byte stream | One-way | Yes (inherited fds) | 2 (user→kernel→user) | Shell pipelines |
| **FIFO** (named pipe) | Byte stream | One-way | No (filesystem name) | 2 | Simple unrelated producers/consumers |
| **Unix domain socket** | Stream or datagram | Two-way | No (path or abstract name) | 2 | Local client/server: Docker daemon, PostgreSQL local connections, X11 |
| **TCP/UDP socket (loopback)** | Stream / datagram | Two-way | No | 2 + protocol overhead | Services that may later move to another host |
| **Message queue** (POSIX `mq_*`) | Discrete messages with priority | Many-to-many | No | 2 | Structured messages without framing |
| **Shared memory** (`shm_open`+`mmap`, `mmap(MAP_SHARED)`) | Raw memory | Any | No | 0 | High-throughput data sharing (PostgreSQL shared buffers, Chrome compositing) |
| **Signals** | A number | One-way | No | — | Notifications only |
| **Semaphores / futexes on shared memory** | Counters | — | No | — | Synchronizing access to shared memory |

### Pipes

`pipe(fds)` returns two file descriptors: `fds[1]` for writing, `fds[0]` for reading. The kernel holds a bounded buffer (64 KB by default on Linux):

- writer blocks when the buffer is full (backpressure);
- reader blocks when it's empty;
- when all write ends are closed, the reader gets **EOF** (read returns 0);
- when all read ends are closed, a writer gets `SIGPIPE`/`EPIPE`.

Writes of up to `PIPE_BUF` bytes (4096 on Linux) are **atomic** — they won't interleave with other writers' data. Larger writes might.

### Unix domain sockets

Same API as network sockets (`socket(AF_UNIX, …)`, `bind` to a path, `listen`, `accept`, `connect`) but the data never touches the network stack — the kernel moves it between socket buffers directly. Bonus features: passing **file descriptors** between processes (`SCM_RIGHTS`) and learning the peer's UID/PID (`SO_PEERCRED`) for authentication. PostgreSQL local connections via `/var/run/postgresql/.s.PGSQL.5432` are Unix sockets — measurably faster than TCP loopback.

### Shared memory

```c
int fd = shm_open("/ringbuf", O_CREAT | O_RDWR, 0600);
ftruncate(fd, 1 << 20);                                  // 1 MB
void *p = mmap(NULL, 1 << 20, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
// Another process shm_open()s and mmap()s the same name → same physical pages.
```

After setup, reads and writes are plain memory accesses — no system calls, no copies. But the processes now face every problem of multithreaded programming: races, visibility, ordering. They typically use atomic operations, process-shared mutexes (`PTHREAD_PROCESS_SHARED`), or semaphores in the shared region, and a well-defined layout (e.g., a ring buffer with head/tail indices).

## Internal Mechanism

### Where the copies happen

For a pipe or socket, `write()` copies from the sender's user buffer into kernel memory; `read()` copies from kernel memory into the receiver's buffer. Each call is also a syscall (mode switch), and blocking may cause context switches. For small messages the syscall overhead dominates; for large transfers the copies dominate.

Shared memory avoids both after setup — the cost moves into **synchronization**: the consumer must learn that new data is available, which needs polling (burns CPU), a futex wait/wake (syscalls only when actually blocking), or an eventfd/pipe notification.

:::depth{level=advanced}
### Zero-copy tricks

- `splice()`/`vmsplice()` move pages between pipes and files without copying through user space.
- `sendfile()` sends file contents to a socket directly from the page cache (used by Nginx for static files and by Kafka to serve log segments).
- `SCM_RIGHTS` passes an open fd (e.g., a memfd full of data) to another process: the receiver gets its own descriptor to the same object.
- `memfd_create()` gives an anonymous file that can be sealed and shared.
:::

## Example

A shell pipeline is IPC in action:

```bash
$ cat access.log | grep " 500 " | awk '{print $7}' | sort | uniq -c | sort -rn | head
```

Six processes, five pipes, each process blocking on read or write as data flows. Backpressure is automatic: if `sort` is slow, the pipe buffers fill and `grep` blocks.

## Complexity & Performance

Rough local throughput/latency (order of magnitude; hardware dependent):

| Mechanism | Latency (small message round trip) | Throughput (large transfers) |
|---|---|---|
| Pipe | ~5–10 µs | several GB/s |
| Unix domain socket | ~5–10 µs | several GB/s |
| TCP loopback | ~10–25 µs | a few GB/s |
| Shared memory + busy polling | < 1 µs | limited by memory bandwidth |

## Trade-offs

- **Message passing** (pipes, sockets, queues): simple mental model, isolation preserved, natural backpressure; costs copies and syscalls.
- **Shared memory**: fastest; but a bug in one process can corrupt the other, and synchronization is hard (and must survive a process crashing while holding a lock — robust mutexes).
- **Local sockets vs TCP**: Unix sockets are faster and support credential checks; TCP lets you move the service to another machine without code changes.

## Failure Modes

- **Pipe deadlock**: parent writes a lot to a child's stdin while the child writes a lot to stdout that the parent isn't reading yet — both buffers fill, both block. (Python's `subprocess.communicate()` exists to avoid this.)
- **Hang waiting for EOF**: some process still holds a write end open (forgot to close inherited fds).
- **Stale shared memory / sockets**: `/dev/shm` segments or socket files left behind after a crash block restart ("address already in use").
- **Crashed process holding a lock in shared memory** → everyone else blocks forever unless using robust mutexes.

## In Production

- **PostgreSQL**: backends are separate processes that communicate through a large **shared memory** region (shared buffers, lock tables, WAL buffers), coordinated with lightweight locks and semaphores.
- **Nginx**: master and workers share memory zones for rate limiting and caches.
- **Docker/containerd**, **systemd**: control via Unix domain sockets (`/var/run/docker.sock` — access to it is effectively root).
- **Sidecars and service meshes**: local proxies (Envoy) talk to apps over loopback TCP or Unix sockets.

## Deeper Connections

- Sockets are the bridge from IPC to networking: the same API connects to a process on the same host or across the world ([Sockets](lesson:cn-sockets)).
- Shared memory IPC needs the same synchronization theory as threads ([Critical Sections](lesson:os-critical-section-problem)).
- Memory-mapped files are how shared memory and the page cache meet ([Copy-on-Write & mmap](lesson:os-cow-mmap)).

## Common Misconceptions

- **"Shared memory is always the best IPC."** It's fastest for bulk data, but synchronization cost and complexity often erase the gain for small messages.
- **"Pipes are two-way."** A pipe is unidirectional; use two pipes or a socketpair for bidirectional communication.
- **"Local TCP is as fast as Unix sockets."** Loopback TCP still runs the TCP/IP stack (checksums optional, but segmentation, ACK logic, etc.).

## Interview Questions

### [L1 · conceptual] What is IPC and why is it needed?

Inter-process communication is the set of OS mechanisms that let processes exchange data and synchronize — pipes, sockets, message queues, shared memory, signals. It's needed because processes have isolated address spaces by design, but real applications are built from cooperating processes (pipelines, client/server, worker pools).

### [L1 · compare] Pipe vs named pipe (FIFO)?

A pipe is anonymous: it exists only as file descriptors inherited through fork, so only related processes can use it. A FIFO has a name in the filesystem (created with `mkfifo`), so unrelated processes can open it. Both are unidirectional byte streams with a kernel buffer.

### [L2 · compare] Compare shared memory and message passing.

Message passing (pipes, sockets, queues) copies data through the kernel: simpler, isolated, built-in blocking and backpressure, but each message costs syscalls and two copies. Shared memory maps the same physical pages into both processes: no copies or syscalls per access, so it's fastest for large data, but processes must synchronize explicitly (locks, atomics, semaphores) and can corrupt each other's data.

### [L2 · how] What happens when a process reads from a pipe whose write ends are all closed? And writes to one whose read ends are all closed?

Reading returns 0 (EOF) once the buffer is drained. Writing raises SIGPIPE (default: terminate); if SIGPIPE is ignored, `write` fails with `EPIPE`.

### [L3 · debugging] A parent process spawns a child, writes 1 MB to its stdin, then reads its stdout. It hangs forever. Why?

Classic pipe deadlock: the child reads some input and writes output; the stdout pipe buffer (64 KB) fills because the parent isn't reading yet, so the child blocks on write and stops reading stdin; the stdin pipe fills, so the parent blocks on write. Both wait on each other. Fix: read and write concurrently (threads, non-blocking I/O with poll, or helpers like `communicate()`), or use a temporary file.

### [L3 · why] Why does PostgreSQL use shared memory between its backend processes?

Backends must share the buffer cache (so a page read by one is available to all), lock tables, WAL buffers and transaction status. Copying these through message passing would be prohibitively slow. Shared memory lets all backends access them directly, coordinated by spinlocks/LWLocks and semaphores — while keeping process isolation for each connection's private state.

### [L4 · design] Two processes on the same host must exchange ~2 million small messages per second with low latency. Which IPC would you choose?

A shared-memory ring buffer (single-producer/single-consumer, lock-free with atomic head/tail indices and proper memory ordering) avoids syscalls and copies per message. Notification: busy-poll if latency is critical and a core can be dedicated; otherwise spin briefly then wait on a futex/eventfd. Batch messages to amortize notifications. If simplicity or crash isolation matters more, Unix domain datagram sockets with batching (`sendmmsg`) might suffice. Measure both.

## Practice

### [mcq] Which IPC mechanism can pass an open file descriptor from one process to another?

- [ ] Pipe
- [ ] Signal
- [x] Unix domain socket (SCM_RIGHTS)
- [ ] POSIX message queue

Unix domain sockets support ancillary data including open file descriptors.

### [mcq] Which mechanism involves zero data copies per message after setup?

- [ ] Pipe
- [ ] TCP loopback
- [x] Shared memory
- [ ] Message queue

Both processes access the same physical pages directly.

## Quick Revision

- IPC = message passing (kernel copies: pipes, sockets, queues) vs shared memory (no copies, needs synchronization).
- **Pipe**: unidirectional byte stream, related processes, EOF when writers close, SIGPIPE when readers close, atomic ≤ 4 KB writes.
- **FIFO**: named pipe for unrelated processes. **Unix socket**: bidirectional, local, fd passing, peer credentials.
- **Shared memory**: fastest, but races and crash-safety are your problem.
- Signals notify; they don't carry data.
- Pipe buffers → backpressure; also → deadlock if both sides block writing.
