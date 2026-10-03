---
title: "BGP and Anycast: How the Internet Routes Between Networks"
subject: cn
level: 11
order: 1
summary: "Autonomous systems, how BGP announces prefixes and chooses paths by policy, why BGP incidents take down large parts of the internet, and how anycast serves one IP from many places."
depth: senior
difficulty: 4
minutes: 35
relevance: low
stage: 4
prerequisites: [cn-routing]
related: [cn-cdn, cn-dns-fundamentals, cn-proxies-load-balancers, cn-http3-quic]
tags: [bgp, autonomous system, asn, path vector, as path, peering, transit, route hijack, route leak, rpki, anycast, ecmp, ddos]
---

## Mental Model

The internet is a **federation of ~75,000 independently operated networks** — ISPs, clouds, universities, enterprises — called **autonomous systems (ASes)**. BGP is the protocol they use to tell each other "**I can reach these address prefixes, via this path of ASes**". Each network decides by its own **policy** (money, contracts, preferences) which routes to accept and which to advertise. There's no central authority checking the claims — which is why a single misconfigured announcement can reroute or black-hole traffic for large parts of the internet.

**Anycast** is a clever use of this: announce the **same prefix from many locations**, and BGP naturally delivers each user's packets to a nearby location.

## Definition

- **Autonomous system (AS)**: a network under one administrative control with a unified routing policy, identified by an **ASN** (e.g., AS15169 Google, AS13335 Cloudflare).
- **BGP (Border Gateway Protocol, v4)**: the path-vector inter-domain routing protocol. **eBGP** between ASes; **iBGP** within an AS to distribute external routes.
- **Route announcement**: "prefix P reachable via AS path [A, B, C]".
- **Anycast**: the same IP prefix announced from multiple sites; routing delivers packets to one of them (typically the "closest" in BGP terms).

## Why It Exists

Inside one organization, IGPs (OSPF, IS-IS) compute shortest paths over a known topology ([Routing](lesson:cn-routing)). Between organizations, topology is private, business relationships matter more than distance, and the system must scale to ~1 million prefixes. BGP exchanges reachability plus attributes and lets each AS apply policy.

## How It Works

### Announcements and path selection

