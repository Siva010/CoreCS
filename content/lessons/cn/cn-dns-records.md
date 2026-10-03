---
title: "DNS Records and Operations: A, AAAA, CNAME, MX, TXT, NS, SRV — and How DNS Fails"
subject: cn
level: 6
order: 2
summary: "The record types you'll actually use, CNAME rules and the apex problem, DNS-based load balancing and failover, and the operational failure modes behind real outages."
depth: core
difficulty: 3
minutes: 35
relevance: high
stage: 2
prerequisites: [cn-dns-fundamentals]
related: [cn-cdn, cn-service-networking, cn-certificates-pki, cn-bgp-anycast]
visualizations: [dns-resolver]
tags: [a record, aaaa record, cname, mx, txt, ns, soa, srv, ptr, caa, alias, apex, dns load balancing, geodns, spf, dkim, dmarc, reverse dns]
---

## Mental Model

A DNS zone is a small **key-value table** where the key is (name, type) and the value is a list of records, each with a TTL. Different record **types** answer different questions: *what's the IPv4 address?* (A), *what's the IPv6 address?* (AAAA), *what's this really called?* (CNAME), *where does mail go?* (MX), *who's in charge of this zone?* (NS), *what else should I know?* (TXT).

## Definition

| Type | Maps a name to | Example |
|---|---|---|
| **A** | IPv4 address | `www IN A 93.184.215.14` |
| **AAAA** | IPv6 address | `www IN AAAA 2606:2800:21f:cb07::1` |
| **CNAME** | Another name (canonical name / alias) | `www IN CNAME example.cdnprovider.net.` |
| **MX** | Mail servers with priorities | `@ IN MX 10 mx1.example.com.` |
| **NS** | Authoritative name servers for a zone (delegation) | `@ IN NS ns1.example-dns.net.` |
| **SOA** | Zone metadata: primary server, admin, serial, refresh/retry/expire, negative-cache TTL | one per zone |
| **TXT** | Arbitrary text | SPF, DKIM, DMARC, domain verification tokens |
| **SRV** | Service host + port + priority/weight | `_sip._tcp IN SRV 10 60 5060 sip1.example.com.` |
| **PTR** | Reverse DNS: IP → name | `14.215.184.93.in-addr.arpa. IN PTR www.example.com.` |
| **CAA** | Which CAs may issue certificates | `@ IN CAA 0 issue "letsencrypt.org"` |

## Why It Exists

Different protocols need different lookups: browsers need addresses, mail servers need to know where to deliver mail, certificate authorities need to check issuance policy, service discovery needs ports. One extensible system of typed records serves them all.

## How It Works

### CNAME chains

```text
www.shop.com.          300  CNAME  shop.cdn-provider.net.
shop.cdn-provider.net.  60  CNAME  edge-eu.cdn-provider.net.
edge-eu.cdn-provider.net. 20 A    198.51.100.23
```

The resolver follows the chain and returns all records; each hop can have its own TTL (the shortest effectively bounds how long the full answer is valid). CNAMEs let a third party (a CDN, a SaaS host) change the final addresses without you touching your zone.

**CNAME rules:**

- A name with a CNAME **cannot have any other records** (no MX, TXT… at the same name).
- Therefore the **zone apex** (`example.com` itself, which must have SOA and NS records) **cannot be a CNAME**. Providers work around this with proprietary **ALIAS/ANAME/"CNAME flattening"** records that resolve the target server-side and return A/AAAA answers; the newer standard **HTTPS/SVCB** records also help.
- CNAME chains add lookups (latency) and dependencies.

### DNS-based load balancing and failover

- **Multiple A records**: the resolver returns a list; clients usually try the first and may fall back to others. Order is often rotated (round-robin DNS). Crude: no health awareness unless the DNS provider removes dead IPs.
- **Health-checked failover**: the authoritative provider stops returning unhealthy endpoints — effective only as fast as TTLs expire.
- **GeoDNS / latency-based routing**: answers depend on the resolver's location (or EDNS Client Subnet) — how CDNs and global services direct users to nearby PoPs ([CDN](lesson:cn-cdn)).
- **Weighted records**: canary/blue-green traffic shifting (e.g., 5% to the new stack).

Limitations: clients cache beyond TTL, resolvers aggregate many users (a large resolver can send a whole city to one IP), and DNS can't see per-request load. Anycast and load balancers complement it ([BGP & Anycast](lesson:cn-bgp-anycast)).

### Email records in one paragraph

**MX** points to mail servers (lower preference number = tried first). **SPF** (TXT) lists servers allowed to send mail for the domain; **DKIM** (TXT) publishes public keys verifying message signatures; **DMARC** (TXT at `_dmarc`) tells receivers what to do with mail failing SPF/DKIM alignment. Misconfigured records send your mail to spam.

::viz{id=dns-resolver}

## Internal Mechanism

:::depth{level=advanced}
### Delegation and lame delegations

