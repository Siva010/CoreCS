---
title: "IPv6: Addresses, Autoconfiguration and Dual Stack"
subject: cn
level: 3
order: 6
summary: "Why IPv6 exists, how its 128-bit addresses are written and structured, what changed from IPv4 (no broadcast, no in-network fragmentation, SLAAC, NDP), and how the two coexist."
depth: core
difficulty: 2
minutes: 25
relevance: medium
stage: 2
prerequisites: [cn-ipv4-addressing, cn-arp-dhcp]
related: [cn-nat, cn-ip-packet-icmp, cn-dns-records, cn-routing]
tags: [ipv6, 128-bit, address notation, link-local, global unicast, slaac, ndp, dual stack, happy eyeballs, aaaa record, nat64]
---

## Mental Model

IPv6 is the internet's **new numbering plan with so many numbers that scarcity stops mattering**: 2¹²⁸ addresses — enough that every device, every container and every network can have globally unique addresses without NAT. A typical home or subnet gets a `/64` — 18 quintillion addresses for one LAN — which sounds absurd until you realize it makes address *planning* trivial and lets devices generate their own addresses.

Everything else is refinement of IPv4 lessons: a simpler fixed header, no broadcast (multicast instead), no router fragmentation, and neighbor discovery built into ICMPv6.

## Definition

- **IPv6 address**: 128 bits, written as eight groups of four hex digits separated by colons: `2001:0db8:0000:0000:0000:ff00:0042:8329`.
- **Compression rules**: drop leading zeros in each group (`0db8` → `db8`) and replace **one** run of consecutive all-zero groups with `::` → `2001:db8::ff00:42:8329`.
- **Prefix**: CIDR notation as in IPv4; subnets are normally `/64` (64-bit network prefix + 64-bit interface identifier).

## Why It Exists

IPv4's ~4.3 billion addresses ran out. NAT and CGNAT stretched them but broke end-to-end connectivity and added stateful middleboxes. IPv6 restores a globally unique address per interface and cleans up design warts.

## How It Works

### Address types

| Type | Prefix | Example / use |
|---|---|---|
| Global unicast | `2000::/3` | Public, routable addresses (`2001:db8::/32` is reserved for documentation) |
| Link-local | `fe80::/10` | Every interface auto-configures one; valid only on the link (NDP, routing protocols) |
| Unique local (ULA) | `fc00::/7` (in practice `fd00::/8`) | Private addressing, like RFC 1918 |
| Loopback | `::1` | This host |
| Unspecified | `::` | "Any" / not yet assigned |
| Multicast | `ff00::/8` | Replaces broadcast (`ff02::1` all nodes on link) |
| IPv4-mapped | `::ffff:192.0.2.1` | IPv4 addresses in IPv6 sockets |

### What changed from IPv4

| Area | IPv4 | IPv6 |
|---|---|---|
| Address size | 32 bits | 128 bits |
| Header | Variable (20–60 B), checksum | Fixed 40 B, **no checksum** (link and transport layers check), extension headers |
| Broadcast | Yes | **No** — multicast instead |
| Fragmentation | Routers may fragment | **Only the sender** fragments; routers send ICMPv6 Packet Too Big; minimum MTU 1,280 |
| Address resolution | ARP | **NDP** (ICMPv6 neighbor solicitation/advertisement) |
| Autoconfiguration | DHCP | **SLAAC** (router advertisements + self-generated interface ID) and/or DHCPv6 |
| NAT | Ubiquitous | Not needed for address conservation |
| DNS record | A | **AAAA** |

### SLAAC in brief

A host generates a link-local address, performs duplicate address detection, listens for (or solicits) **Router Advertisements** containing the /64 prefix, and forms a global address from the prefix plus an interface identifier — usually **random/temporary** for privacy (rather than derived from the MAC address, as in early IPv6).

### Coexistence: dual stack and translation

- **Dual stack**: hosts run IPv4 and IPv6 simultaneously; DNS returns both A and AAAA records.
- **Happy Eyeballs** (RFC 8305): clients try IPv6 and IPv4 connections in a staggered race and use whichever connects first, so broken IPv6 doesn't cause long delays.
- **NAT64 + DNS64**: IPv6-only networks (common on mobile carriers) reach IPv4-only services via translation.
- **Tunnels** (6in4 and others) historically carried IPv6 across IPv4 networks.

## Internal Mechanism

:::depth{level=advanced}
### Why /64 everywhere

SLAAC and privacy addressing assume a 64-bit interface identifier, so LAN subnets are /64 regardless of how few hosts they have. Sites typically receive a /48 or /56, giving 65,536 or 256 subnets. The huge sparse space also makes brute-force scanning of a subnet impractical (2⁶⁴ addresses), changing security assumptions, though neighbor-cache exhaustion attacks against routers are a concern for large /64s.
:::

