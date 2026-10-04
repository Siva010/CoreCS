---
title: "TCP Flow Control: Sliding Windows, Receive Windows, Window Scaling and Nagle"
subject: cn
level: 4
order: 5
summary: "How the receiver throttles the sender: the sliding window over the byte stream, rwnd, zero windows and persist timers, window scaling for fast long links, and the Nagle/delayed-ACK interaction."
depth: core
difficulty: 4
minutes: 40
relevance: high
stage: 2
prerequisites: [cn-tcp-reliability]
related: [cn-tcp-congestion-control, cn-latency-bandwidth, cn-sockets, os-epoll-event-loops]
visualizations: [sliding-window]
labs: [network-calculator]
tags: [flow control, sliding window, receive window, rwnd, send window, window scaling, zero window, persist timer, silly window syndrome, nagle, delayed ack, bandwidth-delay product]
---

## Mental Model

The receiver has a bucket (its **receive buffer**) and tells the sender, with every ACK, how much room is left: "I can take 64 KB more." The sender may have at most that many **unacknowledged bytes in flight**. As the receiving application drains the bucket, the advertised room grows again. If the application stops reading, the bucket fills, the advertised room reaches zero, and the sender must stop — no matter how fast the network is.

The allowed range slides forward over the byte stream as acknowledgments arrive: a **sliding window**.

## Definition

- **Receive window (rwnd)**: free space in the receiver's buffer, advertised in every segment's Window field.
- **Send window**: the range of sequence numbers the sender may transmit = from the oldest unacknowledged byte up to `min(rwnd, cwnd)` bytes beyond it (cwnd = congestion window, [Congestion Control](lesson:cn-tcp-congestion-control)).
- **Flow control**: preventing a fast sender from overwhelming a slow **receiver**. (Congestion control protects the **network**.)
- **Window scaling**: a handshake option multiplying the 16-bit window field by 2^scale (up to 2^14), allowing windows up to ~1 GB.

## Why It Exists

**The problem.** Senders and receivers run at different speeds: a server streaming a file to a slow phone, a producer feeding a busy consumer.

**Without it.** Without flow control, the receiver would drop data it can't buffer, forcing retransmissions that waste the network.

**The idea.** The receiver is the only one who knows how much room it has — so let it say so on every ACK, and forbid the sender from having more unacknowledged data in flight than that. The limit moves forward as data is acknowledged, which is why it's called a sliding window.

