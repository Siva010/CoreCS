---
title: "epoll and Event Loops: How Backend Servers Handle Thousands of Connections"
subject: os
level: 9
order: 3
summary: "Inside epoll (interest list, ready list, level- vs edge-triggered), the reactor pattern, and how Nginx, Redis, Node.js, Netty and Go's runtime build on it."
depth: advanced
difficulty: 4
minutes: 45
relevance: high
stage: 3
prerequisites: [os-io-models]
related: [cn-sockets, os-thread-pools, x-overloaded-server, db-redis-caching, cn-realtime]
visualizations: [io-models]
tags: [epoll, event loop, reactor, proactor, level triggered, edge triggered, epolloneshot, so_reuseport, nginx, redis, node.js, netty, libuv, goroutines, c10k, thundering herd, java nio, virtual threads]
---

## Mental Model

An event loop is a **dispatcher at a switchboard with thousands of phone lines**. Most lines are silent. The dispatcher doesn't listen to each one in turn. The switchboard lights up the lines that have a caller, and the dispatcher handles only those. It handles them quickly and never puts anyone on a long hold, because while it's busy with one call, every other line waits.

**epoll is the switchboard. The event loop is the dispatcher.** The golden rule follows: **never do slow work at the switchboard.**

## Definition

- **epoll**: Linux's scalable I/O event notification facility: `epoll_create1` creates an instance; `epoll_ctl` adds/modifies/removes fds in its **interest list**; `epoll_wait` blocks until fds on the **ready list** have events.
- **Event loop**: a single thread repeatedly waiting for events and dispatching handlers: `while (true) { events = wait(); for e in events: handle(e); run_timers(); }`.
- **Reactor pattern**: demultiplex readiness events and dispatch to handlers that perform non-blocking I/O (epoll, kqueue).
- **Proactor pattern**: initiate asynchronous operations and dispatch completion events (IOCP, io_uring).

## Why It Exists

**The problem.** Thread-per-connection hits walls around tens of thousands of connections: memory for stacks, scheduler overhead, context switches, and lock contention. `select`/`poll` scan every fd on every call — O(n) — so 50,000 mostly idle connections cost 50,000 checks per wakeup. **The idea.** Don't ask every connection "anything for me?" on every wait. Instead, have each connection *announce itself* when something happens, and keep a list of the ones that did. epoll (Linux 2.6, 2002) made the cost of each wait proportional to *active* connections. That solved the C10K problem and made C100K+ possible.

