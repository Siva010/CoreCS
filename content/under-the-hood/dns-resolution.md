---
title: "What Happens When a Name Is Resolved"
summary: "getaddrinfo(\"shop.example.com\") from the application through the stub resolver, caches, the recursive resolver's walk from the root to the authoritative servers, CNAMEs to a CDN, and the TTLs that decide when it all happens again."
subjects: [cn]
order: 8
related: [cn-dns-fundamentals, cn-dns-records, cn-cdn, cn-udp, cn-bgp-anycast]
---

A browser (or any program) needs the IP address of `shop.example.com`.

## [app] getaddrinfo()

The application calls `getaddrinfo("shop.example.com", "443", …)` (browsers use their own resolver with a cache, but the path is similar). Nothing is known yet.

## [kernel] Local sources first

The system's stub resolver checks `/etc/hosts` (per `/etc/nsswitch.conf`), then a local caching daemon if present (systemd-resolved, nscd, dnsmasq). Cache hit → done in microseconds.

## [dns] Query the recursive resolver

Cache miss: the stub sends a UDP query (port 53, or DNS-over-HTTPS/TLS) to the configured recursive resolver — the ISP's, a corporate one, or a public one like 1.1.1.1 — asking for A and AAAA records ([UDP](lesson:cn-udp)). The resolver checks its own cache (shared by many clients, so popular names are usually cached).

## [dns] Ask a root server

On a miss, the resolver asks a root server (anycast addresses — many physical servers share each IP; [BGP & Anycast](lesson:cn-bgp-anycast)): "shop.example.com?". The root doesn't know, but refers it to the `.com` TLD servers (NS records plus their addresses, "glue"). Root and TLD referrals are almost always cached.

## [dns] Ask the TLD servers

The `.com` servers answer with a referral to `example.com`'s authoritative name servers (e.g., `ns1.dnsprovider.net`).

## [dns] Ask the authoritative server

The authoritative server answers: `shop.example.com CNAME shop.example.com.cdn-edge.net` (TTL 3600). The resolver follows the CNAME, resolving `cdn-edge.net`'s authoritative servers, which return an A record chosen for the resolver's location (geo-DNS), TTL 20 ([DNS Records](lesson:cn-dns-records), [CDN](lesson:cn-cdn)).

## [dns] Cache and return

The resolver caches each answer for its TTL (and negative answers for the SOA's negative TTL) and returns the final addresses to the stub, which caches them and hands `getaddrinfo` a list of addresses (IPv6 and IPv4, ordered by preference).

## [app] Connect — and do it again later

The application connects to one of the addresses ([TCP Connect](uth:tcp-connect)), trying others on failure (Happy Eyeballs races IPv6 and IPv4). When the 20-second TTL expires, the next lookup goes back to the resolver — which is how CDNs steer traffic quickly, and why low TTLs increase DNS load and latency ([DNS](lesson:cn-dns-fundamentals)).