## Example

```bash
$ ip -6 addr show dev eth0
inet6 2001:db8:4f2:10::1a3/64 scope global dynamic mngtmpaddr
inet6 fe80::3e22:fbff:fe9a:104e/64 scope link
$ dig +short AAAA example.com
2606:2800:21f:cb07:6820:80da:af6b:8b2c
$ curl -6 https://example.com -o /dev/null -w "%{remote_ip}\n"
```

Addresses containing ports in URLs need brackets: `http://[2001:db8::1]:8080/`.

## Complexity & Performance

- Fixed header simplifies router processing; larger addresses mean 20 extra header bytes per packet.
- Longest-prefix match over 128-bit prefixes needs more TCAM/trie resources.

## Trade-offs

- End-to-end addressing and no NAT vs the need for proper firewalls (every device may be globally addressable) and years of dual-stack operational complexity.

## Failure Modes

- Broken IPv6 paths causing delays before fallback (mitigated by Happy Eyeballs).
- Firewalls configured for IPv4 only, leaving IPv6 wide open.
- Applications parsing addresses as `host:port` without brackets.
- Blocking ICMPv6 — which breaks NDP and PMTUD, i.e., breaks IPv6 itself.

## In Production

- Mobile networks and large content providers carry a large and growing share of traffic over IPv6; clouds offer dual-stack VPCs and IPv6-only subnets.
- Kubernetes supports dual-stack pods and services.

## Deeper Connections

- NDP replaces ARP ([ARP & DHCP](lesson:cn-arp-dhcp)); no router fragmentation ties into PMTUD ([IP & ICMP](lesson:cn-ip-packet-icmp)); AAAA records in [DNS Records](lesson:cn-dns-records); NAT's reason for existing disappears ([NAT](lesson:cn-nat)).

## Common Misconceptions

- **"IPv6 is just IPv4 with longer addresses."** It changes autoconfiguration, neighbor discovery, fragmentation and removes broadcast.
- **"Without NAT, IPv6 devices are exposed."** Only if there's no firewall; stateful firewalls provide the protection NAT incidentally gave.
- **"You can use `::` twice to compress."** Only once, or the address becomes ambiguous.

## Interview Questions

### [L1 · compare] What are the main differences between IPv4 and IPv6?

128-bit vs 32-bit addresses; a simpler fixed 40-byte header without checksum; no broadcast (multicast instead); only the source fragments (routers never do); NDP over ICMPv6 instead of ARP; SLAAC for stateless autoconfiguration; AAAA records in DNS; and no need for NAT to conserve addresses.

### [L2 · how] How does an IPv6 host get an address without DHCP?

SLAAC: it creates a link-local address (fe80::/64 + interface ID), verifies uniqueness with duplicate address detection, receives a Router Advertisement containing the network prefix, and combines the prefix with a (typically random) interface identifier to form a global address. DHCPv6 may still supply DNS or other options.

### [L2 · numerical] Compress 2001:0db8:0000:0000:0000:0000:0000:0001.

Drop leading zeros and replace the longest run of zero groups with `::` → **2001:db8::1**.

### [L3 · why] What is Happy Eyeballs and why is it needed?

A connection strategy for dual-stack clients: start an IPv6 connection attempt and, after a short delay (~250 ms), also try IPv4, using whichever succeeds first. It prevents users from waiting on timeouts when IPv6 connectivity is advertised (AAAA records exist) but broken somewhere on the path.

## Practice

### [mcq] Which of these is a valid compressed IPv6 address?

- [x] 2001:db8::8a2e:370:7334
- [ ] 2001::db8::7334
- [ ] 2001:db8:::7334
- [ ] 2001:gb8::1

`::` may appear only once, and hex digits stop at f.

### [mcq] Which protocol replaces ARP in IPv6?

- [ ] DHCPv6
- [x] Neighbor Discovery Protocol (NDP)
- [ ] BGP
- [ ] IGMP

NDP uses ICMPv6 neighbor solicitation/advertisement messages.

## Quick Revision

- 128-bit addresses; compress leading zeros and one zero run with `::`.
- Types: global unicast (2000::/3), link-local (fe80::/10), ULA (fd00::/8), loopback ::1, multicast ff00::/8.
- Fixed 40-byte header, no checksum, no broadcast, sender-only fragmentation (min MTU 1,280).
- NDP (not ARP), SLAAC (+ optional DHCPv6), /64 subnets.
- Dual stack + Happy Eyeballs; NAT64/DNS64 for IPv6-only networks; firewall IPv6 too.
