---
title: "Latency, Bandwidth, Throughput and the Bandwidth-Delay Product"
subject: cn
level: 10
order: 1
summary: "The four components of delay, why bandwidth and latency are different resources, transfer-time and BDP calculations, TCP's window and loss limits, and back-of-the-envelope numbers engineers use."
depth: core
difficulty: 3
minutes: 40
relevance: high
stage: 3
prerequisites: [cn-tcp-congestion-control]
related: [cn-tail-latency, cn-tcp-flow-control, cn-cdn, cn-mtu-congestion, os-hardware-model]
labs: [network-calculator]
tags: [latency, bandwidth, throughput, rtt, bandwidth-delay product, bdp, propagation delay, transmission delay, queueing delay, processing delay, jitter, packet loss, goodput, mathis formula]
---

## Mental Model

A network path is a **pipe**:

- **Bandwidth** is the pipe's **width** — how many bits per second can enter it.
- **Latency** is the pipe's **length** — how long a bit takes to travel from one end to the other.
- The **bandwidth-delay product** is the pipe's **volume** — how much data is "in flight" inside it when it's full.

A wider pipe doesn't make the first drop arrive sooner; for small transfers (most web requests), **latency dominates**. For large transfers, you need enough data in flight (a big enough TCP window) to fill the pipe's volume — or the width goes unused.

## Definition

- **Latency** (one-way delay) and **RTT** (round-trip time): time for a bit/packet to go one way / there and back.
- **Bandwidth (capacity)**: the maximum bit rate of a link or path (bits per second).
- **Throughput**: the rate actually achieved; **goodput**: useful application data rate (excluding headers, retransmissions).
- **Jitter**: variation in latency between packets.
- **Packet loss**: fraction of packets that don't arrive.
- **BDP** = bandwidth × RTT: bytes that must be in flight to keep the path full.

## Why It Exists

Engineers constantly face questions like "why is this upload slow on a gigabit link?", "how much will a CDN help?", "should we batch these calls?" — all answered with a few formulas and realistic numbers.

## How It Works

### Four components of delay per hop

| Component | Formula / cause | Typical magnitude |
|---|---|---|
| **Propagation** | distance / signal speed (~200,000 km/s in fiber ≈ 5 µs per km) | 1,000 km → 5 ms one way |
| **Transmission (serialization)** | packet size / link rate | 1,500 B at 1 Gb/s = 12 µs; at 10 Mb/s = 1.2 ms |
| **Queueing** | waiting behind other packets in buffers | 0 to hundreds of ms (congestion, bufferbloat) |
| **Processing** | header parsing, lookups, encryption | ns–µs |

Propagation sets an unbreakable floor: New York ↔ London ≈ 5,600 km great-circle → ≥ 28 ms one way, ≥ 56 ms RTT (real paths ~70 ms). Only moving closer (CDNs, regional deployments) reduces it.

### Transfer time

```text
time ≈ connection setup RTTs + (size / bandwidth) + (round trips during transfer × RTT)
```

**Example**: download 10 MB over 100 Mb/s with RTT 50 ms, new HTTPS connection:

- Setup: TCP (1 RTT) + TLS 1.3 (1 RTT) + request (1 RTT) = 150 ms.
- Serialization: 10 MB × 8 / 100 Mb/s = 0.8 s.
- Slow start overhead: several extra RTTs before cwnd reaches the BDP (~0.2–0.3 s here).
- **Total ≈ 1.2 s.**

Same file on a 1 Gb/s link: serialization drops to 0.08 s, but setup + slow start still cost ~0.4 s → **the 10× faster link gives only ~2.5× speedup**. For a 20 KB web API response, bandwidth is irrelevant; RTTs are everything.

### Bandwidth-delay product

```text
BDP (bytes) = bandwidth (bits/s) × RTT (s) / 8
```

- 100 Mb/s × 50 ms = 625 KB.
- 1 Gb/s × 80 ms = 10 MB.
- 10 Gb/s × 100 ms = 125 MB.

TCP needs `min(cwnd, rwnd) ≥ BDP` to fill the path; otherwise **throughput ≤ window / RTT** ([Flow Control](lesson:cn-tcp-flow-control)).

### Loss-limited TCP throughput (Mathis et al.)

```text
throughput ≲ (MSS / RTT) × (1.22 / √p)
```

With MSS = 1,460 B, RTT = 100 ms, p = 0.1% (10⁻³): (11,680 bits / 0.1 s) × (1.22 / 0.0316) ≈ 116.8 kb/s × 38.6 ≈ **4.5 Mb/s** — on any link speed. Long-distance bulk transfer is highly sensitive to loss; solutions: reduce RTT (move data closer), reduce loss, parallel streams, BBR-style congestion control ([Congestion Control](lesson:cn-tcp-congestion-control)).

::lab{id=network-calculator}

## Internal Mechanism

### Numbers worth memorizing (order of magnitude)

| Path | RTT |
|---|---|
| Same host (loopback) | ~10–50 µs |
| Same data center / availability zone | ~0.1–0.5 ms |
| Across availability zones in a region | ~0.5–2 ms |
| Across a continent (US coast to coast) | ~60–80 ms |
| Transatlantic | ~70–90 ms |
| US ↔ Asia / Australia | ~150–250 ms |
| 4G mobile last mile | ~30–60 ms (+ variability) |
| Geostationary satellite | ~600 ms; LEO constellations ~25–60 ms |

:::depth{level=advanced}
### Latency compounds in microservices

