---
title: "Proxies and Load Balancers: Forward, Reverse, L4 and L7"
subject: cn
level: 9
order: 4
summary: "What sits between clients and servers: forward vs reverse proxies, L4 vs L7 load balancing, balancing algorithms, health checks, connection draining, TLS termination and the headers that carry the client's identity."
depth: core
difficulty: 3
minutes: 45
relevance: essential
stage: 2
prerequisites: [cn-http-connections, cn-tcp-handshake]
related: [cn-cdn, cn-service-networking, cn-http2, db-consistent-hashing, x-overloaded-server]
tags: [proxy, forward proxy, reverse proxy, load balancer, l4, l7, round robin, least connections, consistent hashing, health checks, connection draining, tls termination, x-forwarded-for, sticky sessions, api gateway]
---

## Mental Model

- A **forward proxy** stands in front of **clients**: it makes requests on their behalf ("the company's outbound gateway"). Servers see the proxy, not the clients.
- A **reverse proxy** stands in front of **servers**: clients think it *is* the service; it decides which backend handles each request ("the receptionist who routes callers to available staff").

A **load balancer** is a reverse proxy whose main job is spreading traffic across many backends and routing around failures. The key design question is **how much of the conversation it understands**: only IPs and ports (**L4**), or the actual HTTP requests (**L7**).

## Definition

- **Forward proxy**: client-side intermediary for outbound traffic (corporate egress, content filtering, caching, anonymity).
- **Reverse proxy**: server-side intermediary (Nginx, HAProxy, Envoy, cloud LBs): TLS termination, routing, load balancing, caching, compression, rate limiting, auth.
- **L4 load balancer**: balances TCP/UDP connections by 5-tuple; doesn't parse application data (AWS NLB, IPVS, Maglev).
- **L7 load balancer**: parses HTTP (or gRPC): routes per request by host/path/headers, retries, rewrites (AWS ALB, Envoy, Nginx).
- **API gateway**: an L7 reverse proxy specialized for APIs — auth, rate limits, request transformation, versioning.

## Why It Exists

**The problem.** One server eventually can't take all the traffic, and any server can fail or be redeployed. But clients only know one address.

**The idea.** Put something in front that *owns* the public address and decides, per connection or per request, which real server should answer. Clients see a stable endpoint; behind it, servers come and go freely. Once that middle box exists, it's also the natural place for everything that should happen once for all servers:

- **Scale**: no single server handles all traffic.
- **Availability**: route around failed or deploying instances.
- **Security and policy**: one place for TLS, WAF rules, authentication, rate limiting; backends aren't exposed directly.
- **Flexibility**: blue/green and canary deploys, path-based routing to different services.

