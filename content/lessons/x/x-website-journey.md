---
title: "What Happens When You Open a Website — Every Layer"
subject: x
level: 0
order: 1
summary: "The classic interview question answered properly: from keystroke to pixels through the browser, DNS, TCP, TLS, HTTP, load balancers, the kernel's socket machinery, an application server, a database query and back — with the latency budget of each step and the follow-up questions interviewers ask."
depth: core
difficulty: 3
minutes: 50
relevance: essential
stage: 2
prerequisites: [cn-dns-fundamentals, cn-tcp-handshake, cn-tls-handshake, cn-http-fundamentals]
related: [x-sql-query-journey, cn-proxies-load-balancers, cn-cdn, cn-http-caching, os-epoll-event-loops, db-query-lifecycle, x-connection-management, cn-encapsulation]
visualizations: [encapsulation]
tags: [what happens when you type a url, request lifecycle, dns, tcp, tls, http, load balancer, reverse proxy, cdn, kernel, sockets, epoll, application server, database, rendering, latency budget]
---

## Mental Model

Opening `https://shop.example.com/orders` is a relay race across **five systems** — browser, network, server kernel, application, database — and **four protocols** — DNS, TCP, TLS, HTTP. Each hands a well-defined object to the next: a name becomes an IP address, the address becomes a connection, the connection becomes a secure channel, the channel carries a request, the request becomes a query, rows become JSON, JSON becomes pixels.

A strong answer is **ordered, layered and quantified**: say what happens, which layer does it, and roughly how long it takes — then go deep wherever the interviewer points.

## Definition

The latency budget of a first visit (typical, same continent, RTT ≈ 30 ms):

| Step | Layer | Cost |
|---|---|---|
| Parse URL, check caches (HSTS, HTTP cache, service worker) | browser | ~0–1 ms |
| DNS resolution (if not cached) | CN, DNS | 0 ms (cached) … 20–100 ms (recursive) |
| TCP handshake | CN, transport | 1 RTT (30 ms) |
| TLS 1.3 handshake | CN, security | 1 RTT (30 ms) |
| HTTP request → response (server time included) | CN + app + DB | 1 RTT + server time (30 ms + 20–200 ms) |
| Download HTML, discover and fetch CSS/JS/images | browser + CN | several RTTs, bandwidth-bound |
| Parse, style, layout, paint, run JS | browser (CPU) | tens–hundreds of ms |

Round trips dominate network time; that's why HTTP/2 connection reuse, TLS 1.3, HTTP/3 (0-RTT resumption) and CDNs (shorter RTT) exist ([Latency & Bandwidth](lesson:cn-latency-bandwidth)).

## Why It Exists

**The problem it reveals.** Loading a page looks like one action, but it needs *five independent problems* solved in sequence: find the machine (DNS), get a reliable pipe to it (TCP), make the pipe private and authentic (TLS), say what you want (HTTP), and have the server produce it (kernel, app, database). Each protocol in the chain exists because the one before it left exactly one problem unsolved.

**Why interviewers ask it.** This question tests whether you see the system as connected layers rather than memorized facts. Every follow-up ("what if DNS fails?", "where can it be slow?", "what does the kernel do?", "how does the server handle 10,000 of these?") is a door into one of the academy's subjects.

