---
title: "0.5% Packet Loss, 40× Tail Latency"
subject: cn
summary: "A degraded top-of-rack switch port dropped 0.5% of packets. Averages barely moved, but requests hitting a lost segment paid a 200 ms retransmission timeout — and with 30 backend calls per page, most page loads did."
difficulty: 4
concepts: [cn-tcp-reliability, cn-tail-latency, cn-tcp-congestion-control, cn-latency-bandwidth, cn-ip-packet-icmp]
tags: [packet loss, retransmission timeout, rto, tail latency, fan out, ss, mtr, tcp retransmits]
order: 30
---

## Context

A product page is assembled by an aggregator that calls ~30 backend services in parallel inside one datacenter (RTT ~0.3 ms). Normal backend call latency: p50 2 ms, p99 8 ms. Page p99: ~40 ms.

## Symptoms

- Page p99 jumps from 40 ms to ~260 ms; p50 almost unchanged (from 12 ms to 14 ms).
- Only traffic touching hosts in one rack is affected (discovered later).
- No errors — just slowness in the tail.

## Metrics

| Metric | Normal | Incident |
|---|---|---|
| Backend call p50 / p99 | 2 ms / 8 ms | 2 ms / 210 ms |
| TCP retransmission rate (`netstat -s`, node exporter) | 0.001% | 0.5% on rack-12 hosts |
| Switch port error counters (rack 12 uplink) | 0 | CRC errors climbing |
| Page p99 | 40 ms | 260 ms |

## Hypotheses

1. A slow backend service → per-service latencies all show the same tail shape.
2. Garbage collection pauses → none correlated.
3. Network packet loss causing retransmission timeouts → the ~200 ms tail matches Linux's minimum RTO.

## Investigation

- `ss -ti` on aggregator hosts: connections to rack-12 hosts show `retrans:` counters and `rto:204`.
- `mtr` to rack-12 hosts: ~0.5% loss starting at the ToR switch hop.
- Why 200 ms? A small request/response (one or two segments) that loses a segment has no later segments to trigger **fast retransmit** via duplicate ACKs, so recovery waits for the retransmission timeout — at least 200 ms on Linux, ~600× the RTT ([TCP Reliability](lesson:cn-tcp-reliability)).
- Why the page p99 exploded while backend p99 moved less dramatically: with 30 parallel calls, the page is as slow as its slowest call. P(at least one of 30 calls hits a loss) ≈ 1 − (1 − p)^30. With ~2 packets per call exchange at 0.5% loss, p ≈ 1% per call → 1 − 0.99^30 ≈ 26% of pages paid ≥ 200 ms ([Tail Latency](lesson:cn-tail-latency)).

## Root Cause

A faulty switch port (CRC errors from a degrading optic) dropped ~0.5% of packets. Short RPC exchanges recovered only via TCP's 200 ms minimum retransmission timeout, and parallel fan-out amplified per-call tail probability into page-level latency.

## Fix

1. Drained rack 12 from load balancers; replaced the optic; loss returned to 0.
2. Enabled hedged requests for idempotent backend calls: if no response by the call's p95 (~6 ms), send a duplicate to another replica and take the first answer.

## Prevention

- Alert on TCP retransmission rate per host/rack and on switch interface errors.
- Track p99/p99.9, not just averages; model fan-out tail amplification in SLOs.
- For latency-critical internal RPCs, consider lower minimum RTO settings (route-level `rto_min`) and hedging.

## Interview Angle

Great for "why is p99 bad when p50 is fine?". Explain RTO vs fast retransmit (why small messages suffer most), compute fan-out tail amplification, and name the tools (ss, netstat -s, mtr, interface counters). Mention that loss also shrinks congestion windows, hurting bulk throughput ([Congestion Control](lesson:cn-tcp-congestion-control)).