The parent zone (e.g., `.com`) holds NS records (and glue) pointing to your authoritative servers; your zone should hold matching NS records. When they disagree or point to servers that don't serve the zone (**lame delegation**) — common after switching DNS providers without updating the registrar — some resolvers succeed and others fail, producing confusing partial outages. Changing providers safely: add the new provider's records, verify it serves the full zone, update NS at the registrar, keep the old provider serving until the parent's NS TTL (often 1–2 days) expires.

### SRV and service discovery

SRV records carry ports and weights, enabling clients to discover `host:port` pairs (`_http._tcp.service.namespace.svc.cluster.local` in Kubernetes, Consul DNS). Many HTTP clients don't use SRV, so service meshes and client-side discovery libraries often use other mechanisms ([Service Networking](lesson:cn-service-networking)).
:::

## Example

```bash
$ dig example.com MX +short
10 mx1.example.com.
20 mx2.example.com.
$ dig _dmarc.example.com TXT +short
"v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com"
$ dig -x 8.8.8.8 +short              # reverse lookup (PTR)
dns.google.
$ dig www.github.com +short          # CNAME chain then A
github.com.
140.82.112.3
```

## Complexity & Performance

- Each CNAME hop may cost an extra resolution if not cached.
- DNS-based steering reacts at the speed of TTLs (tens of seconds to minutes), not per request.

## Trade-offs

- CNAME to third parties: flexibility and delegation of operations vs extra lookups and dependency on their DNS.
- DNS load balancing: simple, global, cheap vs coarse, cache-bound, health-unaware without provider features.

## Failure Modes

- CNAME at the apex (rejected by providers or breaks MX/TXT).
- Registrar NS mismatch / lame delegation after provider migration.
- Expired domain registrations (surprisingly common real outages).
- Accidentally deleting or mistyping records during changes; negative caching prolongs the damage.
- Missing CAA or incorrect CAA blocking certificate renewal ([Certificates](lesson:cn-certificates-pki)).
- Mail rejection from missing SPF/DKIM/DMARC.

## In Production

- Manage DNS as code (Terraform, OctoDNS) with review; low TTLs during changes.
- Use provider health checks + low TTL for failover, but prefer load balancers/anycast for fast failover.
- Monitor certificate issuance dependencies (CAA) and domain expiration.

## Deeper Connections

- CDNs rely on CNAMEs + GeoDNS ([CDN](lesson:cn-cdn)); Kubernetes service discovery is DNS ([Service Networking](lesson:cn-service-networking)); ACME DNS-01 challenges use TXT records ([Certificates](lesson:cn-certificates-pki)).

## Common Misconceptions

- **"CNAME redirects HTTP traffic."** It only aliases names at the DNS level; HTTP `Host` headers still carry the original name.
- **"Multiple A records give real load balancing."** They give coarse distribution without health checks or load awareness.
- **"You can put a CNAME on example.com."** Not standards-compliant at the apex.

## Interview Questions

### [L1 · compare] A vs AAAA vs CNAME records?

An A record maps a name to an IPv4 address, AAAA to an IPv6 address, and CNAME maps a name to another (canonical) name, which the resolver then resolves further.

### [L2 · why] Why can't you put a CNAME record at the zone apex?

A CNAME must be the only record at its name, but the apex must have SOA and NS records (and usually MX/TXT). DNS providers offer ALIAS/ANAME or CNAME flattening, resolving the target server-side and returning A/AAAA records instead.

### [L2 · how] How can DNS be used for load balancing, and what are its limitations?

By returning multiple A/AAAA records (round-robin), weighted answers, geographic or latency-based answers, and removing unhealthy endpoints with health checks. Limitations: changes propagate only as fast as TTLs (and clients may cache longer), resolvers aggregate many users, answers can't reflect real-time load, and clients may not fail over across returned IPs gracefully.

### [L3 · incident] After migrating DNS to a new provider, some users can't resolve the domain while others can. What happened?

Likely an inconsistent delegation: the registrar/TLD NS records still point to the old provider (or a mix), and resolvers with different cached NS sets query different servers — some of which no longer serve the zone or serve a different version. Fix: ensure the parent NS records match the new provider, keep the old provider serving an identical zone until NS TTLs (often 48 h) expire, and verify with `dig +trace` from multiple resolvers.

## Practice

### [mcq] Which record type tells other mail servers where to deliver email for a domain?

- [ ] TXT
- [x] MX
- [ ] SRV
- [ ] PTR

MX records list mail exchangers with priorities.

### [mcq] Which record type is used for reverse DNS (IP to name)?

- [ ] CNAME
- [ ] A
- [x] PTR
- [ ] NS

PTR records live under in-addr.arpa (IPv4) and ip6.arpa (IPv6).

## Quick Revision

- A (IPv4), AAAA (IPv6), CNAME (alias; exclusive at its name; not at apex → ALIAS/flattening), MX (mail), NS (delegation), SOA (zone meta + negative TTL), TXT (SPF/DKIM/DMARC, verification), SRV (host+port), PTR (reverse), CAA (allowed CAs).
- DNS load balancing: multiple A, weighted, GeoDNS, health-checked — TTL-bound and coarse.
- Provider migrations: registrar NS + overlap for NS TTL; lame delegation = partial outages.