A request that calls 5 services **sequentially**, each 1 ms away with 5 ms of processing, costs ~30 ms; the same calls across regions (80 ms RTT each) cost ~425 ms. Chatty call graphs, N+1 remote calls, and cross-region synchronous dependencies are the usual latency killers. Fixes: parallelize independent calls, batch, cache, co-locate services and data, and avoid synchronous cross-region calls on the request path.
:::

## Example

"Why does our nightly backup from the EU to the US region take 9 hours for 2 TB?"

- 2 TB in 9 h ≈ 494 Mb/s effective on a 10 Gb/s link.
- RTT 90 ms; BDP at 10 Gb/s ≈ 112 MB — default socket buffer limits (e.g., 6 MB max) cap one stream at ~6 MB / 0.09 s ≈ 530 Mb/s.
- Fixes: raise `tcp_rmem`/`tcp_wmem` max, use multiple parallel streams, BBR, or copy via the cloud provider's backbone tooling.

## Complexity & Performance

- Small transfers: latency-bound → minimize round trips (connection reuse, fewer sequential calls, CDNs, HTTP/2/3, 0-RTT).
- Large transfers: bandwidth- or window/loss-bound → tune windows, reduce loss, parallelize.

## Trade-offs

- Batching: fewer round trips and higher throughput vs higher per-item latency.
- Moving computation to data (or data to users) vs replication cost and consistency ([Replication](lesson:db-replication)).

## Failure Modes

- Assuming bandwidth upgrades fix latency problems.
- Window-limited transfers on long fat networks.
- Hidden serialized round trips (DNS + TCP + TLS + redirects + N+1 API calls).
- Jitter-sensitive applications (voice/video, games) suffering from queueing variance even when average latency is fine.

## In Production

- Measure with `ping`/`mtr` (RTT, loss), `iperf3` (throughput, with `-P` for parallel streams), `ss -ti` (per-connection cwnd/RTT), and RUM data for real users.
- Put latency budgets on request paths (e.g., 200 ms p95: 20 ms network, 50 ms DB, …).

## Deeper Connections

- Tail percentiles and their amplification: [Tail Latency](lesson:cn-tail-latency). Hardware latency numbers: [Hardware Model](lesson:os-hardware-model). CDNs cut propagation: [CDN](lesson:cn-cdn).

## Common Misconceptions

- **"Bandwidth is speed."** Bandwidth is capacity; latency is speed of arrival. A 1 Gb/s link with 200 ms RTT feels slower than a 50 Mb/s link with 10 ms RTT for web browsing.
- **"Throughput = bandwidth."** Throughput is limited by windows, loss, congestion and the slowest link.
- **"Latency can be engineered away."** Propagation delay is physics.

## Interview Questions

### [L1 · compare] What's the difference between latency and bandwidth?

Latency is the time it takes data to travel from source to destination (or RTT for a round trip); bandwidth is the maximum rate at which data can be sent. Latency dominates small transfers and interactive applications; bandwidth dominates large bulk transfers.

### [L2 · numerical] What is the bandwidth-delay product for a 1 Gb/s link with 80 ms RTT, and why does it matter?

10⁹ × 0.08 / 8 = **10 MB**. That much data must be in flight (TCP window) to keep the link fully utilized; with a smaller window, throughput is limited to window/RTT.

### [L2 · numerical] How long does it take to transmit a 1,500-byte packet on a 10 Mb/s link, and how long does it take to propagate 2,000 km of fiber?

Transmission: 12,000 bits / 10⁷ b/s = **1.2 ms**. Propagation: 2,000 km × 5 µs/km = **10 ms**.

### [L3 · numerical] A TCP flow has RTT 100 ms, MSS 1,460 B and 0.1% loss. Estimate its maximum throughput with the Mathis formula.

(1,460 × 8 / 0.1) × 1.22 / √0.001 ≈ 116,800 × 38.6 ≈ **4.5 Mb/s**.

### [L3 · scenario] Upgrading a client office link from 100 Mb/s to 1 Gb/s didn't make a SaaS web app feel faster. Why?

The app's page loads are dominated by latency: DNS, TCP and TLS handshakes, and many sequential request round trips to a distant data center, each costing an RTT; responses are small, so serialization time was already negligible. Improvements must reduce RTTs or round-trip counts (CDN/edge, HTTP/2 or 3, fewer sequential requests, caching).

## Practice

### [numeric 625 ±5 unit=KB] BDP of a 100 Mb/s path with 50 ms RTT, in KB (1 KB = 1,000 bytes)?

:::answer
10⁸ × 0.05 / 8 = 625,000 bytes = **625 KB**.
:::

### [numeric 0.8 ±0.01 unit=s] Serialization time for 10 MB (10⁷ bytes) at 100 Mb/s, in seconds?

:::answer
8 × 10⁷ bits / 10⁸ b/s = **0.8 s**.
:::

### [numeric 4.5 ±0.3 unit=Mb/s] Mathis estimate: MSS 1,460 B, RTT 100 ms, loss 0.1%. Throughput in Mb/s?

:::answer
116,800 b/s × 1.22 / 0.03162 ≈ 4.51 Mb/s ≈ **4.5 Mb/s**.
:::

## Quick Revision

- Delay = propagation (~5 µs/km) + transmission (size/rate) + queueing + processing.
- Bandwidth = width; latency = length; **BDP = bandwidth × RTT** = bytes in flight needed.
- Throughput ≤ window/RTT; loss-limited ≈ (MSS/RTT)·1.22/√p.
- Small transfers are RTT-bound; big transfers window/loss-bound.
- Know RTTs: DC ~0.5 ms, cross-AZ ~1 ms, cross-continent ~70 ms, intercontinental 70–250 ms.