:::callout[That's all it is]{type=insight}
A load balancer is a stable front door that forwards each connection (L4) or each request (L7) to one of many healthy backends. The algorithm picks which one; health checks decide who's eligible.
:::

## How It Works

### L4 vs L7

| | L4 | L7 |
|---|---|---|
| Sees | IPs, ports, TCP/UDP | HTTP method, host, path, headers, cookies |
| Unit of balancing | Connection | Request |
| TLS | Passes through (or terminates in some products) | Usually terminates |
| Performance | Very high (can be in-kernel / hardware / DSR) | Lower (parsing, TLS, buffering) |
| Features | Simple, protocol-agnostic | Routing rules, retries, header injection, auth, compression, caching |
| Long-lived HTTP/2/gRPC | Uneven (one connection = many requests) | Balances each request |

### Balancing algorithms

All of these answer "which backend next?" — they differ in how much they know about the backends' current load, and how much bookkeeping they're willing to do to know it.

| Algorithm | How | Good for | Weakness |
|---|---|---|---|
| Round robin | Rotate through backends | Uniform requests & servers | Ignores load differences |
| Weighted round robin | Proportional to weights | Heterogeneous servers, canaries | Static |
| Least connections / least outstanding requests | Pick backend with fewest active | Variable request durations | Needs state; herding on new servers |
| **Power of two choices** | Pick 2 at random, choose the less loaded | Large fleets, distributed LBs | Probabilistic |
| Random | Uniform random | Simple, stateless | Variance |
| IP hash / consistent hashing | Hash client or key to backend | Cache affinity, sessions | Hot keys; rebalancing ([Consistent Hashing](lesson:db-consistent-hashing)) |
| Latency-aware (EWMA) | Prefer fastest backends | Heterogeneous latency | Oscillation if naive |

### Health checks

Spreading traffic is pointless if some of it goes to a dead server. The balancer needs to know who can actually answer.

- **Active**: the LB probes `GET /healthz` every few seconds; N failures → remove, M successes → re-add.
- **Passive / outlier detection**: eject backends returning errors or timeouts on real traffic.
- **Readiness vs liveness**: readiness = "can take traffic now" (dependencies warmed, not draining); liveness = "process is alive" (restart if not). Health endpoints that check **downstream dependencies** can cause cascading failure: a database blip marks *all* instances unhealthy and the LB has nothing left to route to.

### Connection draining

During deploys or scale-in, the LB stops sending **new** requests to an instance but lets in-flight ones finish (deregistration delay, e.g., 30–300 s), while the instance handles SIGTERM gracefully ([Signals](lesson:os-signals)).

### TLS termination and client identity

The LB terminates TLS, then opens a (possibly re-encrypted) connection to the backend. Backends see the **LB's** IP as the source, so the original client information travels in headers:

```http
X-Forwarded-For: 203.0.113.7, 10.0.0.12
X-Forwarded-Proto: https
X-Forwarded-Host: shop.example.com
Forwarded: for=203.0.113.7;proto=https;host=shop.example.com
```

Trust these headers **only from your own proxies** — clients can send forged `X-Forwarded-For`. L4 balancers may use the **PROXY protocol** to pass client addresses, or preserve them via DSR (direct server return).

## Internal Mechanism

:::depth{level=advanced}
### How big L4 balancers scale

Large L4 systems (Google Maglev, Facebook Katran) run on commodity servers announcing the same virtual IP via **anycast/ECMP** ([BGP & Anycast](lesson:cn-bgp-anycast)); routers spread packets across LB servers; each LB uses **consistent hashing** on the 5-tuple so every packet of a connection reaches the same backend even as LB servers are added/removed; responses may bypass the LB entirely (**direct server return**). They're effectively stateless and scale horizontally.

### Retries and overload

L7 proxies retry failed idempotent requests — helpful for transient errors, dangerous under overload: each layer retrying 3× turns one user request into 27 backend attempts (**retry amplification**). Use retry budgets (e.g., retries ≤ 10% of requests), only retry idempotent requests, and propagate deadlines ([Overloaded Servers](lesson:x-overloaded-server)).
:::

## Example

Typical web architecture:

```text
Client ──TLS──▶ CDN edge ──TLS──▶ Cloud L7 LB (ALB) ──HTTP/1.1 keep-alive──▶ Nginx sidecar ──▶ App pods
                                        │ path /api/*  → api service
                                        │ path /static → object storage
```

Nginx reverse-proxy snippet with upstream keep-alive and a health-aware pool:

```nginx
upstream api {
    least_conn;
    server 10.0.1.10:8080 max_fails=3 fail_timeout=10s;
    server 10.0.1.11:8080 max_fails=3 fail_timeout=10s;
    keepalive 64;
}
server {
    listen 443 ssl http2;
    location /api/ {
        proxy_pass http://api;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 30s;
    }
}
```

## Complexity & Performance

- L4 LBs forward millions of packets per second per server; L7 proxies handle tens of thousands of requests per second per core, dominated by TLS and parsing.
- Each proxy hop adds latency (sub-millisecond in-region) and a failure point.

## Trade-offs

- L4: speed and protocol-agnosticism vs coarse (per-connection) balancing.
- L7: rich routing and per-request balancing vs CPU cost and complexity.
- Centralized LB vs client-side balancing (service discovery in the client, no extra hop — [Service Networking](lesson:cn-service-networking)).
- Sticky sessions: simple for stateful apps vs uneven load and fragility; prefer externalized state.

## Failure Modes

- Health checks that depend on shared downstreams → all backends marked down at once.
- Uneven load with L4 + long-lived HTTP/2/gRPC connections.
- Idle-timeout mismatches between client, LB and backend → resets.
- Retry storms amplifying overload.
- Trusting spoofed `X-Forwarded-For` for security decisions (rate limiting, allow-lists).
- 502/504s during deploys without draining.

## In Production

- Cloud: NLB (L4), ALB/GCLB (L7); Kubernetes Ingress controllers and Gateway API; service meshes add per-service L7 proxies.
- Watch per-backend request rates, error rates and latency; 502/504 counts at the LB separate "backend crashed" from "backend slow".

## Deeper Connections

- CDNs are globally distributed reverse proxies ([CDN](lesson:cn-cdn)); east-west balancing inside clusters ([Service Networking](lesson:cn-service-networking)); consistent hashing for affinity ([Consistent Hashing](lesson:db-consistent-hashing)).

## Common Misconceptions

- **"A load balancer makes a service highly available."** Only if backends are redundant, health checks are meaningful, and the LB itself is redundant.
- **"L7 is always better."** It costs CPU and adds complexity; L4 is right for raw TCP/UDP and extreme throughput.
- **"Round robin spreads load evenly."** Only if requests cost the same.

## Interview Questions

### [L1 · compare] Forward proxy vs reverse proxy?

A forward proxy acts on behalf of clients, sending their requests to arbitrary servers (egress control, caching, anonymity); servers see the proxy. A reverse proxy acts on behalf of servers, receiving client requests and forwarding them to backends (load balancing, TLS termination, caching, routing); clients see the proxy as the server.

### [L2 · compare] L4 vs L7 load balancing?

L4 balances transport connections using IPs and ports without parsing application data — fast and protocol-agnostic, but one long-lived connection always goes to one backend. L7 parses HTTP, balancing individual requests and routing by host/path/headers, with features like retries, TLS termination and header manipulation, at higher CPU cost.

### [L2 · compare] Round robin vs least connections?

Round robin cycles through backends regardless of load — fine when requests are uniform. Least connections sends new requests to the backend with the fewest active connections/requests, adapting to variable request durations and slower servers, at the cost of tracking state.

### [L3 · why] Why can health checks that verify database connectivity cause outages?

If the database has a brief problem, every instance's health check fails simultaneously and the LB removes all backends — turning a partial degradation (maybe some requests could still be served, or fail fast with good errors) into a total outage, and causing thundering-herd reconnects on recovery. Health checks should reflect the instance's own ability to serve; dependency failures are better handled with degraded responses and circuit breakers.

### [L3 · debugging] Users see 502 errors spike for a minute during every deploy. What's happening?

The LB sends requests to instances that are shutting down (killed before in-flight requests finish, or still registered after the process exits) or to new instances not yet ready. Fix: readiness probes gating traffic, deregistration/draining delays longer than request timeouts, graceful SIGTERM handling (stop accepting, finish in-flight), preStop delay so the LB notices removal first, and keep-alive timeouts on backends longer than the LB's idle timeout.

## Practice

### [mcq] A gRPC service with long-lived HTTP/2 connections is balanced by an L4 load balancer. What problem is likely?

- [ ] Requests are rejected
- [x] Load concentrates on a few backends because balancing is per connection, not per request
- [ ] TLS can't be used
- [ ] Health checks stop working

Use L7 or client-side balancing.

### [mcq] Which header conventionally carries the original client IP through HTTP proxies?

- [ ] Via
- [x] X-Forwarded-For (or Forwarded)
- [ ] Origin
- [ ] Referer

Only trust it when set by your own proxies.

## Quick Revision

- Forward proxy = for clients; reverse proxy = for servers; LB = reverse proxy spreading load.
- L4 (connections, fast) vs L7 (requests, HTTP-aware, TLS termination, routing, retries).
- Algorithms: RR, weighted, least connections/outstanding, power of two choices, hashing, latency-aware.
- Health checks (active/passive; readiness vs liveness; don't depend on shared downstreams), draining on deploy.
- Client identity via X-Forwarded-For/Forwarded/PROXY protocol (trust only your proxies).
- Beware retry amplification and idle-timeout mismatches.
