---
title: "Half a Million WebSockets Reconnecting at Once"
subject: cn
summary: "A routine gateway deploy closed 500,000 WebSocket connections within seconds. Every client reconnected immediately, and the storm of TCP+TLS handshakes and auth calls overloaded the gateways and the session service for 25 minutes."
difficulty: 4
concepts: [cn-realtime, cn-proxies-load-balancers, cn-tls-handshake, x-overloaded-server, x-connection-management]
tags: [websocket, reconnect storm, thundering herd, jitter, exponential backoff, connection draining, tls resumption, load balancer]
order: 33
---

## Context

A chat product keeps ~500,000 concurrent WebSocket connections across 20 gateway instances behind an L4 load balancer. On connect, each client performs TLS, an HTTP upgrade, and an auth check against the session service, then subscribes to its channels. Client reconnect logic: "on close, reconnect after 1 second".

## Symptoms

- A deploy restarts gateways in batches of 5.
- Within seconds, connection counts on remaining gateways spike; CPU hits 100%; handshakes time out.
- Clients show "Reconnecting…" for up to 25 minutes; the session service's error rate hits 60%.

## Metrics

| Metric | Normal | Storm |
|---|---|---|
| New connections/s | ~200 | 120,000 (peak) |
| Gateway CPU (TLS handshakes) | 25% | 100% |
| Session service RPS | 300 | 90,000 attempted |
| Median time to reconnect | 1 s | 9 min |

## Hypotheses

1. Synchronized reconnects (thundering herd) → client code reconnects after a fixed 1 s.
2. Gateways under-provisioned for steady state → steady-state CPU was 25%.
3. Session service failure → it failed *because of* the storm (secondary).

## Investigation

- Restarting 5 of 20 gateways dropped 125,000 connections at once. All clients retried after exactly 1 s: 125,000 simultaneous TLS handshakes (asymmetric crypto on the server side — [TLS Handshake](lesson:cn-tls-handshake)) and 125,000 auth calls.
- Handshakes that didn't finish within the client's 5 s timeout were abandoned and retried — work thrown away, load sustained.
- The L4 load balancer spread reconnections by connection count, piling onto the 15 remaining gateways, which then also saturated; when restarted gateways came back empty, clients kept retrying on a fixed schedule — the storm persisted after the deploy ended (metastable overload — [Overloaded Server](lesson:x-overloaded-server)).

## Root Cause

Synchronized client retries (fixed delay, no jitter) and abrupt connection termination during deploys created a reconnection herd whose handshake and auth costs exceeded gateway and session-service capacity; timeouts and retries kept the system overloaded.

## Fix

1. Client: exponential backoff with full jitter (random 0 … min(cap, base × 2ⁿ)), plus server-provided "retry-after" hints in close frames.
2. Deploys: connection draining — gateways stop accepting new connections and close existing ones gradually over ~10 minutes (spreading reconnects), with a close code telling clients to reconnect at a random offset.
3. TLS session resumption (tickets) so most reconnects avoid full handshakes; auth tokens validated locally (signed tokens) instead of calling the session service on every connect.
4. Admission control on gateways: cap concurrent handshakes; reject with a retry hint.

## Prevention

- Every client retry loop needs backoff + jitter + a cap.
- Load test the deploy itself (disconnect/reconnect at scale), not only steady state.
- Capacity plan for reconnection rate, not just concurrent connections ([Realtime Transports](lesson:cn-realtime)).

## Interview Angle

Tests awareness that long-lived connections turn deploys and failovers into herds. Discuss jittered backoff, graceful draining, handshake costs (TLS asymmetric crypto, auth), admission control and why the storm can outlive its trigger. Relate to connection management in general ([Connection Management](lesson:x-connection-management)).