1. An AS originates its prefixes (e.g., `203.0.113.0/24` from AS64500).
2. Neighbors receive the route with AS path `[64500]`, prepend themselves when re-advertising: `[64501, 64500]`, and so on.
3. The AS path prevents loops (a router rejects routes containing its own ASN).
4. Each router selects the best route per prefix by an ordered list of attributes — roughly: highest **local preference** (policy), shortest **AS path**, origin type, lowest **MED** (neighbor's hint), eBGP over iBGP, lowest IGP cost to the exit, then tiebreakers.
5. The best route goes into the forwarding table; forwarding still uses **longest-prefix match** — a more specific /24 beats a /16 regardless of path.

### Business relationships shape routes

- **Transit**: a customer pays a provider to reach the whole internet.
- **Peering**: two networks exchange traffic for their own customers, often settlement-free, at internet exchange points (IXPs) or private interconnects.
- Networks prefer routes learned from customers (they get paid) over peers over providers (they pay) — so the path your packets take is shaped by economics, not just distance.

### Anycast

The same prefix (say `1.1.1.0/24`) is announced from 300 cities. Each network's BGP picks the "best" (usually nearest in AS hops/IGP cost) announcement, so users in Frankfurt reach the Frankfurt site and users in Tokyo reach Tokyo — **one IP, many servers**.

Used for:

- **DNS**: root servers, TLDs, public resolvers (8.8.8.8, 1.1.1.1) ([DNS](lesson:cn-dns-fundamentals)).
- **CDNs and edge networks**: route users to nearby PoPs ([CDN](lesson:cn-cdn)).
- **DDoS absorption**: attack traffic is spread across all sites instead of concentrating on one.
- **L4 load balancers**: within a data center, many LB servers announce the same VIP; routers ECMP-hash flows across them ([Proxies & Load Balancers](lesson:cn-proxies-load-balancers)).

Caveat: if routing changes mid-connection, packets may land on a different site that has no state for the TCP connection → resets. Anycast suits short/stateless interactions (DNS over UDP) best; CDNs mitigate with stable routing and connection handoff; QUIC connection IDs help.

## Internal Mechanism

:::depth{level=senior}
### Why BGP incidents are so disruptive

- **Route hijack**: an AS announces a prefix it doesn't own (or a more-specific of it); longest-prefix match pulls traffic toward it (e.g., Pakistan Telecom accidentally hijacked YouTube's prefix globally in 2008 by announcing a more-specific /24).
- **Route leak**: an AS re-advertises routes it shouldn't (e.g., routes learned from one provider to another), turning itself into unintended transit and congesting paths.
- **Withdrawal outages**: an AS withdraws its own routes (the 2021 Facebook outage: a configuration change withdrew the routes to Facebook's DNS servers, making its domains unresolvable worldwide and locking engineers out of internal tools).
- Convergence after changes can take seconds to minutes; flapping routes are dampened.

Defenses: **RPKI** (cryptographically signed Route Origin Authorizations; routers drop RPKI-invalid announcements — Route Origin Validation), prefix filtering on customer sessions, max-prefix limits, IRR-based filters, and BGPsec/ASPA for path validation (limited deployment).
:::

## Example

```bash
$ whois -h whois.cymru.com " -v 1.1.1.1"
AS      | IP       | BGP Prefix  | CC | Registry | Allocated  | AS Name
13335   | 1.1.1.1  | 1.1.1.0/24  | US | arin     | 2010-07-14 | CLOUDFLARENET
$ traceroute 1.1.1.1      # from different cities you'd reach different anycast sites in a few hops
```

Public looking-glass servers and tools like bgp.he.net or RIPEstat show which ASes announce a prefix and the AS paths seen worldwide.

## Complexity & Performance

- Global routing table: ~1M IPv4 and ~200K+ IPv6 prefixes; routers need significant memory/TCAM.
- BGP chooses by policy and AS-path length, not latency — paths can be geographically suboptimal ("tromboning").

## Trade-offs

- Policy-based routing gives operators control and business alignment vs suboptimal paths and slow convergence.
- Anycast gives proximity and resilience vs mid-connection route changes and harder debugging (which site answered?).

## Failure Modes

- Hijacks and leaks redirecting or black-holing traffic.
- Self-inflicted withdrawals (config pushes) causing total outages, especially when DNS and management access depend on the same routes.
- Anycast site overload when routing shifts a large region's traffic to one site.

## In Production

- Clouds and CDNs operate large anycast networks; enterprises use BGP for multi-homing (two ISPs) and to announce their own address space.
- Kubernetes: Calico and MetalLB can use BGP to advertise pod and service IPs to data-center routers ([Container Networking](lesson:cn-container-networking)).

## Deeper Connections

- Longest-prefix match and intra-domain routing: [Routing](lesson:cn-routing). Anycast front ends for DNS and CDNs: [DNS](lesson:cn-dns-fundamentals), [CDN](lesson:cn-cdn).

## Common Misconceptions

- **"The internet routes over the shortest path."** It routes by policy and AS-path length.
- **"BGP announcements are verified."** Largely trust-based; RPKI adoption is growing but incomplete.
- **"Anycast means load balancing across all sites."** It routes each user to one (usually nearby) site; load follows routing, not server load.

## Interview Questions

### [L2 · conceptual] What is BGP and why is it needed?

BGP is the inter-domain routing protocol by which autonomous systems announce which IP prefixes they can reach and via which AS paths. It's needed because the internet is made of independently managed networks with private topologies and business policies; BGP lets each exchange reachability and choose routes by policy, scaling to around a million prefixes.

### [L3 · conceptual] What is anycast and where is it used?

Announcing the same IP prefix from multiple locations so routers deliver each client's packets to one of them, typically the nearest by routing metrics. Used by DNS root and public resolvers, CDNs, DDoS mitigation networks and L4 load balancer fleets. Best for short-lived/stateless traffic since route changes can shift a connection to another site.

### [L4 · incident] A company's entire online presence disappears after a routine network change: its websites and even its internal tools are unreachable. What might have happened and how could the blast radius be reduced?

A BGP change withdrew (or failed to announce) the prefixes containing the company's authoritative DNS servers and services, so the world lost routes to them; DNS answers expired from caches, making domains unresolvable, and internal tools and remote access depended on the same network and DNS. Reduce blast radius with staged/canaried network config changes with automatic rollback, audit tooling that blocks withdrawing critical prefixes, DNS hosted on independent infrastructure (secondary providers), and out-of-band management access that doesn't depend on production routing or DNS.

## Practice

### [mcq] Two routes to 198.51.100.0/24 are learned: one with AS path length 2 but local preference 100, another with AS path length 4 and local preference 200. Which does BGP prefer?

- [ ] The shorter AS path
- [x] The higher local preference
- [ ] The one learned first
- [ ] It load-balances equally

Local preference (policy) is evaluated before AS path length.

### [mcq] Which mechanism cryptographically validates that an AS is authorized to originate a prefix?

- [ ] DNSSEC
- [x] RPKI Route Origin Validation
- [ ] TLS certificates
- [ ] OSPF authentication

RPKI ROAs bind prefixes to authorized origin ASNs.

## Quick Revision

- Internet = ~75K ASes; BGP (path vector) announces prefixes with AS paths; loops prevented by AS path.
- Best path by policy first (local pref), then AS-path length, MED, etc.; forwarding still uses longest-prefix match.
- Transit vs peering; economics shape routes.
- Anycast: same prefix from many sites → nearest site; DNS, CDNs, DDoS, LB VIPs; mid-connection shifts possible.
- Hijacks, leaks, withdrawals → big outages; RPKI and filtering defend.
