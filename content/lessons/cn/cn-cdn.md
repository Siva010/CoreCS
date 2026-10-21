---
title: "CDNs and Edge Networks: Serving Content From Near the User"
subject: cn
level: 9
order: 5
summary: "How a CDN routes users to a nearby edge, what edges cache and why, cache keys and hit ratios, tiered caching and origin shielding, invalidation, and what edges do beyond caching."
depth: core
difficulty: 3
minutes: 35
relevance: high
stage: 3
prerequisites: [cn-http-caching, cn-proxies-load-balancers, cn-dns-records]
related: [cn-bgp-anycast, cn-latency-bandwidth, cn-tls-handshake, x-caching-everywhere]
labs: [http-cache]
tags: [cdn, edge, pop, cache hit ratio, cache key, origin shield, tiered caching, purge, invalidation, anycast, geodns, edge compute, ddos protection, stale-while-revalidate]
---

## Mental Model

Physics sets a floor on latency: a round trip from Mumbai to a server in Virginia takes ~200 ms no matter how fast the server is. A **CDN** puts **copies of your content (and a TLS endpoint) in hundreds of cities**. Users talk to the nearest **point of presence (PoP)**, which answers from its cache or fetches once from your **origin** and remembers.

The handshake and the bytes travel a few milliseconds instead of hundreds, and your origin serves a small fraction of the traffic.

## Definition

- **CDN (content delivery network)**: a globally distributed network of reverse-proxy caches (edge servers) in PoPs, fronting one or more origins.
- **Origin**: your authoritative server/storage.
- **Cache hit ratio**: fraction of requests (or bytes) served from edge caches.
- **Cache key**: what the edge uses to identify cached objects (default: scheme + host + path + query; configurable to include headers, cookies, device class).
- **Origin shield / tiered caching**: an intermediate cache layer so that edge misses go to a regional tier rather than all hitting the origin.
- **Purge / invalidation**: removing cached content before it expires.

## Why It Exists

**The problem.** Light in fiber takes ~100 ms to cross half the planet and back, and an HTTPS page load needs several round trips. Users far from your servers wait seconds no matter how fast the servers are.

**The idea.** You can't make light faster, so shorten the distance: keep copies of your content — and a place to finish TLS handshakes — near every user. Only the first request in each region has to travel all the way to your origin.

- **Latency**: shorter RTTs for TCP/TLS handshakes and every request (see [Latency & Bandwidth](lesson:cn-latency-bandwidth)).
- **Offload**: absorb read traffic (often 90%+ of bytes for static-heavy sites).
- **Resilience and security**: absorb traffic spikes and DDoS attacks at a network far larger than yours; WAF rules at the edge.

