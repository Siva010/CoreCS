---
title: "What Happens When a Client Calls connect()"
summary: "The client side of a TCP connection: ephemeral ports, the routing decision, ARP, the SYN leaving the NIC, crossing NAT and routers, the three-way handshake with sequence numbers, and the timeouts when it goes wrong."
subjects: [cn, os]
order: 7
related: [cn-tcp-handshake, cn-sockets, cn-routing, cn-arp-dhcp, cn-nat, cn-tcp-reliability, cn-encapsulation]
---

A client (192.168.1.20) runs `connect(fd, 93.184.215.14:443)`.

## [kernel] Choose a source address and port

The kernel consults the routing table: 93.184.215.14 matches only the default route via 192.168.1.1 on `wlan0`, so the source IP is 192.168.1.20. It picks a free **ephemeral port** (e.g., 51514) from `ip_local_port_range` such that the 4-tuple (src IP, src port, dst IP, dst port) is unique ([Routing](lesson:cn-routing)).

## [tcp] Build the SYN

TCP state: CLOSED → **SYN-SENT**. The kernel chooses a random initial sequence number (ISN, e.g., 1,000,000) and builds a SYN segment with options: MSS (1460), window scaling, SACK permitted, timestamps. A retransmission timer starts (initial RTO 1 s).

## [kernel] Resolve the next hop's MAC (ARP)

The IP packet must be framed for the gateway, so the kernel needs 192.168.1.1's MAC address. If not in the ARP cache, it broadcasts "who has 192.168.1.1?" and waits for the reply ([ARP & DHCP](lesson:cn-arp-dhcp)).

## [nic] The SYN leaves the machine

The frame (Ethernet/Wi-Fi header + IP header + TCP header) goes to the driver's transmit ring; the NIC DMAs it out and transmits it ([Encapsulation](lesson:cn-encapsulation)).

## [network] NAT and routers

The home router rewrites the source to its public address and a new port, recording the mapping in its NAT table ([NAT](lesson:cn-nat)). Each router on the path decrements TTL and forwards by longest-prefix match; frames are rebuilt per link.

## [tcp] The server replies SYN-ACK

The server's kernel (not its application) receives the SYN on a listening socket, stores a half-open entry (or a SYN cookie under load), and replies SYN-ACK: its own ISN (e.g., 5,000,000), ACK = 1,000,001 ("next byte I expect from you").

## [tcp] The client ACKs — ESTABLISHED

The client matches the SYN-ACK to its socket, records the server's ISN and window, measures the first RTT sample, and sends ACK = 5,000,001. State → **ESTABLISHED**; `connect()` returns (or, for non-blocking sockets, epoll reports it writable). One round trip has elapsed ([TCP Handshake](lesson:cn-tcp-handshake)).

## [kernel] When things go wrong

- **RST in reply** (nothing listening on that port): `connect()` fails immediately with ECONNREFUSED.
- **No reply** (packet dropped by a firewall, host down): the SYN is retransmitted with exponential backoff (1 s, 2 s, 4 s, …); with default settings Linux gives up after ~2 minutes → ETIMEDOUT. Applications should set their own connect timeouts.
- **ICMP unreachable** from a router: EHOSTUNREACH / ENETUNREACH ([IP & ICMP](lesson:cn-ip-packet-icmp)).
