---
title: "TCP Congestion Control: Slow Start, AIMD, Fast Recovery, CUBIC and BBR"
subject: cn
level: 4
order: 6
summary: "How TCP discovers how fast it can send without collapsing the network: the congestion window, slow start and ssthresh, additive increase/multiplicative decrease, Tahoe vs Reno recovery, and modern algorithms."
depth: advanced
difficulty: 4
minutes: 50
relevance: high
stage: 2
prerequisites: [cn-tcp-flow-control]
related: [cn-latency-bandwidth, cn-mtu-congestion, cn-tail-latency, cn-http3-quic]
visualizations: [congestion]
tags: [congestion control, congestion window, cwnd, slow start, ssthresh, congestion avoidance, aimd, fast retransmit, fast recovery, tahoe, reno, cubic, bbr, ecn, bufferbloat, congestion collapse]
---

## Mental Model

Nobody tells a TCP sender how much capacity the path has, and thousands of other flows share it. So the sender **probes**: it starts cautiously, speeds up while things go well, and backs off sharply when it sees signs of congestion (lost packets, or growing delay). Every flow doing this independently makes them converge to a roughly fair share of the bottleneck — decentralized traffic control with no traffic controller.

The sender's self-imposed limit is the **congestion window (cwnd)**: the maximum bytes it lets itself have in flight, independent of what the receiver can take.

## Definition

- **Congestion window (cwnd)**: sender-side limit on unacknowledged bytes, adjusted by the congestion-control algorithm. Effective window = `min(cwnd, rwnd)`.
- **Slow start**: exponential growth of cwnd at the start (and after a timeout): +1 MSS per ACK → roughly doubling every RTT.
- **ssthresh (slow-start threshold)**: the cwnd at which slow start switches to congestion avoidance.
- **Congestion avoidance / AIMD**: additive increase (+1 MSS per RTT) and multiplicative decrease (halve on loss).
- **Fast retransmit / fast recovery**: on 3 duplicate ACKs, retransmit the lost segment and halve cwnd instead of collapsing to 1.

## Why It Exists

In October 1986 the internet suffered **congestion collapse**: throughput between LBL and UC Berkeley fell from 32 kb/s to 40 b/s. Senders retransmitted aggressively into full queues, which caused more loss and more retransmissions. Van Jacobson's 1988 algorithms (slow start, congestion avoidance, fast retransmit) made TCP back off, saving the internet — and every TCP stack still descends from them.

## How It Works

### Phases (Reno-style, counted in MSS units)

1. **Slow start**: cwnd starts at the **initial window** (modern default 10 MSS, RFC 6928). Each ACK adds 1 MSS → cwnd doubles each RTT: 10, 20, 40, 80…
2. **Congestion avoidance**: once cwnd ≥ ssthresh, grow by ~1 MSS per RTT (linear).
3. **Loss detected by 3 duplicate ACKs** (mild congestion — packets are still getting through):
   - **Reno**: ssthresh = cwnd/2; cwnd = ssthresh (+3 during fast recovery); retransmit; continue in congestion avoidance.
   - **Tahoe** (older): ssthresh = cwnd/2; cwnd = 1; slow start again.
4. **Loss detected by timeout** (severe — nothing is getting through): ssthresh = cwnd/2; **cwnd = 1 MSS** (Linux uses the loss window); slow start again.

::viz{id=congestion}

### Worked trace (Reno, cwnd in MSS, initial window 1 for readability, ssthresh = 16)

| RTT | Event | cwnd |
|---|---|---|
| 0 | slow start | 1 |
| 1 | | 2 |
| 2 | | 4 |
| 3 | | 8 |
| 4 | | 16 → reached ssthresh, switch to linear |
| 5 | congestion avoidance | 17 |
| 6 | | 18 |
| 7 | | 19 |
| 8 | 3 dup ACKs at cwnd 20 | ssthresh = 10, cwnd = 10 (fast recovery) |
| 9 | congestion avoidance | 11 |
| … | | … |
| 12 | timeout at cwnd 14 | ssthresh = 7, cwnd = 1, slow start |
| 13 | | 2 |
| 14 | | 4 |
| 15 | | 7 → linear from here (capped at ssthresh) |

The resulting cwnd graph is the famous **sawtooth**: linear climbs and halvings.

### AIMD converges to fairness

Two flows sharing a bottleneck: additive increase raises both equally; multiplicative decrease cuts the larger one by more. Repeated, this pulls them toward equal shares (Chiu & Jain). This is why TCP flows are "roughly fair" per flow — and why an application opening 10 parallel connections gets ~10× the share of one.

