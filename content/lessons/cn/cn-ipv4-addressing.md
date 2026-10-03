---
title: "IPv4 Addressing: Networks, Hosts, CIDR and Special Addresses"
subject: cn
level: 3
order: 1
summary: "What an IP address encodes, how a prefix length splits network from host, network and broadcast addresses, private vs public ranges, and why classful addressing died."
depth: beginner
difficulty: 2
minutes: 30
relevance: essential
stage: 1
prerequisites: [cn-arp-dhcp]
related: [cn-subnetting, cn-routing, cn-nat, cn-ipv6]
labs: [subnet-calculator]
tags: [ipv4, ip address, cidr, subnet mask, prefix length, network address, broadcast address, private ip, public ip, rfc 1918, loopback, classful addressing]
---

## Mental Model

An IPv4 address is like a phone number with an **area code**: the first part (the **network prefix**) says which network, the rest (the **host part**) says which machine on it. The **prefix length** (`/24`) says where the split is. Routers on the internet only care about area codes — they forward toward the network; the last hop delivers to the host.

Unlike phone numbers, the split point isn't fixed: `/8`, `/24` or `/29` are all valid, chosen to fit how many hosts a network needs. That flexibility is **CIDR**.

## Definition

- **IPv4 address**: a 32-bit number, written as four decimal octets: `192.168.10.37`.
- **Prefix length / CIDR notation**: `/n` means the first n bits are the network prefix. `192.168.10.37/24` → network `192.168.10.0`.
- **Subnet mask**: the prefix as a 32-bit mask of n ones: `/24` = `255.255.255.0`, `/26` = `255.255.255.192`.
- **Network address**: the address with all host bits 0 (identifies the network).
- **Broadcast address**: all host bits 1 (sends to every host on the subnet).
- **Usable hosts**: `2^(32−n) − 2` (excluding network and broadcast), except special cases `/31` (point-to-point, 2 usable) and `/32` (single host).

## Why It Exists

Routers can't hold a route for every one of ~4 billion addresses. Grouping addresses into **prefixes** lets a router store one entry per network — and **aggregate** many networks into one shorter prefix (the internet's routing table has ~1 million IPv4 prefixes, not billions of hosts).

## How It Works

### Binary is the whole trick

```text
192.168.10.37  = 11000000.10101000.00001010.00100101
/26 mask       = 11111111.11111111.11111111.11000000   (255.255.255.192)
network  (AND) = 11000000.10101000.00001010.00000000 = 192.168.10.0
broadcast      = 11000000.10101000.00001010.00111111 = 192.168.10.63
usable hosts   = 192.168.10.1 – 192.168.10.62  (2^6 − 2 = 62)
```

- **Network address** = IP AND mask.
- **Broadcast** = network OR (NOT mask).
- **Is B on my subnet?** `(A AND mask) == (B AND mask)` — exactly the test a host runs before deciding to ARP directly or send to the gateway.

### Common prefix sizes

| Prefix | Mask | Addresses | Usable hosts | Typical use |
|---|---|---|---|---|
| /8 | 255.0.0.0 | 16,777,216 | 16,777,214 | Huge private networks (10.0.0.0/8) |
| /16 | 255.255.0.0 | 65,536 | 65,534 | Cloud VPCs |
| /24 | 255.255.255.0 | 256 | 254 | Classic LAN / subnet |
| /26 | 255.255.255.192 | 64 | 62 | Small subnet |
| /28 | 255.255.255.240 | 16 | 14 | Tiny subnet (cloud subnets often reserve extra addresses) |
| /30 | 255.255.255.252 | 4 | 2 | Point-to-point (legacy) |
| /31 | 255.255.255.254 | 2 | 2 (RFC 3021) | Point-to-point links |
| /32 | 255.255.255.255 | 1 | 1 | A single host route |

### Special and private ranges

| Range | Meaning |
|---|---|
| `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` | **Private** (RFC 1918) — not routed on the public internet; reused everywhere behind NAT |
| `127.0.0.0/8` | **Loopback** (`127.0.0.1` = this host) |
| `169.254.0.0/16` | **Link-local** (self-assigned when DHCP fails; also cloud metadata `169.254.169.254`) |
| `100.64.0.0/10` | **Carrier-grade NAT** shared space (RFC 6598) |
| `0.0.0.0` | "This host / unspecified" (e.g., bind to all interfaces) |
| `255.255.255.255` | Limited broadcast |
| `224.0.0.0/4` | Multicast |

### Classful addressing (history)

Before 1993, the split was fixed by the first bits: Class A (`/8`, first bit 0), B (`/16`, first bits 10), C (`/24`, 110). It wasted addresses (an organization needing 300 hosts got a /16 of 65,536) and bloated routing tables. **CIDR** (Classless Inter-Domain Routing) replaced it with arbitrary prefix lengths and route aggregation. Interviewers still ask about classes — answer, then explain why they're obsolete.

::lab{id=subnet-calculator}

## Internal Mechanism

### Why IPv4 ran out

32 bits = ~4.3 billion addresses, minus reserved ranges. The regional internet registries exhausted their free pools between 2011 and 2019. The internet survived via **NAT** (many private hosts behind one public address — [NAT](lesson:cn-nat)), address markets (IPv4 addresses are bought and sold), and **IPv6** ([IPv6](lesson:cn-ipv6)).

:::depth{level=advanced}
### Route aggregation (supernetting)

