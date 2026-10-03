---
title: "Real-Time Communication: Polling, Long Polling, SSE and WebSockets"
subject: cn
level: 9
order: 3
summary: "Four ways to get server events to clients, compared by latency, overhead, direction and operational cost — plus how WebSockets upgrade from HTTP and what it takes to run millions of connections."
depth: core
difficulty: 3
minutes: 40
relevance: high
stage: 3
prerequisites: [cn-http-connections]
related: [os-epoll-event-loops, cn-proxies-load-balancers, cn-tcp-termination, cn-http2]
visualizations: [realtime-transports]
tags: [polling, long polling, server-sent events, sse, websocket, upgrade, 101 switching protocols, full duplex, heartbeat, reconnect, backpressure, fan-out, pub/sub]
---

## Mental Model

A client wants to know when something happens on the server (a chat message, a price change, a job finishing). HTTP is request/response — the server can't speak first. Four workarounds, like four ways to learn if your package arrived:

- **Polling**: check the porch every 10 seconds. Simple, wasteful, and up to 10 s late.
- **Long polling**: stand at the door; the courier answers when a package arrives (or after a timeout), then you immediately stand at the door again.
- **Server-Sent Events (SSE)**: a subscription line — the courier keeps talking to you over one open line, announcing each package. One-way.
- **WebSockets**: a two-way radio — either side can talk anytime.

## Definition

- **Short polling**: periodic requests (`GET /messages?since=…` every N seconds).
- **Long polling**: the server holds each request open until data is available or a timeout, then the client immediately re-requests.
- **SSE (Server-Sent Events)**: an HTTP response with `Content-Type: text/event-stream` that the server keeps open, streaming `data:` lines; the browser's `EventSource` handles reconnection with `Last-Event-ID`.
- **WebSocket (RFC 6455)**: a full-duplex, message-oriented protocol started by an HTTP `Upgrade` handshake, then framing binary/text messages over the same TCP connection.

## Why It Exists

Chat, notifications, collaborative editing, dashboards, trading screens, multiplayer games and live feeds need low-latency server-initiated updates that request/response HTTP doesn't naturally support.

## How It Works

### Comparison

| | Short polling | Long polling | SSE | WebSocket |
|---|---|---|---|---|
| Direction | Client pull | Server push (emulated) | Server → client | **Bidirectional** |
| Latency | Up to the interval | ~Immediate (+ re-request RTT between events) | Immediate | Immediate |
| Overhead per event | Full HTTP request/response, even when empty | Full request/response per event | A few bytes per event | 2–14 byte frame header |
| Connections | Short-lived | Held open, reopened per event | One long-lived HTTP response | One long-lived upgraded connection |
| Protocol | Plain HTTP | Plain HTTP | Plain HTTP (works with HTTP/2) | Separate protocol after upgrade |
| Reconnect / resume | N/A | Manual | **Built in** (`Last-Event-ID`) | Manual (heartbeats, resume logic) |
| Binary data | Yes | Yes | Text only | Yes |
| Proxies/CDNs | Easy | Timeouts need tuning | Buffering must be disabled | Must support Upgrade; long-lived |
| Best for | Infrequent updates, simplicity | Legacy fallback | Feeds, notifications, LLM token streaming, dashboards | Chat, collaboration, games, bidirectional low-latency |

::viz{id=realtime-transports}

### The WebSocket handshake

```http
GET /chat HTTP/1.1
Host: chat.example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13
Origin: https://app.example.com

HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

After `101`, the TCP connection carries WebSocket **frames** (text, binary, ping, pong, close). Client-to-server frames are masked (to prevent cache-poisoning attacks on naive proxies). Browsers send `Origin`; servers must check it — WebSockets aren't covered by CORS, so **cross-site WebSocket hijacking** is a real risk with cookie auth.

### SSE on the wire

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache

id: 41
event: price
data: {"sym":"ACME","px":101.3}

id: 42
data: {"sym":"ACME","px":101.4}
```

If the connection drops, `EventSource` reconnects (respecting a server-suggested `retry:`) and sends `Last-Event-ID: 42` so the server can resume.

## Internal Mechanism

### Running millions of persistent connections

Each open connection costs a socket, kernel buffers, TLS state and application state — but, with an event-loop or lightweight-thread server, **no thread** ([epoll & Event Loops](lesson:os-epoll-event-loops)). Engineering concerns:

- **File-descriptor and memory limits** (tune `ulimit -n`, socket buffers).
- **Load balancers**: must support long-lived connections and upgrades; idle timeouts must exceed heartbeat intervals; L4 balancing distributes connections, not messages ([Proxies & Load Balancers](lesson:cn-proxies-load-balancers)).
- **Heartbeats** (ping/pong every 20–30 s) detect dead peers and keep NAT/LB mappings alive ([TCP Termination](lesson:cn-tcp-termination)).
- **Fan-out**: a message for a room/user must reach whichever server holds the recipient's connection → a pub/sub backbone (Redis pub/sub, Kafka, NATS) between gateway servers.
- **Backpressure**: slow clients must not accumulate unbounded buffers — drop, coalesce (send only the latest price), or disconnect.
- **Reconnect storms**: after a deploy or outage, all clients reconnect at once — clients need jittered exponential backoff; servers drain connections gradually (close with a "reconnect later" hint).

