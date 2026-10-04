---
title: "TCP Reliability: ACKs, Retransmission Timers, Fast Retransmit, SACK and Head-of-Line Blocking"
subject: cn
level: 4
order: 4
summary: "How TCP detects and repairs loss: cumulative ACKs, adaptive retransmission timeouts, duplicate ACKs and fast retransmit, selective acknowledgments — and why in-order delivery causes head-of-line blocking."
depth: core
difficulty: 4
minutes: 45
relevance: high
stage: 2
prerequisites: [cn-tcp-handshake]
related: [cn-tcp-flow-control, cn-tcp-congestion-control, cn-http2, cn-tail-latency]
visualizations: [sliding-window]
labs: [tcp-handshake]
tags: [acknowledgment, cumulative ack, retransmission, rto, rtt estimation, karn's algorithm, duplicate ack, fast retransmit, sack, delayed ack, head-of-line blocking, reordering]
---

## Mental Model

TCP's sender keeps a copy of every byte it sent until the receiver confirms it. Confirmation is **cumulative**: "I have everything up to byte N". Loss shows up in two ways:

- **Silence** — nothing is acknowledged for a while → a **timeout** fires → retransmit (slow, drastic).
- **Repeated confirmations of the same point** — the receiver keeps saying "still waiting for byte N" while later segments keep arriving → **duplicate ACKs** → retransmit that one segment right away (**fast retransmit**).

Because TCP must deliver bytes **in order**, a single missing segment holds back everything behind it even if it already arrived: **head-of-line blocking**.

## Definition

- **Cumulative ACK**: the acknowledgment number is the next byte expected; it implicitly acknowledges all earlier bytes.
- **RTO (retransmission timeout)**: the time a sender waits for an ACK before retransmitting, computed from measured RTTs.
- **Duplicate ACK**: an ACK repeating the same acknowledgment number, sent when an out-of-order segment arrives.
- **Fast retransmit**: retransmitting a segment after **3 duplicate ACKs**, without waiting for the RTO.
- **SACK (selective acknowledgment)**: an option letting the receiver report non-contiguous blocks it holds, so the sender retransmits only what's missing.
- **Head-of-line (HOL) blocking**: later data can't be delivered to the application until an earlier missing segment arrives.

## Why It Exists

**The problem.** IP loses packets routinely (congested router buffers are the main cause). The sender can't see the loss — it only sees that some acknowledgment hasn't come back.

**The dilemma.** TCP must detect loss quickly without mistaking delay for loss (spurious retransmissions waste bandwidth and can worsen congestion). Wait too long and every loss costs seconds; resend too eagerly and you flood an already-congested network with copies.

**The idea.** Use two signals with different speeds. The fast one: if the receiver keeps saying "still missing byte N" while later data arrives, N is almost certainly lost — resend now. The slow, safe one: if nothing at all comes back for longer than a typical round trip plus a margin, assume loss and resend.

:::callout[That's all it is]{type=insight}
Keep a copy of everything until it's acknowledged. Resend when a timer runs out, or sooner when three duplicate ACKs say a gap exists. SACK just tells the sender exactly which gaps to fill.
:::

## How It Works

### Retransmission on timeout

The hard part is choosing *how long* to wait: RTTs vary from 0.1 ms in a datacenter to 300 ms across the planet, and change over time. So TCP measures them and adapts. The sender starts a timer for the oldest unacknowledged segment. If it expires, it retransmits and **doubles** the RTO (exponential backoff).

**Computing the RTO** (RFC 6298): keep a smoothed RTT and its variation:

```text
SRTT   ← (1 − 1/8)·SRTT + (1/8)·R            (R = new RTT sample)
RTTVAR ← (1 − 1/4)·RTTVAR + (1/4)·|SRTT − R|
RTO    = SRTT + max(G, 4·RTTVAR)             (Linux enforces a 200 ms minimum; RFC says 1 s)
```

Example: SRTT = 100 ms, RTTVAR = 10 ms → RTO = 100 + 40 = 140 ms → clamped to the 200 ms Linux minimum.

**Karn's algorithm**: don't take RTT samples from retransmitted segments (you can't tell whether the ACK answers the original or the retransmission); timestamps (TSopt) solve this ambiguity and give an RTT sample per ACK.

### Fast retransmit via duplicate ACKs

Sender sends segments 1–5 (1,000 bytes each, seq 1, 1001, 2001, 3001, 4001); segment 2 is lost:

| Receiver gets | Receiver sends | Meaning |
|---|---|---|
| seg 1 (1–1000) | ACK 1001 | normal |
| seg 3 (2001–3000) | ACK 1001 (dup #1) | "still missing 1001" |
| seg 4 | ACK 1001 (dup #2) | |
| seg 5 | ACK 1001 (dup #3) | → sender fast-retransmits seg 2 |
| seg 2 (retransmitted) | **ACK 5001** | cumulative ACK jumps: everything through 5000 is here |

Why **3** duplicates? One or two duplicate ACKs can result from mild **reordering**; three is a heuristic that suggests true loss. (Modern Linux uses RACK — time-based loss detection — which handles reordering better.)

::viz{id=sliding-window}

### SACK

Cumulative ACKs can only describe the *first* gap. If several packets in one window are lost, the sender discovers them one round trip at a time. With cumulative ACKs alone, after multiple losses in one window the sender knows only the first gap. With SACK, the receiver says "ACK 1001; I also have 2001–5000 and 6001–7000", so the sender retransmits exactly 1001–2000 and 5001–6000 in one round trip. SACK is negotiated in the handshake and is on by default in modern stacks.

### Delayed ACKs

Receivers usually don't ACK every segment immediately: they wait up to ~40 ms (Linux, quick-ACK heuristics apply) or until two full segments arrive, to piggyback ACKs on responses and halve ACK traffic. Combined with Nagle's algorithm on the sender, this can cause **~40 ms stalls** for small request/response exchanges — the classic reason to set `TCP_NODELAY` ([Flow Control](lesson:cn-tcp-flow-control)).

## Internal Mechanism

### Head-of-line blocking

Segment 2 is lost; segments 3–100 arrive and sit in the **receiver's out-of-order queue**. The application's `read()` gets nothing new until segment 2's retransmission arrives — at least one extra RTT, or an RTO if fast retransmit can't trigger (e.g., loss of the last segments of a response, where there aren't 3 later segments to generate dup ACKs; **tail loss probes** exist to address this).

When one TCP connection carries **multiple independent streams** (HTTP/2 multiplexing many requests), a lost packet belonging to one stream stalls **all** streams — the key motivation for QUIC, which delivers streams independently ([HTTP/3 & QUIC](lesson:cn-http3-quic)).

:::depth{level=advanced}
### Spurious retransmissions and timeouts in the tail

A delay spike (e.g., a Wi-Fi retry burst or a GC-paused receiver) can exceed the RTO, triggering a retransmission of data that wasn't lost. Detection (F-RTO, Eifel, DSACK — the receiver reporting duplicate data) lets the sender undo the congestion-window reduction. From an application's perspective, an RTO costs at least 200 ms (Linux minimum) and backs off exponentially — which is why a 0.1% loss rate can move p99 latency from 20 ms to 220+ ms ([Tail Latency](lesson:cn-tail-latency)).
:::

## Example

```bash
$ ss -ti dst 10.0.2.9
  cubic wscale:7,7 rto:204 rtt:3.2/1.1 ato:40 mss:1448 cwnd:10 bytes_acked:92810 retrans:0/3 ...
$ nstat -az TcpRetransSegs TcpExtTCPFastRetrans TcpExtTCPTimeouts
TcpRetransSegs        1834
TcpExtTCPFastRetrans   1612
TcpExtTCPTimeouts        97
```

Mostly fast retransmits (good — repaired within an RTT); timeouts are the expensive ones for latency.

## Complexity & Performance

- Fast retransmit repairs loss in ~1 RTT; an RTO costs ≥ 200 ms (Linux) and doubles on repeat.
- SACK reduces recovery from several RTTs to about one when multiple segments are lost.
- Throughput also drops because loss triggers congestion-window reduction ([Congestion Control](lesson:cn-tcp-congestion-control)).

## Trade-offs

- Aggressive retransmission (short RTO): faster recovery vs spurious retransmissions.
- In-order byte stream: simple application semantics vs head-of-line blocking.
- Delayed ACKs: fewer packets vs added latency in some patterns.

## Failure Modes

- Tail loss at the end of responses causing RTO-length stalls.
- Nagle + delayed ACK 40 ms stalls.
- Persistent packet loss (bad link, overloaded middlebox) inflating tail latency long before throughput looks bad.
- Connections hanging for ~15–30 minutes when the peer disappears mid-transfer (retries with backoff up to `tcp_retries2`) — use `TCP_USER_TIMEOUT` or application timeouts.

## In Production

- Monitor retransmission rate (> ~1% is usually a problem worth investigating) and RTO counts per host/zone.
- `tcpretrans` (eBPF) shows each retransmission with its 4-tuple — find the bad link or the overloaded peer.
- Case study: [Packet Loss and P99](case:packet-loss).

## Deeper Connections

- The same window structure drives flow control ([Flow Control](lesson:cn-tcp-flow-control)); loss signals drive congestion control ([Congestion Control](lesson:cn-tcp-congestion-control)).
- HOL blocking at the transport layer motivates HTTP/2's limits and HTTP/3's design ([HTTP/2](lesson:cn-http2)).

## Common Misconceptions

- **"TCP retransmits only after a timeout."** Most losses are repaired by fast retransmit/SACK well before any timeout.
- **"The receiver ACKs every packet individually."** ACKs are cumulative and often delayed.
- **"Lost packets only reduce throughput."** They add latency in ~RTT or RTO chunks — a tail-latency problem.

## Interview Questions

### [L1 · conceptual] How does TCP detect lost packets?

Two ways: a retransmission timer (if no ACK arrives within the RTO, the oldest unacknowledged segment is resent) and duplicate ACKs (three duplicate ACKs indicate a segment was likely lost while later ones arrived, triggering fast retransmit). With SACK, the receiver also reports exactly which blocks it has.

### [L2 · how] How is the TCP retransmission timeout calculated?

From RTT measurements: a smoothed RTT (EWMA with gain 1/8) and RTT variance (gain 1/4); RTO = SRTT + 4 × RTTVAR, with a minimum bound (200 ms on Linux) and exponential backoff on repeated timeouts. Samples from retransmitted segments are excluded (Karn's algorithm) unless timestamps disambiguate them.

### [L2 · why] Why does fast retransmit wait for three duplicate ACKs rather than one?

Duplicate ACKs are also caused by reordering, which is common on multipath networks. One or two duplicates often mean a segment was merely late; three is a heuristic threshold that makes loss much more likely, avoiding spurious retransmissions.

### [L3 · conceptual] What is head-of-line blocking in TCP and why does it matter for HTTP/2?

TCP delivers bytes strictly in order, so when a segment is lost, all later segments — even if received — wait in the receiver's buffer until the retransmission arrives. HTTP/2 multiplexes many independent streams over one TCP connection, so a single lost packet stalls every stream, not just the one it belonged to. QUIC solves it by providing independent streams with separate ordering.

### [L3 · numerical] SRTT = 80 ms, RTTVAR = 30 ms. What is the RTO before minimum clamping? What happens after two consecutive timeouts?

RTO = 80 + 4 × 30 = **200 ms**. After the first timeout it doubles to 400 ms, after the second to 800 ms (exponential backoff).

### [L4 · incident] A service shows normal p50 latency but p99 jumped from 30 ms to 250 ms after a network change; throughput is unchanged. How would you investigate?

The jump to ~200+ ms at p99 matches TCP's minimum RTO: some requests are hitting retransmission timeouts. Check retransmit and timeout counters (`nstat`, `ss -ti`, `tcpretrans`) by host and path, look for packet loss introduced by the change (MTU mismatch dropping large packets, a lossy link, overloaded load balancer or firewall, buffer tuning), and verify tail loss probes/SACK are enabled. Confirm with packet captures showing retransmissions for slow requests.

## Practice

### [numeric 200] SRTT = 80 ms, RTTVAR = 30 ms. Compute RTO = SRTT + 4·RTTVAR in ms.

:::answer
80 + 120 = **200 ms**.
:::

### [mcq] Segments with seq 1, 1001, 2001, 3001 (1,000 bytes each) are sent; 1001 is lost; the rest arrive. What ACK does the receiver send when 3001 arrives?

- [ ] 4001
- [ ] 3001
- [x] 1001
- [ ] 2001

Cumulative ACK: still waiting for byte 1001 — a duplicate ACK.

## Quick Revision

- Cumulative ACK = next byte expected; sender keeps unacked data for retransmission.
- **RTO** = SRTT + 4·RTTVAR (Linux min 200 ms), exponential backoff; Karn's algorithm / timestamps for samples.
- **3 dup ACKs → fast retransmit** (~1 RTT) vs timeout (≥ 200 ms).
- **SACK** reports received blocks → retransmit only gaps.
- Delayed ACK (~40 ms) + Nagle → stalls → TCP_NODELAY.
- **HOL blocking**: one lost segment stalls all later bytes (and all HTTP/2 streams) → QUIC.
