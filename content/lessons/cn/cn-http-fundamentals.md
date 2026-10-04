---
title: "HTTP Fundamentals: Requests, Responses, Methods, Status Codes and Headers"
subject: cn
level: 7
order: 1
summary: "HTTP as a stateless request/response protocol: the anatomy of messages, method semantics (safe, idempotent), status code families, essential headers, content negotiation and compression."
depth: beginner
difficulty: 2
minutes: 40
relevance: essential
stage: 1
prerequisites: [cn-tcp-fundamentals, cn-dns-fundamentals]
related: [cn-http-connections, cn-http-caching, cn-api-styles, cn-cookies-sessions, cn-proxies-load-balancers]
labs: [http-cache]
tags: [http, request, response, methods, get, post, put, patch, delete, idempotent, safe methods, status codes, headers, content negotiation, compression, rest, stateless]
---

## Mental Model

HTTP is a **form-and-reply protocol**. The client fills out a form — *what action* (method), *on what* (URL), *with what metadata* (headers), *and what payload* (body) — and the server returns a reply: *how it went* (status code), metadata (headers) and content (body). Each exchange stands alone: the server remembers nothing between requests unless you send it something to remember you by (cookies, tokens). That **statelessness** is why HTTP scales across load balancers and caches so well.

## Definition

**HTTP (Hypertext Transfer Protocol)** is an application-layer, stateless, request/response protocol. Its **semantics** (methods, status codes, headers — RFC 9110) are shared by all versions; the **wire formats** differ: HTTP/1.1 is text over TCP, HTTP/2 is binary frames over TCP, HTTP/3 is binary frames over QUIC.

## Why It Exists

**The problem.** TCP delivers bytes, but bytes alone don't say *what you want*. Client and server need a shared language: "give me this document", "here it is", "it doesn't exist", "you're not allowed".

**The idea.** Make every exchange a self-contained form: a verb, a target, some labelled metadata, and an optional body — and make the reply equally self-contained. Because each request carries everything needed to answer it, *any* server, cache or proxy can handle it. Designed for fetching hypertext documents, HTTP's simple, extensible, stateless design turned it into the universal application protocol: web pages, REST and GraphQL APIs, gRPC (over HTTP/2), webhooks, file downloads, streaming.

