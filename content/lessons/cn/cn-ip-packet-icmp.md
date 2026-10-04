---
title: "Inside the IP Packet: TTL, Fragmentation, ICMP, ping and traceroute"
subject: cn
level: 3
order: 5
summary: "The IPv4 header field by field, why TTL exists, how fragmentation works (and why it's avoided), ICMP's error and diagnostic messages, and exactly how ping and traceroute work."
depth: core
difficulty: 3
minutes: 30
relevance: medium
stage: 2
prerequisites: [cn-routing]
related: [cn-mtu-congestion, cn-routing, cn-ipv6, cn-udp]
visualizations: [routing]
tags: [ip header, ttl, fragmentation, df bit, icmp, ping, traceroute, destination unreachable, time exceeded, path mtu discovery, checksum]
---

## Mental Model

The IP header is the **shipping label**: who it's from, who it's for, how many more hops it may take before being thrown away (**TTL**), what's inside (TCP? UDP?), and — if the parcel was too big for a truck — how to reassemble the pieces.

**ICMP** is the postal service's **return-to-sender notices**: "address unknown", "this parcel expired in transit", "parcel too big and you said don't split it". `ping` and `traceroute` are clever abuses of these notices to probe the network.

## Definition

- **IPv4 header**: 20-byte (minimum) header carrying version, header length, DSCP/ECN, total length, identification/flags/fragment offset, **TTL**, protocol, header checksum, source and destination addresses (and optional options).
- **TTL (time to live)**: hop limit decremented by every router; at 0 the packet is dropped and an ICMP Time Exceeded is sent. (IPv6 calls it Hop Limit.)
- **Fragmentation**: splitting a packet larger than a link's MTU into pieces reassembled at the destination.
- **ICMP (Internet Control Message Protocol)**: IP's error-reporting and diagnostic protocol (echo request/reply, destination unreachable, time exceeded, fragmentation needed, redirect).

## Why It Exists

**The problem.** IP is "best effort": routers forward packets without tracking them. That simplicity creates three gaps, and each header feature fills one:

- **Loops.** If two routers misconfigure each other as next hops, a packet could bounce forever, eating bandwidth. TTL prevents routing loops from circulating packets forever.
- **Different link sizes.** Links have different maximum sizes; a packet that fits one may not fit the next. Fragmentation lets IP cross links with different MTUs.
- **Silent failures.** When a router drops a packet, the sender otherwise never knows why. ICMP gives hosts feedback — without it, every failure would look like a silent timeout.