:::callout[That's all it is]{type=insight}
The receiver advertises "I have room for N more bytes"; the sender never has more than N unacknowledged bytes out. If the receiving app stops reading, N drops to zero and the sender waits.
:::

## How It Works

### The sender's view of the byte stream

```text
 bytes: ... | acked | sent, not yet acked (in flight) | can send now | not allowed yet ...
                    ^                                               ^
                 SND.UNA                                 SND.UNA + min(rwnd, cwnd)
                    |<------------------ send window ------------------>|
```

- When an ACK arrives, SND.UNA moves right: the window **slides**.
- When an ACK carries a smaller window (receiver buffer filling), the right edge stops or moves less.
- Bytes in flight can never exceed the window.

::viz{id=sliding-window}

### Zero windows and the persist timer

An edge case the basic rule doesn't handle. If the receiving application stops reading, rwnd hits **0**. The sender stops sending data but starts a **persist timer** and periodically sends a tiny **window probe** — otherwise, if the receiver's "window reopened" update were lost, both sides would wait forever (a deadlock). When the app reads, the receiver advertises a non-zero window and transfer resumes.

This is backpressure in action: a slow consumer → full socket receive buffer → zero window → sender's send buffer fills → sender's `write()` blocks → the producing application slows down.

### Throughput is bounded by window / RTT

A consequence of "only N bytes in flight" that surprises people: the window, not the link speed, can be the limit. At most one window of data can be in flight per round trip:

```text
max throughput ≈ window / RTT
```

A 64 KB window on a 100 ms RTT path: 65,535 B / 0.1 s ≈ **5.2 Mb/s** — no matter if the link is 10 Gb/s. To fill a path you need `window ≥ bandwidth × RTT` — the **bandwidth-delay product (BDP)**:

- 1 Gb/s × 100 ms = 10⁹ × 0.1 / 8 = **12.5 MB** in flight.

The original 16-bit window field (max 65,535 bytes) is far too small; **window scaling** (RFC 7323) negotiated in the SYN fixes that. Linux also **autotunes** socket buffers (`tcp_rmem`/`tcp_wmem` max values) — which is why transfers across oceans can still be slow on hosts with small buffer limits.

### Nagle's algorithm and delayed ACKs

Two separate optimisations, each sensible alone, that both try to avoid sending tiny packets — and that can wait on each other.

- **Nagle's algorithm** (sender): if there's unacknowledged data in flight, buffer small writes until either a full segment accumulates or an ACK arrives. Prevents floods of tiny packets (the "silly" 41-byte packets of interactive typing).
- **Delayed ACK** (receiver): wait briefly (up to ~40 ms on Linux) to piggyback the ACK on data.

Together they can stall: the sender holds a small final chunk waiting for an ACK; the receiver holds the ACK waiting for more data or its timer → a ~40 ms pause per exchange. Request/response protocols (RPC, databases, Redis, trading) typically set **`TCP_NODELAY`** to disable Nagle, and write each message with a single `write`/`writev` to avoid sending partial messages.

## Internal Mechanism

:::depth{level=advanced}
### Silly window syndrome

If a receiver advertises tiny window increments (reading a few bytes at a time) and the sender immediately fills them, the connection degrades into tiny segments with huge header overhead. Fixes on both sides (Clark's algorithm for receivers — don't advertise small increases until the window reaches min(MSS, half the buffer); Nagle-like rules for senders) keep segments large.

### Receive-window tuning and memory

Autotuning grows the receive buffer as the connection proves a large BDP. Memory scales with connections × buffer size: 10,000 connections with 4 MB buffers would be 40 GB. Kernels cap total TCP memory (`tcp_mem`) and apply pressure; large-connection-count servers keep buffers modest while bulk-transfer hosts need large maximums.
:::

## Example

Two 50 KB windows compared on a transatlantic path (RTT 80 ms):

| Window | Max throughput |
|---|---|
| 64 KB (no scaling) | 64 KB / 0.08 s ≈ 800 KB/s ≈ 6.5 Mb/s |
| 16 MB (scaled) | 16 MB / 0.08 s = 200 MB/s ≈ 1.6 Gb/s |

A "slow" cross-region backup copy that won't exceed ~6 Mb/s regardless of link speed is the classic symptom of an unscaled or capped window.

## Complexity & Performance

- Throughput ≤ min(rwnd, cwnd) / RTT.
- Latency-sensitive small messages: Nagle/delayed ACK interplay; `TCP_NODELAY`.
- Memory: buffer size × connections.

## Trade-offs

- Big windows: full use of long fat networks vs memory and larger queues (bufferbloat) when the bottleneck is small.
- Nagle: fewer small packets vs added latency for request/response traffic.

## Failure Modes

- Throughput capped by window/RTT on high-latency links (missing window scaling — sometimes stripped by broken middleboxes — or small buffer limits).
- Stalls from zero windows when the receiving application is blocked (GC pause, slow disk).
- 40 ms latency spikes from Nagle + delayed ACK.
- Memory pressure from huge buffers × many connections.

## In Production

- `ss -ti` shows per-connection `rcv_space`, `snd_wnd`, `cwnd`, RTT — compute whether throughput is window-limited.
- A growing `Recv-Q` on a server's established sockets means the application isn't reading (overloaded) → the peer sees a shrinking window.
- Use the [network calculator lab](lab:network-calculator) to size windows and buffers for a given path.

## Deeper Connections

- The effective window is `min(rwnd, cwnd)`: flow control and congestion control compose ([Congestion Control](lesson:cn-tcp-congestion-control)).
- Backpressure through socket buffers is how event loops push back on fast clients ([epoll & Event Loops](lesson:os-epoll-event-loops)).
- BDP math: [Latency & Bandwidth](lesson:cn-latency-bandwidth).

## Common Misconceptions

- **"Flow control and congestion control are the same thing."** Flow control protects the receiver (rwnd); congestion control protects the network (cwnd).
- **"A faster link always makes transfers faster."** Window/RTT can cap throughput far below link speed.
- **"TCP_NODELAY makes everything faster."** It lowers latency for small messages but can increase packet counts for chatty writers that write byte by byte.

## Interview Questions

### [L1 · conceptual] What is TCP flow control?

A mechanism that prevents the sender from overwhelming the receiver: the receiver advertises its available buffer space (receive window) in every ACK, and the sender never has more unacknowledged data in flight than that window.

### [L2 · how] Explain the sliding window.

The sender tracks the oldest unacknowledged byte and the window size (min of receive window and congestion window). It may send any bytes within [oldest unacked, oldest unacked + window). As ACKs arrive, the left edge advances; as the receiver frees buffer space, the right edge advances — the window slides over the byte stream, allowing continuous transmission without waiting for each segment's ACK.

### [L2 · what-if] What happens when the receiver's window becomes zero?

The sender stops sending data and starts a persist timer, periodically sending zero-window probes to learn when the window reopens (in case the window update is lost). When the receiving application reads data, the receiver advertises a non-zero window and transmission resumes.

### [L2 · numerical] What is the maximum throughput of a TCP connection with a 64 KB window and 50 ms RTT?

65,535 bytes / 0.05 s ≈ 1.31 MB/s ≈ **10.5 Mb/s**, regardless of link bandwidth.

### [L3 · debugging] A client in Europe downloads from a US server at ~5 Mb/s over a 1 Gb/s path with 100 ms RTT, while other tools reach 500 Mb/s. What would you check?

Window limits: 5 Mb/s × 0.1 s ≈ 64 KB in flight — the classic unscaled window. Check whether window scaling is negotiated (tcpdump the SYN options; some middleboxes strip it), socket buffer settings in the client (application setting a small SO_RCVBUF disables autotuning; `tcp_rmem` max), and the server's send buffer. Also check the application isn't reading slowly (receive buffer full → small advertised windows).

### [L3 · why] Why might an RPC client see ~40 ms extra latency on some calls, and how do you fix it?

Nagle's algorithm on the client delays sending the last small part of a request while earlier data is unacknowledged, and the server delays its ACK (delayed ACK ~40 ms) waiting for more data — each waits for the other. Fix: set TCP_NODELAY and write each request as a single buffer (or writev), avoiding multi-write messages.

## Practice

### [numeric 12.5 ±0.1 unit=MB] What bandwidth-delay product (in MB) is needed to fill a 1 Gb/s path with 100 ms RTT?

:::answer
10⁹ bit/s × 0.1 s = 10⁸ bits = **12.5 MB**.
:::

### [numeric 10.5 ±0.2 unit=Mb/s] Max throughput with a 65,535-byte window and 50 ms RTT, in Mb/s?

:::answer
65,535 × 8 / 0.05 ≈ 10,485,600 bit/s ≈ **10.5 Mb/s**.
:::

### [mcq] Which flow-control feature allows receive windows larger than 64 KB?

- [ ] SACK
- [ ] Nagle's algorithm
- [x] The window scale option
- [ ] Delayed ACK

Negotiated in the SYN; multiplies the window field by 2^scale.

## Quick Revision

- Receiver advertises **rwnd** (free buffer); sender keeps in-flight ≤ min(rwnd, cwnd).
- Window slides as ACKs arrive and buffer frees.
- Zero window → persist timer + probes; slow app → full buffers → backpressure to the sender.
- Throughput ≤ window / RTT; need window ≥ **BDP** = bandwidth × RTT; **window scaling** + autotuning.
- Nagle + delayed ACK → ~40 ms stalls → `TCP_NODELAY` for request/response.
- Flow control ≠ congestion control.