:::callout[That's all it is]{type=insight}
HTTP is "method + URL + headers + body" in, "status + headers + body" out. Every feature — caching, cookies, auth, compression — is a header that both sides agree to understand.
:::

## How It Works

### Anatomy (HTTP/1.1 on the wire)

```http
POST /api/orders?source=web HTTP/1.1
Host: shop.example.com
User-Agent: curl/8.5.0
Accept: application/json
Content-Type: application/json
Content-Length: 46
Authorization: Bearer eyJhbGciOi...
Idempotency-Key: 7f9c1c2e-51b1-4f0e-9d0b-2b0a6f0a1e33

{"sku":"KB-104","qty":2,"address_id":"a_981"}
```

```http
HTTP/1.1 201 Created
Content-Type: application/json
Content-Length: 58
Location: /api/orders/ord_5521
Cache-Control: no-store
Date: Tue, 22 Sep 2026 10:15:00 GMT

{"id":"ord_5521","status":"pending","total_cents":12998}
```

Request line (method, target, version) → headers → blank line → optional body. Response: status line → headers → blank line → body.

### Methods and their semantics

Why methods matter beyond "what the server does": they tell *everyone in between* — browsers, caches, proxies, retry logic — what's safe to repeat or store without asking.

| Method | Purpose | Safe? | Idempotent? | Body? |
|---|---|---|---|---|
| GET | Retrieve a representation | ✔ | ✔ | No (semantics undefined) |
| HEAD | GET without body | ✔ | ✔ | No |
| OPTIONS | Capabilities (CORS preflight) | ✔ | ✔ | Rarely |
| POST | Process/create (non-idempotent action) | ✘ | ✘ | Yes |
| PUT | Replace the resource at this URL | ✘ | ✔ | Yes |
| PATCH | Partial modification | ✘ | ✘ (can be designed idempotent) | Yes |
| DELETE | Remove the resource | ✘ | ✔ | Rarely |

- **Safe**: no intended side effects on the server (crawlers, prefetchers and caches may call them freely).
- **Idempotent**: doing it N times has the same effect as once — so clients and proxies may **retry** it after a network failure. DELETE twice leaves the resource deleted; POST twice may create two orders — hence **idempotency keys** for retryable POSTs.

### Status code families

| Range | Meaning | Common codes |
|---|---|---|
| 1xx | Informational | 100 Continue, 101 Switching Protocols (WebSocket upgrade), 103 Early Hints |
| 2xx | Success | 200 OK, 201 Created, 202 Accepted (async), 204 No Content, 206 Partial Content (range requests) |
| 3xx | Redirection | 301 Moved Permanently, 302 Found, 304 Not Modified (cache revalidation), 307/308 (redirect preserving method) |
| 4xx | Client error | 400 Bad Request, 401 Unauthorized (not authenticated), 403 Forbidden (authenticated, not allowed), 404 Not Found, 405 Method Not Allowed, 409 Conflict, 412 Precondition Failed, 413 Payload Too Large, 415 Unsupported Media Type, 422 Unprocessable Content, 429 Too Many Requests |
| 5xx | Server error | 500 Internal Server Error, 502 Bad Gateway (proxy got a bad upstream response), 503 Service Unavailable (overload/maintenance, may carry Retry-After), 504 Gateway Timeout (proxy's upstream too slow) |

Distinctions interviewers probe: **401 vs 403**, **301 vs 302 vs 307/308**, **502 vs 503 vs 504**, **200 vs 201 vs 204**, and why **5xx and 429 are retryable while most 4xx are not**.

### Essential headers

| Header | Purpose |
|---|---|
| `Host` | Which site (virtual hosting — many sites on one IP); mandatory in HTTP/1.1 |
| `Content-Type` / `Content-Length` | Media type and size of the body |
| `Accept`, `Accept-Encoding`, `Accept-Language` | Content negotiation |
| `Authorization` | Credentials (Bearer tokens, Basic) |
| `Cookie` / `Set-Cookie` | State across requests ([Cookies & Sessions](lesson:cn-cookies-sessions)) |
| `Cache-Control`, `ETag`, `Last-Modified`, `If-None-Match` | Caching and revalidation ([HTTP Caching](lesson:cn-http-caching)) |
| `Location` | Redirect target / URL of created resource |
| `Connection`, `Keep-Alive`, `Transfer-Encoding` | Hop-by-hop connection behavior (HTTP/1.1) |
| `X-Forwarded-For` / `Forwarded` | Original client IP through proxies |
| `Retry-After` | When to retry (429/503) |

### Content negotiation and compression

The client states preferences (`Accept: application/json`, `Accept-Encoding: gzip, br, zstd`); the server picks a representation and says so (`Content-Type`, `Content-Encoding: br`) and adds `Vary: Accept-Encoding` so caches keep variants apart. Text compresses 70–90% with gzip/Brotli; already-compressed media (JPEG, MP4) shouldn't be recompressed.

## Internal Mechanism

:::depth{level=advanced}
### Statelessness and where state lives

Each request must carry everything needed to process it (auth token, session cookie). This lets any server behind a load balancer handle any request, lets caches serve responses, and makes horizontal scaling simple. State lives elsewhere: in cookies/tokens on the client, in shared stores (Redis, databases) on the server side. "Sticky sessions" at load balancers are a workaround for servers keeping in-memory session state — convenient but fragile under scaling and failures ([Proxies & Load Balancers](lesson:cn-proxies-load-balancers)).
:::

## Example

```bash
$ curl -sv https://example.com/ -o /dev/null 2>&1 | grep -E '^[<>]'
> GET / HTTP/2
> Host: example.com
> accept: */*
< HTTP/2 200
< content-type: text/html; charset=UTF-8
< cache-control: max-age=604800
< etag: "3147526947"
< content-length: 1256
```

## Visualization

Caching headers in action — see how `Cache-Control` and `ETag` decide between a fresh hit, a 304 revalidation and a full fetch:

::lab{id=http-cache}

## Complexity & Performance

- Header overhead: HTTP/1.1 headers are uncompressed text (often 500 B–2 KB per request, cookies can add more); HTTP/2/3 compress headers (HPACK/QPACK).
- Latency dominated by connection setup, round trips and payload size, not parsing.

## Trade-offs

- Statelessness: scalability and cacheability vs repeating context (tokens, cookies) on every request.
- Text-based HTTP/1.1: human-readable, easy to debug vs parsing cost and ambiguity (request smuggling) → binary framing in HTTP/2/3.

## Failure Modes

- Retrying non-idempotent requests → duplicate side effects.
- Wrong status codes (200 with an error body) breaking clients, monitoring and caches.
- Missing `Vary` → caches serving the wrong variant (gzip to clients that can't decode, one user's language to another).
- Oversized headers/cookies → 431 or proxy rejections.

## In Production

- Observability: log method, route, status, latency; alert on 5xx rates; treat 429/503 as backpressure signals.
- API design: correct methods, status codes, idempotency keys for POST, pagination, versioning ([API Styles](lesson:cn-api-styles)).

## Deeper Connections

- Connection management across versions: [HTTP Connections](lesson:cn-http-connections), [HTTP/2](lesson:cn-http2), [HTTP/3 & QUIC](lesson:cn-http3-quic).
- Idempotency is the bridge to distributed systems: [Distributed Transactions](lesson:db-distributed-transactions).

## Common Misconceptions

- **"PUT and POST are interchangeable."** PUT is idempotent replacement at a known URL; POST is a non-idempotent action/creation.
- **"401 means forbidden."** 401 = not authenticated (send credentials); 403 = authenticated but not allowed.
- **"GET requests are always safe to retry, POST never."** Correct by semantics only if servers implement them correctly — a GET with side effects breaks everything built on safety.

## Interview Questions

### [L1 · compare] What's the difference between GET and POST?

GET retrieves a resource; it's safe and idempotent, parameters go in the URL, responses are cacheable, and it may be retried or prefetched freely. POST submits data for processing (e.g., creating a resource); it's neither safe nor idempotent, carries a body, isn't cached by default, and retrying it may duplicate the action.

### [L1 · conceptual] What does idempotent mean for HTTP methods? Which methods are idempotent?

Performing the request multiple times has the same effect on server state as performing it once. GET, HEAD, OPTIONS, PUT and DELETE are idempotent; POST and PATCH are not (by default). Idempotency is what makes automatic retries safe.

### [L2 · compare] Explain 502, 503 and 504.

All come from a server or proxy. 502 Bad Gateway: a proxy received an invalid response from the upstream (crashed, closed connection, malformed). 503 Service Unavailable: the server is temporarily unable to handle the request (overloaded, maintenance), often with Retry-After. 504 Gateway Timeout: a proxy didn't get a response from the upstream in time.

### [L2 · compare] 301 vs 302 vs 307/308?

301 (permanent) and 302 (temporary) redirects historically allowed clients to change POST to GET on the redirected request. 307 (temporary) and 308 (permanent) require the client to repeat the same method and body. 301/308 are cacheable and tell search engines to update links.

### [L3 · design] How would you make a POST /payments endpoint safe to retry?

Require an Idempotency-Key header (a client-generated UUID per logical operation). On first receipt, atomically record the key with a "processing" status (unique constraint), perform the payment, and store the resulting response. On retries with the same key, return the stored response instead of charging again; if still processing, return 409 or wait. Keys expire after a retention window; the key must be scoped to the client and request parameters (reject mismatched bodies).

## Practice

### [mcq] Which status code should an API return after successfully creating a resource?

- [ ] 200 OK
- [x] 201 Created (with a Location header)
- [ ] 202 Accepted
- [ ] 204 No Content

201 signals creation; 202 means accepted for asynchronous processing.

### [mcq] A user is logged in but tries to access another user's private document. Which status code fits?

- [ ] 401
- [x] 403
- [ ] 404 is never acceptable here
- [ ] 409

Authenticated but not authorized. (Some APIs return 404 to avoid revealing existence — a deliberate choice.)

## Quick Revision

- Stateless request/response: method + URL + headers + body → status + headers + body.
- Safe: GET/HEAD/OPTIONS. Idempotent: + PUT, DELETE. Not: POST, PATCH → idempotency keys.
- 2xx success, 3xx redirect (304 = revalidated), 4xx client (401 vs 403, 429), 5xx server (502/503/504).
- Key headers: Host, Content-Type/Length, Accept*, Authorization, Cookie, Cache-Control/ETag, Location, Retry-After.
- Content negotiation + compression (gzip/br) + `Vary`.