Four /24s — `203.0.112.0/24`, `203.0.113.0/24`, `203.0.114.0/24`, `203.0.115.0/24` — share their first 22 bits and can be advertised as one route `203.0.112.0/22`. Aggregation keeps global routing tables manageable; deaggregation (announcing many more-specific prefixes, sometimes for traffic engineering or to defend against hijacks) grows them. Longest-prefix match ([Routing](lesson:cn-routing)) makes both coexist: the more specific route wins.
:::

## Example

A VPC plan for a cloud deployment: VPC `10.20.0.0/16` (65,536 addresses), carved into `/20` subnets (4,096 each) per availability zone and tier:

- `10.20.0.0/20` public AZ-a, `10.20.16.0/20` public AZ-b
- `10.20.32.0/20` private app AZ-a, `10.20.48.0/20` private app AZ-b
- `10.20.64.0/20` data AZ-a …

Leave room: Kubernetes pods often consume one IP each, and running out of subnet IPs is a real outage cause.

## Complexity & Performance

- Subnet membership is one AND and compare — trivial for hardware.
- Routing table lookups are longest-prefix matches over hundreds of thousands of prefixes, done in TCAM or trie structures at line rate.

## Trade-offs

- Larger subnets: fewer routes, more hosts per broadcast domain, more flexibility vs bigger failure/broadcast domains and wasted addresses.
- Private addressing + NAT: conserves public IPs vs breaks end-to-end reachability and complicates peer-to-peer.

## Failure Modes

- Overlapping private ranges between networks you later need to connect (VPC peering, VPNs, mergers) — a very common painful problem; plan ranges.
- Subnet exhaustion (especially with per-pod IPs in Kubernetes).
- Misconfigured masks → hosts think remote hosts are local (ARP fails) or local hosts are remote (traffic hairpins through the router).

## In Production

- Cloud subnets reserve a few addresses (AWS reserves 5 per subnet: network, router, DNS, future use, broadcast).
- Security groups and firewall rules are written as CIDRs; `0.0.0.0/0` means "anywhere" (the default route).

## Deeper Connections

- Subnet math drills: [Subnetting](lesson:cn-subnetting). Using prefixes to forward: [Routing](lesson:cn-routing).
- The same prefix/aggregation idea appears in consistent-hashing ranges and B-tree key ranges — splitting a key space hierarchically.

## Common Misconceptions

- **"192.168.x.x is a Class C network, so it's always /24."** Classes are obsolete; the prefix length is explicit.
- **"Private IPs can't reach the internet."** They can, through NAT; they just can't be reached directly from it.
- **"127.0.0.1 is the only loopback address."** The entire 127.0.0.0/8 block is loopback.

## Interview Questions

### [L1 · conceptual] What does /24 mean in 192.168.1.0/24?

It's the prefix length: the first 24 bits identify the network (mask 255.255.255.0), leaving 8 host bits → 256 addresses, of which 254 are usable (network 192.168.1.0 and broadcast 192.168.1.255 excluded).

### [L1 · compare] Public vs private IP addresses?

Public addresses are globally unique and routable on the internet. Private addresses (10/8, 172.16/12, 192.168/16) can be reused in any private network, aren't routed on the public internet, and reach it via NAT.

### [L2 · numerical] Given 10.1.37.200/21, find the network address, broadcast address and number of usable hosts.

/21 → mask 255.255.248.0; the third octet block size is 8. 37 falls in 32–39. Network **10.1.32.0**, broadcast **10.1.39.255**, usable hosts 2^11 − 2 = **2,046**.

### [L2 · why] Why was classful addressing replaced by CIDR?

Fixed class sizes wasted addresses (organizations needing a few hundred hosts got 65,536) and exhausted Class B space quickly, while countless Class C networks exploded routing tables. CIDR allows arbitrary prefix lengths (right-sized allocations) and aggregation of contiguous networks into single routes.

### [L3 · scenario] Two companies merge; both use 10.0.0.0/16 internally and must connect their networks. What are your options?

Overlapping ranges can't be routed directly. Options: renumber one network (painful but clean), use NAT between them (both sides see the other through translated addresses; breaks some protocols and complicates DNS), or connect only specific services via proxies/load balancers or a service mesh gateway. Long-term: an address plan that avoids overlaps (and IPv6).

## Practice

### [numeric 62] How many usable host addresses are there in a /26 subnet?

:::answer
2^(32−26) − 2 = 64 − 2 = **62**.
:::

### [exercise] For 172.16.45.130/27, compute the network address, broadcast address and host range.

:::solution
/27 → mask 255.255.255.224; block size in the last octet = 32. 130 falls in 128–159. Network **172.16.45.128**, broadcast **172.16.45.159**, hosts **172.16.45.129 – 172.16.45.158** (30 usable).
:::

### [mcq] Which address is NOT in a private (RFC 1918) range?

- [ ] 10.200.1.5
- [ ] 172.20.0.9
- [x] 172.32.0.9
- [ ] 192.168.100.100

172.16.0.0/12 spans 172.16.0.0–172.31.255.255.

## Quick Revision

- IPv4 = 32 bits; `/n` = network bits; mask = n ones.
- Network = IP AND mask; broadcast = all host bits 1; usable = 2^(32−n) − 2 (except /31, /32).
- Same subnet? compare IP AND mask.
- Private: 10/8, 172.16/12, 192.168/16; loopback 127/8; link-local 169.254/16; CGNAT 100.64/10.
- Classful A/B/C is history → CIDR + aggregation.