:::callout[That's all it is]{type=insight}
The IP header is a label with addresses, a hop counter that kills looping packets, and pieces for reassembly. ICMP is the network's way of sending back error notes — and `ping` and `traceroute` are clever uses of those notes.
:::

## How It Works

### IPv4 header fields that matter

| Field | Size | Purpose |
|---|---|---|
| Version / IHL | 4 + 4 bits | IPv4; header length (usually 5 words = 20 B) |
| DSCP / ECN | 6 + 2 bits | QoS marking; Explicit Congestion Notification ([Congestion Control](lesson:cn-tcp-congestion-control)) |
| Total length | 16 bits | Header + payload (max 65,535) |
| Identification, flags (DF, MF), fragment offset | 16 + 3 + 13 bits | Fragmentation and reassembly |
| TTL | 8 bits | Hop limit (commonly initialized to 64, 128 or 255) |
| Protocol | 8 bits | 6 = TCP, 17 = UDP, 1 = ICMP |
| Header checksum | 16 bits | Header integrity (recomputed at each hop since TTL changes) |
| Source / destination | 32 + 32 bits | Addresses |

### Fragmentation

If a packet is too big for the next link, the router has two choices: drop it or cut it up. IPv4 allowed cutting. A 4,000-byte IPv4 packet (20-byte header + 3,980 data) meets a link with MTU 1,500:

- Each fragment carries ≤ 1,480 data bytes (a multiple of 8), with the same Identification, the MF (more fragments) flag set on all but the last, and an offset in 8-byte units.
- Fragments: data 0–1479 (offset 0), 1480–2959 (offset 185), 2960–3979 (offset 370, MF=0).
- Only the **destination** reassembles.

Why it's avoided: loss of any fragment loses the whole packet (amplifying loss), reassembly costs memory and is an attack surface, middleboxes can't see ports in non-first fragments, and fragments often get dropped by firewalls. Modern TCP avoids fragmentation using **Path MTU Discovery**: send with **DF (don't fragment)** set; if a router can't forward without fragmenting, it drops the packet and returns ICMP "Fragmentation Needed" with the next-hop MTU; the sender lowers its packet size. IPv6 routers never fragment at all ([MTU & Network Bottlenecks](lesson:cn-mtu-congestion)).

### ICMP messages

| Type | Name | When |
|---|---|---|
| 8 / 0 | Echo request / reply | `ping` |
| 3 | Destination unreachable (codes: network, host, **port**, fragmentation needed, administratively prohibited) | No route, host down, UDP port closed, DF packet too big, firewall reject |
| 11 | Time exceeded | TTL reached 0 in transit (or reassembly timeout) |
| 5 | Redirect | A better next hop exists on the same link |

### How ping works

Send ICMP Echo Requests; the target's kernel replies with Echo Replies; ping reports round-trip time and loss:

```bash
$ ping -c 3 example.com
64 bytes from 93.184.215.14: icmp_seq=1 ttl=56 time=23.1 ms
```

The reply's TTL (56) hints the remote OS started at 64 and the packet crossed 8 hops.

### How traceroute works

Routers don't tell you the path — but every router *does* send an error when a packet's TTL runs out on it. So make packets run out on purpose, one hop further each time. Send probes with **TTL = 1, 2, 3, …**. The router where TTL hits 0 drops the probe and returns **ICMP Time Exceeded**, revealing its address and the round-trip time to it. When a probe finally reaches the destination, it answers differently (ICMP Port Unreachable for UDP probes to a high port, an Echo Reply, or a TCP SYN-ACK/RST for TCP traceroute) — so traceroute knows it's done.

```text
TTL=1 → router A: "time exceeded"   → hop 1 = A
TTL=2 → router B: "time exceeded"   → hop 2 = B
TTL=3 → destination: "port unreachable" → done
```

Caveats: `* * *` means a router didn't reply (rate-limited or filtered ICMP) — not necessarily loss; per-hop RTTs include the router's (low-priority) ICMP generation time; different probes can take different ECMP paths.

::viz{id=routing}

## Internal Mechanism

:::depth{level=advanced}
### Don't block all ICMP

Blocking ICMP wholesale "for security" breaks Path MTU Discovery (connections hang when large packets are silently dropped — the classic "PMTU black hole": the TCP handshake works, small requests work, large responses stall), hides unreachable errors (turning fast failures into long timeouts), and breaks diagnostics. Allow at least type 3 code 4 (fragmentation needed) for IPv4 and ICMPv6 Packet Too Big, and rate-limit rather than drop echo.
:::

## Example

Diagnosing latency with `mtr` (continuous traceroute + ping):

```text
Host                 Loss%   Snt   Avg  Best  Wrst
1. 192.168.1.1        0.0%   100   1.2   0.9   3.1
2. 100.64.0.1         0.0%   100   8.9   7.8  25.0
3. 203.0.113.9       40.0%   100  10.4   9.8  12.0   ← loss here only?
4. 198.51.100.21      0.0%   100  12.1  11.0  15.3
...
9. 93.184.215.14      0.0%   100  23.6  22.9  30.2
```

Loss at hop 3 that doesn't continue to later hops is **ICMP rate limiting** on that router, not real loss. Real loss shows up at a hop *and every hop after it*.

## Complexity & Performance

- Header processing per hop is minimal; the TTL decrement forces a checksum update (incremental in hardware).
- Fragmentation costs CPU/memory at the receiver and multiplies loss impact.

## Trade-offs

- Fragmentation keeps packets deliverable across MTU changes vs efficiency and reliability costs → PMTUD preferred.
- ICMP visibility vs reconnaissance concerns → rate-limit, don't blanket-block.

## Failure Modes

- PMTU black holes when ICMP "fragmentation needed" is filtered.
- Routing loops visible as TTL-exceeded messages from repeating hops.
- Misinterpreting traceroute `*` or mid-path loss.
- Fragment-based attacks (overlapping fragments, reassembly exhaustion) — why many firewalls drop fragments.

## In Production

- Cloud security groups often block ICMP by default — ping failing doesn't mean the host is down; test the actual port (`nc -vz`).
- Kubernetes/VPN overlays lower the MTU; misconfigured pods show "handshake works, big responses hang".

## Deeper Connections

- MTU, MSS clamping and PMTUD in depth: [MTU & Network Bottlenecks](lesson:cn-mtu-congestion).
- ECN bits let routers signal congestion without dropping packets ([Congestion Control](lesson:cn-tcp-congestion-control)).

## Common Misconceptions

- **"If ping fails, the host is down."** ICMP may be filtered while services work fine.
- **"Traceroute shows the exact path your traffic takes."** It shows the path of its probes; ECMP and asymmetric return paths can differ.
- **"TTL is a time in seconds."** In practice it's a hop count.

## Interview Questions

### [L1 · conceptual] What is TTL and why does it exist?

A field in the IP header that each router decrements by one; when it reaches zero, the router drops the packet and sends an ICMP Time Exceeded message. It prevents packets from circulating forever in routing loops.

### [L2 · how] How does traceroute work?

It sends packets with increasing TTLs (1, 2, 3…). Each router where the TTL expires drops the packet and replies with ICMP Time Exceeded, revealing that hop's address and RTT. When the probe reaches the destination, the destination responds (port unreachable, echo reply, or TCP response), ending the trace.

### [L2 · how] What is Path MTU Discovery?

Senders set the Don't Fragment bit; if a packet exceeds a link's MTU, the router drops it and returns ICMP "Fragmentation Needed" (IPv6: Packet Too Big) with the next-hop MTU. The sender reduces its packet size for that destination. It avoids fragmentation but depends on ICMP not being blocked.

### [L3 · debugging] Users on a new VPN can open web pages that are small, but large downloads hang forever after the TCP handshake. What's likely wrong?

A PMTU black hole: the VPN adds encapsulation overhead so the path MTU is smaller than 1,500, but ICMP "fragmentation needed" messages are blocked, so senders keep sending full-size DF packets that are silently dropped. Fix by allowing the ICMP messages, clamping TCP MSS on the VPN gateway, or lowering the interface MTU.

### [L3 · diagram] In an mtr report, hop 4 shows 30% loss but hops 5–10 and the destination show 0% loss. Is there packet loss on the path?

No real loss: loss that doesn't propagate to subsequent hops is the hop's router rate-limiting or deprioritizing ICMP responses to itself, while forwarding transit traffic normally. Real loss appears at a hop and persists to the destination.

## Practice

### [numeric 3] How many fragments result from sending an IPv4 packet with 3,980 bytes of payload (20-byte header) over a link with MTU 1,500?

:::answer
Each fragment carries up to 1,480 data bytes (multiple of 8): 1,480 + 1,480 + 1,020 = 3,980 → **3 fragments**.
:::

### [mcq] Which ICMP message does traceroute rely on from intermediate routers?

- [ ] Echo Reply
- [x] Time Exceeded
- [ ] Redirect
- [ ] Source Quench

Routers return Time Exceeded when TTL hits zero.

## Quick Revision

- IPv4 header: addresses, TTL, protocol (6 TCP, 17 UDP, 1 ICMP), length, fragmentation fields, checksum, DSCP/ECN.
- TTL decremented per hop; 0 → drop + ICMP Time Exceeded.
- Fragmentation (data in 8-byte units, reassembled at destination) is avoided via DF + **PMTUD**; IPv6 routers never fragment.
- ICMP: echo (ping), unreachable (incl. fragmentation needed), time exceeded (traceroute).
- Don't block all ICMP → PMTU black holes. Mid-path mtr loss that doesn't persist = rate limiting.
