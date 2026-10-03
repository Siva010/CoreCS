---
title: "Encapsulation: An HTTP Request Traveling Down and Up the Stack"
subject: cn
level: 1
order: 2
summary: "Follow real bytes: how each layer wraps the one above with its header, what the kernel and NIC do on send and receive, and what a router rewrites in the middle."
depth: beginner
difficulty: 2
minutes: 30
relevance: high
stage: 1
prerequisites: [cn-layered-models]
related: [cn-sockets, cn-routing, cn-ethernet-switching, cn-mtu-congestion, os-syscalls-interrupts]
visualizations: [encapsulation]
tags: [encapsulation, decapsulation, headers, ethernet frame, ip header, tcp header, mtu, mss, nic, checksum]
---

## Mental Model

Encapsulation is **Russian nesting dolls**. Your application's message is the smallest doll. TCP puts it inside a doll labeled with ports and sequence numbers. IP puts that inside a doll labeled with source and destination IP addresses. Ethernet puts that inside a doll labeled with the MAC address of the next device. At the receiver, each layer opens its own doll, checks its own label, and passes the inside up — never peeking at labels that belong to other layers.

Routers in the middle open only the outer two dolls: they throw away the Ethernet doll, read the IP label, and put the packet in a **new** Ethernet doll for the next link.

## Definition

- **Encapsulation**: each layer prepends its header (and sometimes a trailer) to the data from the layer above, forming its own protocol data unit.
- **Decapsulation**: the receiver's layers strip and validate their headers in reverse order, delivering the payload upward.
- **MTU (maximum transmission unit)**: the largest IP packet a link can carry (1,500 bytes on standard Ethernet).
- **MSS (maximum segment size)**: the largest TCP payload per segment (typically 1,460 = 1,500 − 20 IP − 20 TCP).

## Why It Exists

Layer independence requires each layer to carry its own control information (addresses, sequence numbers, checksums) without understanding the others'. Headers are that information.

## How It Works

### Sending `GET /` over HTTP (unencrypted, for clarity)

```text
Application:           [ GET / HTTP/1.1\r\nHost: example.com\r\n\r\n ]              ~40 B
Transport (TCP):  [TCP hdr: 51514→80, seq=1001, ack=5001, flags=PSH|ACK, win][data]  +20 B
Network (IP):  [IP hdr: 192.168.1.20→93.184.215.14, TTL=64, proto=TCP][TCP][data]    +20 B
Link (Ethernet): [dst MAC=router, src MAC=laptop, type=IPv4][IP][TCP][data][FCS]    +14 B (+4 FCS)
Physical:        preamble + bits on the wire
```

What each header contains that matters:

| Header | Key fields | Purpose |
|---|---|---|
| Ethernet (14 B) | Destination MAC, source MAC, EtherType (0x0800 = IPv4, 0x86DD = IPv6) | Next-hop delivery on this link; which protocol is inside |
| IPv4 (20 B) | Source/destination IP, TTL, protocol (6 = TCP, 17 = UDP), total length, header checksum, fragment fields | End-to-end addressing and routing |
| TCP (20 B + options) | Source/destination port, sequence number, acknowledgment number, flags (SYN, ACK, FIN, RST, PSH), window, checksum | Process delivery, reliability, flow control |
| Ethernet trailer (FCS, 4 B) | CRC-32 | Detect corrupted frames on this link |

### Inside the sending host

::::steps
1. The app calls `write(sock, buf, n)` — a system call copies the bytes into the socket's **send buffer** ([Sockets](lesson:cn-sockets)).
2. The kernel's TCP code slices the buffer into segments of at most MSS bytes, adds TCP headers (sequence numbers), and keeps a copy for retransmission.
3. IP adds its header, chooses the outgoing interface and next hop from the **routing table**.
4. The kernel resolves the next hop's MAC via the **ARP/neighbor cache** and adds the Ethernet header.
5. The frame is queued to the NIC driver; the NIC DMAs it from memory, computes the CRC (and often the TCP/IP checksums — **checksum offload**), and transmits.
::::

### At a router

1. Receive the frame, verify the FCS, strip the Ethernet header.
2. Validate the IP header, **decrement TTL** (drop and send ICMP "time exceeded" if it hits 0), update the IPv4 header checksum.
3. Longest-prefix-match the destination IP in the forwarding table → next hop + interface.
4. Build a **new Ethernet header** with the next hop's MAC and the router's own MAC as source; transmit.

The TCP header and payload are untouched (unless NAT or a proxy is involved).

### Inside the receiving host

The NIC receives the frame, checks the CRC, DMAs it into a ring buffer, raises an interrupt; the driver passes it up; IP verifies the destination is local; TCP finds the socket by the 4-tuple, checks sequence numbers, places data in the **receive buffer**, sends an ACK, and wakes the process blocked in `read()` (or signals epoll) ([epoll & Event Loops](lesson:os-epoll-event-loops)).

::viz{id=encapsulation}

## Internal Mechanism

### Size limits: MTU and MSS

A 1 MB HTTP response is not sent as one packet: TCP cuts it into ~719 segments of 1,460 bytes each (on a 1,500 MTU path). During the TCP handshake each side announces its MSS. If a tunnel or VPN adds headers, the effective MTU shrinks (e.g., 1,450 for VXLAN), and mismatches cause the infamous **PMTU black holes** ([MTU & Network Bottlenecks](lesson:cn-mtu-congestion)).