:::callout[That's all it is]{type=insight}
A CDN is a worldwide set of HTTP caches. Users are sent to the nearest one; it answers from its copy or fetches once from your origin and keeps it. Your cache headers decide what it may keep and for how long.
:::

## How It Works

### Getting the user to a nearby edge

- **Anycast**: the same IP is announced from every PoP via BGP; the internet's routing delivers users to a nearby PoP ([BGP & Anycast](lesson:cn-bgp-anycast)).
- **DNS steering**: your `www` CNAMEs to the CDN, whose GeoDNS returns a nearby PoP's IPs based on the resolver's location ([DNS Records](lesson:cn-dns-records)).

### Request flow

```mermaid
flowchart TD
    U["User in Mumbai"] -->|"~5 ms"| E["Edge PoP Mumbai"]
    E -->|"hit"| U
    E -->|"miss"| S["Shield tier (Singapore)"]
    S -->|"hit"| E
    S -->|"miss, ~200 ms"| O["Origin (Virginia)"]
    O --> S --> E
```

1. TLS terminates at the edge (fast handshake — short RTT).
2. The edge looks up the cache key: **hit** → respond immediately; **miss** → forward to the shield or origin (over a warm, reused connection), store if cacheable per headers, respond.
3. Many concurrent misses for the same object are **coalesced** into one origin fetch (request collapsing), avoiding stampedes.

### What controls caching

The origin's headers ([HTTP Caching](lesson:cn-http-caching)): `Cache-Control: public, s-maxage=…`, `stale-while-revalidate`, `Vary`, validators — plus CDN configuration overrides (cache rules, TTLs by path, ignoring query strings, cookie handling). Typical split:

- Fingerprinted static assets: cached for a year, never purged.
- HTML: short TTL or revalidated; purged on deploy.
- API GETs that are the same for everyone (product catalog, prices updated every minute): short `s-maxage` + `stale-while-revalidate`.
- Personalized/authenticated responses: **bypass** (or carefully keyed).

### Invalidation

Copies in hundreds of cities make "change the content" hard: every copy must be found or made irrelevant.

- **Versioned URLs** (best): new content → new URL, nothing to purge.
- **Purge by URL/prefix**: propagates across PoPs in seconds.
- **Surrogate keys / cache tags**: tag responses (`Surrogate-Key: product-123 category-9`) and purge everything tagged at once when a product changes.

### Beyond static caching

TLS termination and HTTP/3, image/video optimization, WAF and bot mitigation, rate limiting, DDoS absorption, and **edge compute** (running small functions at PoPs: auth checks, redirects, A/B routing, personalization of cached pages).

## Internal Mechanism

:::depth{level=advanced}
### Hit ratio economics

A small drop in hit ratio can multiply origin load: at 99% hits, origin sees 1% of requests; at 95%, 5× more. Cache-key fragmentation (random query parameters like tracking IDs, `Vary: User-Agent`, cookies in the key) is the usual culprit — normalize keys (strip irrelevant params, sort query strings). Long-tail content (millions of rarely requested objects) naturally misses at individual edges; tiered caching concentrates those misses into shield caches with larger effective capacity.

### Consistency

A CDN is an eventually consistent cache: after an update, different PoPs may serve different versions until TTLs expire or purges propagate. Design for it: versioned assets, short TTLs where freshness matters, and never rely on the CDN for strongly consistent reads.
:::

## Example

Response headers revealing CDN behavior (names vary by provider):

```http
HTTP/2 200
cache-control: public, max-age=31536000, immutable
age: 48213                 ← seconds this copy has been in a cache
x-cache: HIT
cf-cache-status: HIT       ← (Cloudflare) / x-served-by, x-amz-cf-pop (other CDNs)
```

## Visualization

The HTTP caching lab models how an edge decides between a fresh hit, a revalidation and a miss:

::lab{id=http-cache}

## Complexity & Performance

- Edge hit: ~RTT to the nearest PoP (single-digit to tens of ms). Miss: + edge→origin RTT (warm connections help).
- Offload: origin capacity sized for misses, not total traffic — but must survive cache flushes and cold starts.

## Trade-offs

- Long TTLs: offload and speed vs staleness (solve with versioning/purges).
- Edge compute: latency and offload vs debugging complexity and vendor lock-in.
- Single CDN simplicity vs multi-CDN resilience (CDN outages happen and take large parts of the web down).

## Failure Modes

- Caching private/personalized content in shared caches → data leaks.
- Cache-key fragmentation → low hit ratio → origin overload.
- Global purge or cold cache (new CDN config) → origin stampede.
- CDN outage → your site down with it (mitigate with multi-CDN or origin failover).
- Stale content after deploys from forgotten non-versioned assets.

## In Production

- Monitor hit ratio (requests and bytes), origin request rate, edge error rates (5xx from origin vs edge), and TTFB by region.
- Protect origins: allow only CDN IP ranges or authenticated origin pulls, so attackers can't bypass the edge.

## Deeper Connections

- Anycast routing: [BGP & Anycast](lesson:cn-bgp-anycast). Edge TLS and HTTP/3: [TLS Handshake](lesson:cn-tls-handshake), [HTTP/3 & QUIC](lesson:cn-http3-quic). The general caching trade-offs: [Caching Everywhere](lesson:x-caching-everywhere).

## Common Misconceptions

- **"CDNs are only for static files."** They also accelerate dynamic traffic (TLS near users, warm origin connections, route optimization) and cache many API responses.
- **"Purging is instant everywhere."** It propagates quickly but not atomically; design for eventual consistency.

## Interview Questions

### [L1 · conceptual] What is a CDN and why use one?

A globally distributed network of edge servers that cache and serve content close to users. It reduces latency (shorter round trips for handshakes and data), offloads traffic from origin servers, absorbs spikes and DDoS attacks, and provides edge features like TLS termination, WAF and image optimization.

### [L2 · how] How does a user get routed to a nearby CDN edge?

Typically via DNS (the site CNAMEs to the CDN, whose authoritative DNS returns IPs of a nearby PoP based on the resolver's location) and/or anycast (the same IP announced from all PoPs, so BGP routing delivers packets to a nearby one).

### [L2 · how] How do you update content that's cached at a CDN?

Prefer versioned (fingerprinted) URLs so new content has new URLs and old caches don't matter. Otherwise, purge by URL/prefix or by surrogate keys/cache tags, or rely on short TTLs with revalidation for content that changes often.

### [L3 · debugging] After a marketing campaign launch, the origin is overloaded even though the CDN is in front. What would you check?

Cache hit ratio and why requests miss: campaign URLs with unique tracking query parameters fragmenting the cache key, responses marked uncacheable (Set-Cookie, `private`, no-store), `Vary` on high-cardinality headers, very short TTLs, a recent purge, or uncached API endpoints the landing page calls. Fix with cache-key normalization, correct cache headers, origin shielding and request coalescing.

### [L2 · numerical] Why does a small drop in cache hit ratio hurt the origin so much?

The origin only sees misses. At a 99% hit ratio it serves 1% of requests; at 95% it serves 5%, five times as much, even though the hit ratio "only" fell four points. Capacity planning for the origin must assume the worst hit ratio it will see, for example right after a purge or a deploy that changes cache keys.

### [L2 · how] How do surrogate keys (cache tags) make invalidation practical?

The origin labels each response with the entities it contains (`Surrogate-Key: product-123 category-9`). When product 123 changes, one purge by tag removes every cached page that showed it: the product page, category listings, search results. Without tags you would need to know every URL that includes the product, or purge far too much.

## Practice

### [mcq] Which technique reduces the number of requests reaching the origin when many edge PoPs miss on the same object?

- [ ] Shorter TTLs
- [x] Tiered caching / origin shield (plus request coalescing)
- [ ] Vary: User-Agent
- [ ] Disabling HTTP/2

A shield layer consolidates misses before the origin.

### [mcq] What is the most robust way to deploy new versions of JS/CSS behind a CDN?

- [ ] Purge everything on each deploy
- [x] Content-hashed filenames with long-lived immutable caching
- [ ] Set max-age=0 on assets
- [ ] Disable the CDN during deploys

New content → new URL; nothing stale can be served.

### [numeric 5] A CDN's hit ratio falls from 99% to 95%. By what factor does the request rate reaching the origin grow?

:::answer
Misses go from 1% to 5% of requests: the origin sees **5** times as many requests.
:::

### [numeric 2000 unit=requests/s] A site receives 100,000 requests per second at the edge with a 98% hit ratio. How many requests per second reach the origin (without shielding)?

:::answer
2% of 100,000 = **2,000** per second. A shield tier and request collapsing reduce it further, since many edges missing on the same object turn into one origin fetch.
:::

### [mcq] Many URLs differ only by tracking parameters (`?utm_source=…`), and the CDN's hit ratio is poor. What fixes it best?

- [ ] A longer max-age
- [ ] Purging the cache more often
- [x] Normalizing the cache key: ignore or strip parameters that don't change the response
- [ ] Turning off compression

Each distinct URL is a separate cache entry, so tracking parameters fragment the cache. Excluding them from the cache key lets all the variants share one copy.

### [exercise] Using the [HTTP caching simulator](lab:http-cache), configure the response headers you would use for (a) fingerprinted JS files, (b) the HTML page that references them, and (c) a product-list API that changes every minute and is the same for every user. Explain how each behaves at the CDN after a deploy.

:::solution
- **(a) `/assets/app.3f9a1c.js`:** `Cache-Control: public, max-age=31536000, immutable`. Cached for a year at the edge and in browsers. A deploy produces new file names, so nothing needs purging, and the old files simply stop being requested.
- **(b) `/index.html`:** `Cache-Control: no-cache` with an ETag (or a short `s-maxage` plus a purge on deploy). Every request revalidates, usually getting a cheap 304, so the new HTML, pointing at the new asset names, is seen at once.
- **(c) `/api/products`:** `Cache-Control: public, s-maxage=60, stale-while-revalidate=60`. The CDN serves it for a minute and refreshes in the background, so users never wait for the origin, and data is at most about two minutes old. Browsers can be kept out with `max-age=0`.

After a deploy, (a) and (c) need no action, and (b) switches over immediately.
:::

## Quick Revision

- Edge PoPs near users; reached via anycast and/or GeoDNS.
- Hit → serve locally; miss → shield → origin; request coalescing prevents stampedes.
- Controlled by Cache-Control (s-maxage, stale-while-revalidate), Vary, CDN rules; cache key normalization drives hit ratio.
- Invalidate via versioned URLs (best), purges, surrogate keys.
- Also: TLS/HTTP3 at edge, WAF, DDoS absorption, edge compute. Eventually consistent; never cache private data.
- Origin load = (1 − hit ratio) × edge traffic (99% → 95% = 5× origin load). Normalize cache keys; purge by surrogate key; version static assets.