:::depth{level=advanced}
### Deploying stateful connection servers

Rolling deploys must migrate or drop connections: send close frames, let clients reconnect with backoff to other instances, and use connection draining periods. Resumable protocols (message IDs, resume tokens) avoid data loss across reconnects. Autoscaling is sluggish because existing connections don't move to new instances by themselves — rebalance by periodically recycling connections.
:::

## Example

Stock ticker to 100,000 browser clients, 1 update/s each:

- **Polling every 1 s**: 100,000 requests/s with ~800 B of headers each → ~80 MB/s of mostly-empty responses; up to 1 s stale.
- **SSE**: 100,000 open responses; each update ~60 bytes → ~6 MB/s, instant. Clients only listen, so SSE fits perfectly — and works over HTTP/2 without extra infrastructure.
- **WebSocket**: similar bandwidth; worth it only if clients also send frequent messages (e.g., order entry).

## Complexity & Performance

- Polling cost scales with clients × frequency regardless of events; push scales with events.
- Persistent connections shift cost from CPU/bandwidth to memory and connection management.

## Trade-offs

Choose the simplest mechanism that meets latency and direction needs: polling for rare updates, SSE for server→client streams, WebSockets for true bidirectional interaction.

## Failure Modes

- **Reconnect storms** after deploys/outages overwhelming servers and auth backends. Case study: [WebSocket Disconnect Storms](case:websocket-storm).
- Proxy/LB idle timeouts silently killing connections (missing heartbeats).
- SSE buffered by proxies (e.g., Nginx `proxy_buffering on`) → events delayed.
- Unbounded per-connection buffers for slow consumers → memory blowup.
- HTTP/1.1 browsers limit ~6 connections per origin — multiple SSE tabs can starve other requests (HTTP/2 fixes it).

## In Production

- Chat/collaboration: WebSocket gateways + pub/sub backbone + presence service.
- Notifications/feeds and LLM streaming responses: SSE.
- Mobile apps often prefer platform push notifications for background delivery.

## Deeper Connections

- Event loops handling many idle connections ([epoll & Event Loops](lesson:os-epoll-event-loops)); keep-alive and NAT timeouts ([TCP Termination](lesson:cn-tcp-termination)); the overload dynamics of reconnect storms ([Overloaded Servers](lesson:x-overloaded-server)).

## Common Misconceptions

- **"WebSockets are always better than polling."** They add operational complexity; SSE or polling are often enough.
- **"SSE is obsolete."** It's simple, uses plain HTTP, reconnects automatically and is widely used for streaming responses.
- **"WebSockets are protected by CORS."** Servers must validate `Origin` themselves.

## Interview Questions

### [L1 · compare] Compare polling, long polling, SSE and WebSockets.

Polling repeatedly asks the server (simple, wasteful, latency up to the interval). Long polling holds each request until data arrives (near-real-time, but one request per event). SSE keeps one HTTP response open for a server-to-client event stream (lightweight, auto-reconnect, text-only, one direction). WebSockets upgrade an HTTP connection to a persistent full-duplex channel (lowest latency both ways, binary support, more operational complexity).

### [L2 · how] How does a WebSocket connection get established?

The client sends an HTTP GET with `Upgrade: websocket`, `Connection: Upgrade` and a random `Sec-WebSocket-Key`. The server replies `101 Switching Protocols` with `Sec-WebSocket-Accept` (a hash of the key with a fixed GUID). From then on, the same TCP connection carries WebSocket frames in both directions.

### [L3 · design] Design the backend for a chat app with 5 million concurrent WebSocket users.

Stateless-ish gateway servers running event loops, each holding ~100k–500k connections, behind L4 load balancers with long idle timeouts; authentication at connect; a connection registry (user → gateway) and a pub/sub layer (Redis/NATS/Kafka) for routing messages to the right gateways; persistent message storage with IDs for history and resume; heartbeats; per-connection bounded send buffers with backpressure policies; jittered reconnect backoff and gradual draining during deploys; metrics on connections, fan-out latency and buffer drops.

### [L3 · incident] After deploying a new version of the WebSocket gateway, the auth service falls over. Why?

Rolling the gateways disconnected clients, which all reconnected at nearly the same time, each triggering token validation/auth lookups — a thundering herd. Mitigations: drain connections gradually, send reconnect hints with randomized delays, clients use exponential backoff with jitter, cache auth decisions or use self-validating tokens at connect, and rate-limit reconnect admission.

## Practice

### [mcq] Which mechanism provides built-in automatic reconnection with resume via Last-Event-ID?

- [ ] WebSocket
- [x] Server-Sent Events
- [ ] Long polling
- [ ] Short polling

EventSource handles it natively.

### [mcq] Which HTTP status code completes a WebSocket upgrade?

- [ ] 200
- [x] 101
- [ ] 204
- [ ] 426

101 Switching Protocols.

## Quick Revision

- Polling (interval latency, waste) → long polling (request per event) → SSE (one-way stream, auto-reconnect, text) → WebSocket (full duplex, binary, upgrade via 101).
- WebSocket: check `Origin` (not covered by CORS); ping/pong heartbeats.
- At scale: event loops, fd limits, LB idle timeouts, pub/sub fan-out, backpressure, jittered reconnects, draining.
- Pick the simplest transport that meets direction + latency needs.