## Internal Mechanism

### Loss-based vs delay-based vs model-based

| Algorithm | Signal | Behavior | Where |
|---|---|---|---|
| **Reno / NewReno** | Loss | AIMD, halve on loss | Classic reference |
| **CUBIC** | Loss | After a loss, cwnd grows as a cubic function of time since the loss — fast far from the previous max, careful near it; less RTT-unfair than Reno on long fat networks | **Default in Linux, Windows, macOS** |
| **BBR** (v1/v2/v3) | Model: measured bottleneck bandwidth and min RTT | Paces at the estimated bandwidth and keeps in-flight ≈ BDP; doesn't treat random loss as congestion | Google, many CDNs; available in Linux |
| **Vegas / delay-based** | RTT increase | Backs off when queues grow | Rarely used alone (loses to loss-based flows) |

### Bufferbloat

Loss-based algorithms increase cwnd until a router's buffer overflows. If buffers are huge (common in consumer routers and cellular networks), the queue fills first — adding **hundreds of milliseconds** of latency to every packet before any loss signals congestion. Mitigations: smarter queue management in routers (**AQM**: CoDel, FQ-CoDel, PIE), delay/model-aware congestion control (BBR), and **ECN**.

:::depth{level=advanced}
### ECN — congestion signals without loss

With **Explicit Congestion Notification**, an ECN-capable router experiencing queue buildup *marks* packets (CE bit in the IP header) instead of dropping them. The receiver echoes the mark (ECE flag); the sender reduces cwnd as if a loss occurred (CWR flag) — but no data was lost and no retransmission is needed. Data centers use ECN heavily (DCTCP reacts proportionally to the fraction of marked packets, keeping queues tiny for low latency). L4S extends this for the internet.

### Pacing

Rather than sending a whole cwnd in a burst when ACKs arrive, modern stacks **pace** packets evenly over the RTT (Linux `fq` qdisc). Bursts overflow shallow switch buffers; pacing avoids it. BBR relies on pacing.
:::

## Example

Why a new connection is slow for the first round trips: fetching a 1 MB response on a fresh connection with initial cwnd = 10 MSS (~14.6 KB), RTT 50 ms, ignoring loss:

| RTT | cwnd (KB) | Cumulative sent (KB) |
|---|---|---|
| 1 | 14.6 | 14.6 |
| 2 | 29.2 | 43.8 |
| 3 | 58.4 | 102 |
| 4 | 117 | 219 |
| 5 | 234 | 453 |
| 6 | 467 | 920 |
| 7 | | ~1,000 ✔ |

≈ 7 RTTs = 350 ms of transfer even on a 10 Gb/s link. Latency, not bandwidth, dominates small transfers — the reason to reuse warm connections and keep web responses small ([Latency & Bandwidth](lesson:cn-latency-bandwidth)).

## Complexity & Performance

- Throughput with loss rate p, roughly (Mathis et al.): **throughput ≈ (MSS / RTT) × (1.22 / √p)** for Reno-like TCP. Doubling RTT halves throughput; 4× the loss halves it.
- Example: MSS 1,460 B, RTT 100 ms, p = 0.01% (10⁻⁴): (1460 × 8 / 0.1) × (1.22 / 0.01) ≈ 116,800 × 122 ≈ 14.2 Mb/s — a tiny loss rate caps a long-distance flow far below link speed.

## Trade-offs

- Aggressive growth: faster ramp-up vs more loss and unfairness.
- Loss-based: robust, widely deployed vs fills buffers (latency) and misreads random wireless loss as congestion.
- BBR: high throughput under random loss, low queues vs fairness issues with loss-based flows in some versions.

## Failure Modes

- Slow transfers on lossy long-distance paths (Mathis bound).
- Bufferbloat: huge latency under load on home/cellular links.
- Slow start after idle: some stacks reset cwnd after idle periods (`tcp_slow_start_after_idle`), hurting bursty long-lived connections — often disabled on servers.
- Parallel-connection abuse by clients to grab more bandwidth.

## In Production

- `ss -ti` shows `cwnd`, `ssthresh`, congestion algorithm, pacing rate, retransmits.
- Servers serving large objects over long paths may switch to BBR (`sysctl net.ipv4.tcp_congestion_control=bbr` with the `fq` qdisc) — measure first.
- Data centers use ECN + DCTCP or delay-based schemes for low queuing latency.

## Deeper Connections