:::callout[That's all it is]{type=insight}
Name → address (DNS), address → connection (TCP), connection → secure channel (TLS), channel → request (HTTP), request → rows (app + database), rows → pixels (browser). Each step costs round trips, which is why caching and connection reuse matter so much.
:::

## How It Works

### 1. Browser: before any network I/O

- Parse the URL; `https` → port 443. **HSTS** list may force HTTPS for `http://` URLs.
- Check the **HTTP cache** / service worker: a fresh cached response means no network at all ([HTTP Caching](lesson:cn-http-caching)).
- Check for a reusable **connection** to this origin (keep-alive pool, HTTP/2 connection): if one exists, skip to step 5 ([HTTP Connections](lesson:cn-http-connections)).

### 2. DNS: name → IP address

*Why this step:* routers only understand numeric addresses, and humans only remember names.

Browser cache → OS resolver (stub, `/etc/hosts`, systemd-resolved cache) → recursive resolver (ISP / 8.8.8.8 / 1.1.1.1) → if not cached: root → `.com` TLD → `example.com` authoritative servers → answer, possibly a CNAME to a CDN hostname with a short TTL ([DNS](lesson:cn-dns-fundamentals)). Result: `93.184.215.14`, cached per its TTL.

Walkthrough: [DNS resolution](uth:dns-resolution).

### 3. TCP: a reliable byte stream

*Why this step:* IP only delivers loose packets that can be lost or reordered; HTTP needs an ordered, complete stream.

The browser calls `connect()`: the kernel picks an ephemeral source port, creates a socket, and sends SYN; the server's kernel replies SYN-ACK from its listen queue; the client's ACK completes the handshake — **no application code on the server runs yet** ([TCP Handshake](lesson:cn-tcp-handshake)). Packets travel via the local router (ARP for the gateway's MAC, NAT rewriting the source address), ISP routers doing longest-prefix-match forwarding, and finally the server's network ([Routing](lesson:cn-routing), [NAT](lesson:cn-nat)).

Walkthrough: [TCP connect](uth:tcp-connect).

### 4. TLS 1.3: authenticated encryption

*Why this step:* the TCP stream crosses networks you don't control — anyone on the path could read or change it, or pretend to be the server.

ClientHello (with key share, SNI, ALPN `h2`) → ServerHello + encrypted certificate chain + CertificateVerify + Finished → client verifies the chain to a trusted root, checks the hostname, derives keys, sends Finished + the first request. One round trip ([TLS Handshake](lesson:cn-tls-handshake)).

Walkthrough: [HTTPS connect](uth:https-connect).

### 5. HTTP request

```http
GET /orders HTTP/2
Host: shop.example.com
Cookie: session=…
Accept-Encoding: br, gzip
```

Over HTTP/2 it's a HEADERS frame on a new stream, HPACK-compressed ([HTTP/2](lesson:cn-http2)).

### 6. The edge: CDN, load balancer, reverse proxy

*Why this step:* one server can't serve everyone and can't be close to everyone, so something in front spreads requests and answers what it can from nearby.

The IP likely belongs to a **CDN or load balancer**, not the app server. A CDN may serve cached static assets itself ([CDN](lesson:cn-cdn)). For dynamic requests, an L7 load balancer terminates TLS, applies routing rules, picks a healthy backend (round robin / least connections), and forwards the request over a pooled connection ([Proxies & Load Balancers](lesson:cn-proxies-load-balancers)).

### 7. The server kernel

*Why this step:* the application can't touch the network card directly; the kernel turns raw frames into bytes on a socket the app can read.

The NIC DMA-copies the frames into RAM and raises an interrupt; the kernel's network stack reassembles TCP segments into the socket's receive buffer and marks the socket readable. The application's event loop, sleeping in `epoll_wait()`, wakes up; `read()` copies the bytes into user space ([Syscalls & Interrupts](lesson:os-syscalls-interrupts), [epoll](lesson:os-epoll-event-loops)).

Walkthrough: [HTTP request reaching the server](uth:http-request-server).

### 8. The application

The framework parses the HTTP request, runs middleware (auth: look up the session — maybe in Redis — [Redis & Caching](lesson:db-redis-caching)), routes to a handler on a worker thread or event-loop task ([Thread Pools](lesson:os-thread-pools)). The handler borrows a database connection from its **pool** ([Connection Management](lesson:x-connection-management)).

### 9. The database

`SELECT … FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 20` travels over the pooled TCP connection; the database parses, plans (index scan on `(customer_id, created_at)`), reads pages from its buffer pool (or disk), checks MVCC visibility, and streams rows back ([SQL Query Journey](lesson:x-sql-query-journey)).

### 10. The response and rendering

The app serializes JSON/HTML, the response flows back through the proxy (maybe compressed with Brotli), and the browser parses HTML, builds the DOM and CSSOM, fetches subresources (parallel streams on the same HTTP/2 connection), runs JavaScript, lays out and paints. Subsequent requests reuse the connection: no DNS, TCP or TLS cost.

::viz{id=encapsulation}

## Internal Mechanism

:::depth{level=advanced}
### Where the packets actually go

Each hop re-encapsulates: the IP packet stays (TTL decremented, checksum updated, NAT rewriting addresses at the home router), while the Ethernet/Wi-Fi frame is rebuilt per link with new MAC addresses ([Encapsulation](lesson:cn-encapsulation)). Congestion control starts with a small window (slow start), so the first response bytes arrive in a few round trips if the page is large — another reason to keep critical HTML small ([Congestion Control](lesson:cn-tcp-congestion-control)).

### Resumption and 0-RTT

Returning visitors resume TLS sessions with PSK tickets; TLS 1.3 0-RTT (and QUIC) can send the request in the first flight — at the cost of replay risk, so it's limited to idempotent requests ([HTTP/3 & QUIC](lesson:cn-http3-quic)).

### Server-side concurrency

Thousands of such requests arrive concurrently. Event-loop servers (nginx, Node.js) multiplex sockets with epoll on few threads; thread-per-request servers use pools; both are bounded by the database connection pool and CPU ([Overloaded Server](lesson:x-overloaded-server)).
:::

## Example

A cold first visit, 40 ms RTT, uncached DNS:

| Step | Time |
|---|---|
| DNS (recursive, partly cached at resolver) | 45 ms |
| TCP handshake | 40 ms |
| TLS 1.3 | 40 ms |
| Request + server (auth 2 ms, DB query 8 ms, render 5 ms) + response first byte | 40 + 15 = 55 ms |
| Time to first byte | **≈ 180 ms** |
| HTML download + CSS/JS (parallel on the same connection) + render | + 300–800 ms |

Warm repeat visit: DNS cached, connection reused, static assets fresh in cache → TTFB ≈ 55 ms and far fewer bytes. Most web performance work is removing round trips and bytes from the cold path.

## Complexity & Performance

Latency ≈ (number of sequential round trips × RTT) + server time + transfer time + client CPU. Bandwidth rarely dominates for HTML/API responses; round trips and server time do.

## Trade-offs

- TLS termination at the edge (fast, centralized certs) vs end-to-end encryption to backends (defense in depth, more CPU).
- CDNs and caching (fewer RTTs) vs freshness ([Caching Everywhere](lesson:x-caching-everywhere)).
- Rich client-side rendering (fewer server renders) vs slower first paint on weak devices.

## Failure Modes

What breaks at each layer, and the symptom:

| Layer | Failure | Symptom |
|---|---|---|
| DNS | expired domain, bad record, resolver outage | "site can't be reached", NXDOMAIN, SERVFAIL |
| TCP | firewall drop, server down, SYN backlog full | connection timeout / refused |
| TLS | expired or mismatched certificate, clock skew | browser certificate error |
| HTTP/LB | no healthy backends, overloaded app | 502/503/504 |
| App | exception, pool exhaustion | 500, slow responses |
| DB | slow query, lock wait, failover | 5xx or long latency |

## In Production

- Distributed tracing (a trace id propagated from the edge to the database) shows exactly where time goes in real requests; browser performance APIs show DNS/TCP/TLS/TTFB timings per request.
- Most outages manifest at the edge (5xx, timeouts) but originate deeper (DB, pool, dependency).

## Deeper Connections

- Every step has its own deep lesson; this page is the map. The database portion continues in [SQL Query Journey](lesson:x-sql-query-journey); what happens under load in [Overloaded Server](lesson:x-overloaded-server).
- The same layering appears in reverse for the response; the same caching idea appears at almost every step ([Caching Everywhere](lesson:x-caching-everywhere)).

## Common Misconceptions

- **"The browser connects directly to the app server."** Usually to a CDN or load balancer that terminates TLS.
- **"DNS happens on every request."** Results are cached at several levels until their TTL expires.
- **"The server application accepts the TCP connection."** The kernel completes the handshake; the application later calls accept() on a ready connection.

## Interview Questions

### [L1 · trace] What happens when you type a URL into the browser and press Enter?

:::answer
The browser parses the URL and checks its caches (HSTS, HTTP cache, existing connections). It resolves the hostname via DNS (browser/OS caches, then a recursive resolver querying root, TLD and authoritative servers). It opens a TCP connection (three-way handshake) to the returned IP — usually a CDN or load balancer — and performs a TLS handshake (certificate validation, key exchange). It sends an HTTP request (method, path, headers, cookies). The load balancer forwards it to an application server; the kernel delivers the bytes to the app via its socket; the app authenticates, runs business logic and queries the database over a pooled connection; the response travels back; the browser parses HTML, fetches CSS/JS/images (reusing the connection), executes scripts, lays out and paints the page.
:::

### [L2 · debugging] A website loads fine for most users but one region reports "connection timed out". How do you narrow down the layer?

Check DNS answers from that region (dig from a vantage point there — wrong or stale records, geo-DNS pointing to an unhealthy PoP), then TCP reachability (traceroute/mtr to find where packets stop, firewall or routing/BGP issue for that region's ISPs), then TLS (certificate/SNI issues at a specific edge PoP), then HTTP (edge logs for that PoP). A timeout, unlike a refusal or HTTP error, suggests packets being dropped — routing, firewall, or an overwhelmed edge.

### [L2 · why] Why is the second page load on the same site much faster?

DNS results are cached, the TCP/TLS connection is reused (or TLS resumed), static assets are served from the browser cache or validated with cheap 304s, and the CDN edge is warm. Only the dynamic request and its server time remain on the critical path.

### [L3 · design] How would you cut 200 ms from time-to-first-byte for users far from your servers?

Serve from edges closer to users: a CDN terminating TCP/TLS near the user (short handshakes) with persistent, pre-warmed connections to the origin; cache what's cacheable at the edge (including API responses with short TTLs/stale-while-revalidate); enable TLS 1.3, session resumption, HTTP/2 or HTTP/3; reduce DNS time with long TTLs where safe; and reduce server time (database query optimization, caching). For truly global low latency, deploy regional application replicas with local read replicas.

## Practice

### [numeric 3] How many round trips before the first HTTP response byte arrives on a brand-new HTTPS connection using TCP and TLS 1.3 (DNS cached, ignore server time)?

:::answer
TCP handshake (1) + TLS 1.3 handshake (1) + HTTP request/response (1) = **3** round trips. With TLS 1.2 it would be 4; with QUIC/HTTP/3 it's 2 (and 1 with 0-RTT resumption).
:::

### [mcq] Which component typically completes the TCP three-way handshake on the server?

- [ ] The application's request handler
- [x] The server's kernel network stack (the app later calls accept())
- [ ] The database
- [ ] The DNS server

Completed connections wait in the accept queue until the application accepts them.

## Quick Revision

- Browser caches → DNS → TCP (1 RTT) → TLS 1.3 (1 RTT) → HTTP (1 RTT + server time) → render.
- The IP is usually a CDN/load balancer; TLS terminates there.
- Server: NIC → interrupt → kernel TCP → socket buffer → epoll wakes app → handler → pooled DB connection → query → response.
- Round trips dominate; caching and connection reuse remove them.
- Know the failure signature per layer: NXDOMAIN, timeout/refused, cert error, 502/503/504, 500, slow DB.
