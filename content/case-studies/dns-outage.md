---
title: "When DNS Went Down, Everything Went Down"
subject: cn
summary: "An overloaded internal DNS resolver started timing out. Every service that resolved names per connection stalled for 5 seconds per lookup, retries tripled the query rate, and a platform-wide outage followed. Node-local caching and sane client behavior fixed it."
difficulty: 3
concepts: [cn-dns-fundamentals, cn-dns-records, cn-service-networking, x-overloaded-server, x-connection-management]
tags: [dns outage, resolver overload, timeouts, retries, negative caching, ttl, node local dns cache, kubernetes ndots]
order: 31
---

## Context

A Kubernetes platform with ~400 services. Pods resolve names via the cluster DNS (CoreDNS, 4 replicas), which forwards external names to cloud resolvers. Many services open a new HTTP connection per outbound request (no keep-alive), resolving the target name each time.

## Symptoms

- 11:40: error rates rise across dozens of unrelated services: `getaddrinfo EAI_AGAIN`, `i/o timeout`.
- Latency of many calls jumps by exactly ~5 s (or 10 s).
- The cloud provider reports no incident.

## Metrics

| Metric | Normal | Incident |
|---|---|---|
| CoreDNS queries/s | 25,000 | 90,000 |
| CoreDNS CPU | 40% | 100% (throttled at limit) |
| DNS response latency p99 | 2 ms | > 5 s (timeouts) |
| NXDOMAIN share of responses | 60% | 72% |

## Hypotheses

1. CoreDNS capacity exhausted → matches CPU.
2. Upstream resolver failure → upstream latency fine.
3. A new client flooding DNS → a batch job deployed at 11:35.

## Investigation

- The new batch job made ~5,000 outbound calls/s to `api.partner.com`, each with a fresh DNS lookup.
- Kubernetes' default `ndots:5` makes the resolver try search domains first: `api.partner.com.batch.svc.cluster.local`, `api.partner.com.svc.cluster.local`, `api.partner.com.cluster.local`, … — for A and AAAA — before the real name. Each lookup became ~8 queries, mostly NXDOMAIN (explaining the NXDOMAIN share).
- CoreDNS saturated; glibc's resolver timeout is 5 s with retries, so every service's lookups started waiting 5–10 s ([DNS](lesson:cn-dns-fundamentals)).
- Timeouts caused application retries, multiplying queries further — a classic overload feedback loop ([Overloaded Server](lesson:x-overloaded-server)).

## Root Cause

A shared, under-provisioned dependency (cluster DNS) was overwhelmed by a query storm from one client, amplified by search-domain expansion (ndots) and per-request resolution without caching or connection reuse. Because nearly every service depends on DNS, the failure became platform-wide.

## Fix

1. Scaled CoreDNS and paused the batch job; errors cleared within minutes.
2. Deployed NodeLocal DNSCache (per-node caching resolver) → most lookups answered locally.
3. Used fully qualified names (trailing dot: `api.partner.com.`) or `ndots:1` for external targets.
4. Batch job: HTTP keep-alive and a connection pool → a handful of lookups per minute instead of thousands per second ([Connection Management](lesson:x-connection-management)).

## Prevention

- Treat DNS as critical infrastructure: capacity alerts, per-client rate visibility.
- Client hygiene: connection reuse, respect TTLs, cache, bounded retries with backoff.
- Chaos test: inject DNS latency and verify services degrade gracefully.

## Interview Angle

"It's always DNS" is a joke because DNS is a hidden dependency of everything. Explain the resolution path, why lookups hang for seconds (resolver timeouts), how retries and search domains amplify load, and how caching layers (node-local, application, connection reuse) protect it ([DNS Records](lesson:cn-dns-records), [Service Networking](lesson:cn-service-networking)).