- The effective window combines cwnd and rwnd ([Flow Control](lesson:cn-tcp-flow-control)).
- QUIC implements congestion control in user space, making experimentation easier ([HTTP/3 & QUIC](lesson:cn-http3-quic)).
- Queueing delay in routers is the network version of run-queue latency ([Performance Fundamentals](lesson:os-performance-method)); tail latency effects in [Tail Latency](lesson:cn-tail-latency).

## Common Misconceptions

- **"Slow start is slow."** It grows exponentially; it's "slow" only compared to blasting at line rate from the first packet.
- **"TCP knows the link bandwidth."** It infers capacity from ACKs, loss and delay.
- **"Packet loss always means congestion."** On wireless links, loss can be corruption; loss-based algorithms overreact to it.
- **"Congestion control is about the receiver."** That's flow control; congestion control protects the network.

## Interview Questions

### [L1 · compare] What is the difference between flow control and congestion control?

Flow control prevents the sender from overwhelming the receiver, using the receiver-advertised window (rwnd). Congestion control prevents senders from overwhelming the network, using a sender-maintained congestion window (cwnd) adjusted in response to loss or delay. The sender limits in-flight data to min(rwnd, cwnd).

### [L2 · how] Explain slow start and congestion avoidance.

In slow start, cwnd begins at the initial window and increases by one MSS per ACK, roughly doubling each RTT, to quickly find available capacity. When cwnd reaches ssthresh, TCP switches to congestion avoidance, increasing cwnd by about one MSS per RTT (additive increase). On loss, ssthresh is set to half the current cwnd and cwnd is reduced (to ssthresh with fast recovery for duplicate-ACK loss, or to 1 MSS after a timeout).

### [L2 · compare] How do Tahoe and Reno react differently to three duplicate ACKs?

Both fast-retransmit the missing segment and set ssthresh = cwnd/2. Tahoe then resets cwnd to 1 and re-enters slow start. Reno uses fast recovery: cwnd is set to ssthresh (plus inflation for the duplicate ACKs) and it continues in congestion avoidance, since duplicate ACKs show packets are still flowing.

### [L3 · why] Why does TCP treat a timeout more severely than three duplicate ACKs?

Duplicate ACKs mean later packets are still reaching the receiver — mild congestion, a single loss. A timeout means no ACKs are returning at all — possibly severe congestion or a broken path — so TCP collapses cwnd to restart probing cautiously.

### [L3 · numerical] Using the Mathis approximation, how does TCP throughput change if RTT doubles and the loss rate quadruples?

Throughput ∝ 1/(RTT × √p). Doubling RTT halves it; quadrupling p halves it again → **one quarter** of the original.

### [L4 · incident] Video uploads from users on mobile networks are slow though bandwidth tests look fine, and RTTs balloon under load. What's going on and what could the server side do?

Bufferbloat and loss-based congestion control: uplink queues in cellular networks are deep; loss-based TCP fills them, inflating RTT to hundreds of ms, and random radio losses are misinterpreted as congestion, cutting cwnd. Server-side options: enable BBR (and fq pacing) on upload endpoints (BBR primarily governs sending, so it helps downloads; for uploads, clients' stacks matter, suggesting QUIC-based upload clients with better congestion control), use resumable chunked uploads, and terminate at the edge closer to users.

## Practice

### [numeric 10] Reno: cwnd = 20 MSS when 3 duplicate ACKs arrive. What is the new ssthresh (in MSS)?

:::answer
ssthresh = cwnd / 2 = **10 MSS** (cwnd also becomes ~10 in fast recovery).
:::

### [numeric 1] After a retransmission timeout, what does classic TCP set cwnd to (in MSS)?

:::answer
**1 MSS** (then slow start up to the new ssthresh = half the previous cwnd).
:::

### [mcq] Which congestion-control algorithm is the default in Linux?

- [ ] Reno
- [ ] Vegas
- [x] CUBIC
- [ ] BBR

BBR is available but CUBIC is the default.

## Quick Revision

- cwnd (sender, protects network) vs rwnd (receiver); in flight ≤ min.
- **Slow start**: +1 MSS per ACK → doubling per RTT from IW = 10 MSS, until ssthresh.
- **Congestion avoidance**: +1 MSS per RTT (AIMD).
- 3 dup ACKs → ssthresh = cwnd/2, fast retransmit, (Reno) cwnd = ssthresh. Timeout → cwnd = 1, slow start.
- Tahoe vs Reno; **CUBIC** default; **BBR** models bandwidth + RTT; ECN marks instead of drops; pacing.
- Mathis: throughput ∝ MSS/(RTT·√p). Bufferbloat = huge queues + loss-based CC.