:::callout[That's all it is]{type=insight}
epoll is a kernel-side list of "sockets that have something for you", filled in by callbacks as packets arrive. An event loop is one thread that takes that list, handles each item quickly, and asks again.
:::

## How It Works

### Inside epoll

```mermaid
flowchart TD
    subgraph kernel["kernel: epoll instance"]
      I["interest list<br/>(red-black tree<br/>of watched fds)"]
      R["ready list<br/>(linked list of<br/>fds with events)"]
    end
    S1["socket A<br/>receives data"] -->|"wakeup callback<br/>adds A"| R
    S2["socket B<br/>becomes writable"] -->|"callback adds B"| R
    App["event loop thread"] -->|"epoll_ctl<br/>ADD/MOD/DEL"| I
    App -->|"epoll_wait"| R
    R -->|"returns A, B"| App
```

When you add an fd, the kernel registers a **callback** on that file's wait queue. When a packet arrives on socket A, the network stack wakes the socket's wait queue, the callback appends A to the ready list and wakes any thread in `epoll_wait`. `epoll_wait` just drains the ready list — no scanning.

### Level-triggered vs edge-triggered

A design choice about *how often to remind you*: keep telling you while data is waiting, or tell you only when new data arrives.

- **Level-triggered (default)**: `epoll_wait` reports an fd as long as the condition holds (unread data remains). Forgiving: if you read only part of the data, you'll be told again.
- **Edge-triggered (`EPOLLET`)**: reported only when the state **changes** (new data arrives). You must read until `EAGAIN` each time, or leftover data will never be reported again — a hang. Fewer wakeups, more discipline.

```java
// Read handler that drains the socket completely (required in edge-triggered mode)
ByteBuffer buf = ByteBuffer.allocate(16 * 1024);
while (true) {
    buf.clear();
    int n = channel.read(buf);            // a non-blocking SocketChannel
    if (n > 0) { buf.flip(); process(buf); continue; }
    if (n == 0) break;                    // drained: EAGAIN underneath
    key.cancel();                         // n == -1: the peer closed the connection
    channel.close();
    break;
}
```

The JDK's own `Selector` registers sockets with epoll in level-triggered mode, so a handler that reads only once is told again on the next `select()`. Netty's native epoll transport (`EpollEventLoopGroup`) uses edge-triggered mode by default, so its handlers must drain like this.

`EPOLLONESHOT` disables an fd after one event until re-armed — used when multiple threads share one epoll instance so two threads never handle the same connection concurrently.

### Anatomy of an event loop iteration

1. Compute the timeout from the nearest timer (idle-connection timeouts, retries, scheduled tasks).
2. `epoll_wait(ep, events, max, timeout)`.
3. For each event: accept new connections, read requests into per-connection buffers, parse, generate responses (or hand off CPU/blocking work to a pool), write responses (partial writes → register interest in `EPOLLOUT`).
4. Run expired timers and queued callbacks (e.g., completions from worker threads, microtasks/promises in JavaScript).
5. Repeat.

## Internal Mechanism

### Multi-core event loops

An event loop removes the cost of many threads — but it also removes the parallelism. One loop uses one core. Servers scale across cores by:

- **Multiple processes**, each with its own loop (Nginx workers, Node.js cluster), sharing listening sockets. **`SO_REUSEPORT`** gives each worker its own listening socket and lets the kernel load-balance incoming connections by hash, avoiding the **thundering herd** (all workers waking for one new connection; `EPOLLEXCLUSIVE` also addresses it).
- **Multiple threads**, one loop each (Netty's EventLoopGroup, Envoy workers, Redis 6+ I/O threads for reads/writes while command execution stays single-threaded).
- **Runtime schedulers**: Go multiplexes goroutines over OS threads; a goroutine blocking on a socket is parked, and the runtime's **netpoller** (epoll) resumes it when ready — blocking-style code, event-loop efficiency. Java virtual threads work the same way. A virtual thread that blocks on a socket is parked, and the socket is registered with the JDK's poller threads (epoll on Linux). When data arrives, the virtual thread is resumed on a carrier.

### Redis: why single-threaded is fast

Redis executes commands on one thread using an event loop: no locks on data structures, excellent cache locality, and commands are microsecond-scale. It serves 100k+ ops/s per core. The flip side: one slow command (`KEYS *`, a big `SMEMBERS`, a Lua script) blocks every client ([Redis & Caching](lesson:db-redis-caching)).

:::depth{level=advanced}
### Backpressure in event loops

An event loop reading as fast as clients send can buffer unbounded data if downstream is slower — memory blowup. Well-behaved servers stop reading (remove `EPOLLIN` interest) when a connection's output buffer exceeds a watermark. Unread data then fills the kernel socket buffer, the TCP receive window shrinks, and the sender slows down: **backpressure propagated all the way to the client via TCP flow control** ([Flow Control](lesson:cn-tcp-flow-control)). Redis's `client-output-buffer-limit` and Netty's `WRITE_BUFFER_WATER_MARK` implement this.
:::

## Example

A Netty request handler, mapped to the machinery. Everything in `channelRead` runs on the event-loop thread:

```java
public void channelRead(ChannelHandlerContext ctx, Object msg) {
    byte[] report = Files.readAllBytes(Path.of("/data/big.json"));   // BLOCKS the loop: synchronous file read!
    ctx.writeAndFlush(toJson(transform(report, msg)));                // CPU work on the loop thread
}
```

Reading the request and writing the response are fine: they are non-blocking socket operations driven by epoll. The synchronous file read and the heavy transform freeze **every** connection on this event loop for their duration. Fix: read the file once at startup and cache it (or read it on a separate executor), move the CPU-heavy transform to a worker pool, and write the response when the result is ready.

## Visualization

::viz{id=io-models}

## Complexity & Performance

- epoll_wait: O(k) for k ready events; epoll_ctl: O(log n).
- Per-connection memory: kernel socket buffers (tunable, KB–MB) + app state — the real limit for millions of connections.
- A well-written event loop can handle tens of thousands of requests per second per core for small requests; throughput is limited by per-request CPU work.

## Trade-offs

| | Event loop | Thread per connection | Goroutines / virtual threads |
|---|---|---|---|
| Idle connection cost | Tiny | Thread stack + kernel task | Small (KBs) |
| Programming model | Callbacks / async-await | Straight-line blocking | Straight-line blocking |
| CPU-heavy handlers | Must offload | Fine | Fine (preempted by runtime) |
| Fairness | Cooperative: one handler can starve others | Preemptive | Mostly preemptive |
| Debuggability | Stack traces span callbacks | Simple | Simple |

## Failure Modes

- **Loop blocking** by sync I/O or CPU work → latency spikes for all connections.
- **Edge-triggered starvation**: not draining to EAGAIN → connections hang.
- **Unbounded buffers** without backpressure → memory exhaustion.
- **Thundering herd** on accept without `SO_REUSEPORT`/`EPOLLEXCLUSIVE`.
- **Timer leaks** (idle connections never closed) → fd exhaustion.

## In Production

- **Nginx**: master + N worker processes, each an epoll event loop; `worker_connections` per worker; `sendfile` for static files.
- **Netty (Java)**: boss group accepts, worker groups (one loop per thread) handle I/O; blocking work must go to separate executors.
- **Envoy**: one event loop per worker thread; connections pinned to a worker.
- Monitoring: event-loop lag/delay metrics are the single most useful health signal for event-loop services.

## Deeper Connections

- The readiness events come from socket buffers filled by the TCP stack ([Sockets](lesson:cn-sockets)).
- WebSocket and SSE servers holding many idle connections are the classic event-loop workload ([Real-time Communication](lesson:cn-realtime)).
- Overload behavior of event loops vs thread pools: [Overloaded Servers](lesson:x-overloaded-server).

## Common Misconceptions

- **"Event loops mean single-threaded servers."** Production servers run one loop per core (processes or threads).
- **"Edge-triggered is always better."** It reduces wakeups but requires draining and careful state handling; level-triggered is simpler and often fast enough.
- **"Async code can't block."** Any synchronous CPU or I/O work inside a callback blocks the loop.

## Interview Questions

### [L2 · how] How does epoll achieve O(1)-ish scalability compared to select/poll?

fds are registered once in a kernel interest list; the kernel attaches callbacks to each fd's wait queue, and when an fd becomes ready the callback appends it to a ready list. `epoll_wait` returns entries from the ready list without scanning all watched fds, so its cost is proportional to the number of ready fds, not the total.

### [L2 · compare] Level-triggered vs edge-triggered epoll?

Level-triggered reports an fd whenever the condition is true (e.g., unread data remains), so partial reads are safe. Edge-triggered reports only on state transitions (new data arriving), so the handler must read/write until EAGAIN; otherwise remaining data may never trigger another event and the connection stalls. Edge-triggered reduces redundant wakeups.

### [L2 · why] Why is Redis fast despite being single-threaded?

Its data lives in memory, commands are mostly O(1)/O(log n) microsecond operations, and a single-threaded event loop avoids locks, context switches and cache-coherence traffic. Network I/O is multiplexed with epoll. The bottleneck is typically network and syscall overhead, which Redis 6+ can spread with I/O threads while keeping command execution single-threaded.

### [L2 · how] A Java 21 virtual thread calls `socket.getInputStream().read()` and no data has arrived. Where does epoll come in?

The read reaches the JDK's socket code, which tries a non-blocking read and gets `EAGAIN`. Instead of blocking the carrier (kernel) thread, the JDK registers the socket with a poller, a JDK thread that waits in `epoll_wait`, and parks the virtual thread, freeing the carrier to run other virtual threads. When data arrives, epoll reports the socket, the poller unparks the virtual thread, and it is scheduled onto a free carrier, where it retries the read and gets the data. The code looks blocking, but underneath it's an event loop: thousands of waiting virtual threads cost one epoll registration each, not one kernel thread each.

### [L3 · debugging] An event-loop service's latency p99 jumped after adding a feature that compresses responses. Throughput dropped too. Why?

Compression is CPU work executed on the event-loop thread; while compressing one large response, the loop can't service other connections, so their events queue up (event-loop lag). Move compression to a worker pool, compress in chunks yielding to the loop, cache compressed variants, or scale the number of loops/processes with cores.

### [L3 · what-if] What happens with edge-triggered epoll if your read handler reads only once per event and more data remains?

No new edge occurs because the socket is already readable, so epoll never reports it again; the remaining data sits in the socket buffer until the client sends more (which may never happen, e.g., waiting for a response). The connection appears hung. Always drain to EAGAIN in ET mode.

### [L4 · design] Design the threading/event model for a WebSocket gateway on a 32-core box handling 500k connections with occasional CPU-heavy message transformations.

Run one event loop per core (32 threads or processes) with SO_REUSEPORT to balance accepts; each loop owns its connections (no cross-thread locking on connection state). Use edge-triggered epoll or io_uring, bounded per-connection write buffers with backpressure, and a timing wheel for heartbeats/idle timeouts. Offload CPU-heavy transformations to a separate bounded worker pool with a queue and deadlines; results are posted back to the owning loop. Tune kernel limits (fds, socket buffer memory), monitor per-loop lag and connection counts, and plan for reconnect storms (rate-limit accepts, jittered client reconnects).

## Practice

### [mcq] In edge-triggered mode, when must a read handler stop reading?

- [ ] After one read() call
- [ ] When read() returns fewer bytes than requested
- [x] When read() returns -1 with EAGAIN (or 0 for EOF)
- [ ] After 64 KB

Only EAGAIN proves the buffer is drained.

### [mcq] Which socket option lets multiple worker processes each have their own listening socket on the same port, with kernel load balancing?

- [ ] SO_REUSEADDR
- [x] SO_REUSEPORT
- [ ] SO_KEEPALIVE
- [ ] TCP_NODELAY

SO_REUSEPORT distributes incoming connections across sockets by hash.

### [numeric 75 unit=%] An event loop serves 5,000 requests per second, and each request needs 0.15 ms of CPU on the loop thread. What fraction of the loop thread is busy?

:::answer
5,000 × 0.15 ms = 750 ms of work per second = **75**%. The remaining 25% is headroom; as it approaches 100%, events wait in line and event-loop lag (and latency) rises sharply.
:::

### [numeric 4000] Each request needs 0.25 ms of CPU on its event-loop thread. What is the most requests per second one loop can handle?

:::answer
1,000 ms / 0.25 ms = **4000** requests per second per loop. To go beyond it, run more loops (one per core) or move CPU work off the loop.
:::

### [mcq] A Java NIO handler reads one buffer per readiness event and leaves any remaining bytes for later. It works with the JDK's `Selector`, but connections hang after switching to Netty's native epoll transport. Why?

- [ ] Netty doesn't support non-blocking reads
- [x] The JDK's `Selector` is level-triggered, so leftover data is reported again; Netty's native transport is edge-triggered, so leftover data produces no new event until more bytes arrive
- [ ] The native transport limits each connection to one read
- [ ] epoll doesn't work with Java

Edge-triggered epoll reports a change, not a state. If the handler stops before `read` returns 0 (EAGAIN), the remaining bytes sit in the socket buffer with nothing to announce them.

### [exercise] A Java service built on an event-loop framework (Netty, or Vert.x with 2 loops per core on 8 cores) starts compressing large JSON responses inline in its handlers. p99 latency for *all* endpoints jumps from 5 ms to 200 ms. Explain using event-loop lag, and propose a fix. Compare the models in the [I/O models visualization](viz:io-models).

:::solution
Each event loop runs every handler for its connections, one at a time. Compressing a large response takes, say, 20–100 ms of CPU, and while that runs the loop can't call `epoll_wait` or run any other handler. Every request on that loop, even a trivial one, queues behind the compression. That waiting time is event-loop lag, and with several large responses in a row it adds up to the 200 ms p99.

Fix:
- Offload the compression to a bounded worker pool sized to the cores (`executor.submit(() -> compress(body))`), and write the result back on the loop when it completes. The loop stays free to handle I/O.
- Cache compressed versions of large, repeated responses, or compress in chunks while streaming.
- Monitor event-loop lag (Vert.x has a blocked-thread checker; for Netty, schedule a task and measure how late it runs) and alert on it.
:::

## Quick Revision

- epoll: interest list (RB-tree) + ready list fed by wait-queue callbacks → `epoll_wait` cost ∝ ready fds.
- **Level-triggered**: repeated notifications while ready. **Edge-triggered**: on change only → drain to EAGAIN. `EPOLLONESHOT` for multi-threaded handling.
- Event loop: wait → dispatch handlers → timers → repeat. **Never block the loop.**
- Scale: one loop per core (processes/threads), `SO_REUSEPORT`, runtimes (Go netpoller, virtual threads).
- Reactor (readiness) vs proactor (completion).
- Backpressure: stop reading when output buffers are full → TCP window shrinks.
- Java: JDK `Selector` = level-triggered epoll; Netty native epoll = edge-triggered (drain until `read` returns 0); virtual threads park on a JDK epoll poller.