:::depth{level=advanced}
### Offloads blur the picture

On modern servers the kernel often builds a single 64 KB "super-segment" and the NIC splits it into MSS-sized packets (**TSO/GSO**); on receive, the NIC or kernel merges consecutive segments (**GRO/LRO**) before TCP processing. This is why `tcpdump` on a host can show packets larger than the MTU. Checksums are computed by the NIC (**checksum offload**). These optimizations cut per-packet CPU cost dramatically — per-packet overhead, not per-byte, dominates at 10–100 Gb/s.
:::

## Example

Capture it:

```bash
$ sudo tcpdump -i eth0 -nn -e -c 3 'tcp port 80'
10:02:11.120 3c:22:fb:9a:10:4e > 00:1a:2b:3c:4d:5e, ethertype IPv4 (0x0800), length 74:
    192.168.1.20.51514 > 93.184.215.14.80: Flags [S], seq 1382027761, win 64240,
    options [mss 1460,sackOK,TS val 1 ecr 0,nop,wscale 7], length 0
```

`-e` shows the Ethernet header (MACs, EtherType); the rest is IP and TCP. `length 74` = 14 (Ethernet) + 20 (IP) + 40 (TCP with options). In Wireshark you can click through each layer's fields.

## Complexity & Performance

- Header overhead per full-size TCP/IPv4 packet: 40 B of 1,500 (~2.7%), plus Ethernet framing.
- Per-packet costs (interrupts, lookups, header processing) dominate CPU at high packet rates — hence offloads, batching (GRO), and larger MTUs (jumbo frames, 9,000 B) inside data centers.

## Trade-offs

- More layers/headers (tunnels, VPNs, overlays) → flexibility and isolation vs overhead and smaller MTUs.
- Jumbo frames → less per-packet overhead vs MTU mismatch risks.

## Failure Modes

- MTU mismatches after adding a tunnel → large packets silently dropped.
- Checksum offload confusion in packet captures (packets appear to have "bad checksums" because the NIC fills them later).
- Wrong EtherType/VLAN tags in misconfigured networks.

## In Production

- `tcpdump`/Wireshark are the ground truth for "what actually went over the wire".
- Service meshes and overlays add encapsulation layers (e.g., VXLAN inside the host network, TLS inside mTLS sidecars) — each costs bytes and CPU.

## Deeper Connections

- The send and receive paths cross the OS boundary via system calls and interrupts ([System Calls & Interrupts](lesson:os-syscalls-interrupts)).
- Router forwarding decisions: [Routing](lesson:cn-routing). Next-hop MAC resolution: [ARP & DHCP](lesson:cn-arp-dhcp).

## Common Misconceptions

- **"Routers look at TCP ports."** Plain routers don't (NAT devices and firewalls do).
- **"The IP header never changes in transit."** TTL and the checksum change at every hop; NAT changes addresses.
- **"One send() = one packet."** TCP is a byte stream; one write may become many packets, or several writes may coalesce into one.

## Interview Questions

### [L1 · conceptual] What is encapsulation in networking?

Each layer wraps the data from the layer above with its own header (and possibly trailer) containing the information it needs — ports and sequence numbers for TCP, IP addresses and TTL for IP, MAC addresses and a CRC for Ethernet. The receiver removes the headers in reverse order (decapsulation), each layer processing only its own header.

### [L2 · trace] What changes in a packet when it passes through a router?

The link-layer frame is replaced: new source MAC (router's outgoing interface) and destination MAC (next hop), new FCS. In the IP header, TTL is decremented and the header checksum recomputed. Source/destination IPs and the transport header stay the same unless the router also performs NAT.

### [L2 · numerical] With a 1,500-byte MTU and 20-byte IPv4 and TCP headers, how many segments are needed for a 100 KB response (100,000 bytes)?

MSS = 1,460 bytes. 100,000 / 1,460 ≈ 68.5 → **69 segments**.

### [L3 · why] Why can tcpdump show outgoing TCP packets of 64 KB on a 1,500-byte MTU interface?

TCP segmentation offload (TSO/GSO): the kernel hands the NIC a large segment and the NIC splits it into MTU-sized packets on the wire. tcpdump captures at the kernel level before segmentation, so it sees the large buffer.

## Practice

### [numeric 1460] Standard Ethernet MTU is 1,500 bytes. With 20-byte IPv4 and 20-byte TCP headers (no options), what is the MSS?

:::answer
1,500 − 20 − 20 = **1,460 bytes**.
:::

### [mcq] Which header's destination address typically changes at every router hop?

- [x] Ethernet (MAC) header
- [ ] IP header
- [ ] TCP header
- [ ] HTTP header

The link-layer header is rebuilt for each link.

## Quick Revision

- App data → TCP header (ports, seq/ack, flags, window) → IP header (IPs, TTL, protocol) → Ethernet (MACs, EtherType) + FCS.
- Router: strip frame, TTL−1, checksum, longest-prefix match, new frame. Transport untouched (unless NAT).
- MTU 1,500 → MSS 1,460 (IPv4/TCP without options).
- Offloads (TSO/GRO, checksum) change what captures show.
- One write ≠ one packet (byte stream).
