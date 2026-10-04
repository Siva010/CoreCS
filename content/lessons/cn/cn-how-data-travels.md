---
title: "How Data Travels From One Machine to Another"
subject: cn
level: 0
order: 1
summary: "The networking mental model: bits become signals, frames cross one link, packets cross the internet, and ports deliver to the right program — plus the end-to-end principle that shapes everything above."
depth: beginner
difficulty: 1
minutes: 30
relevance: essential
stage: 1
prerequisites: []
related: [cn-layered-models, cn-encapsulation, cn-ethernet-switching, cn-routing]
visualizations: [encapsulation]
tags: [packet switching, circuit switching, bits, signals, frames, packets, switch, router, mac address, ip address, port, protocol, end-to-end principle]
---

## Mental Model

Sending data across the internet is like **mailing a book through a postal system that only accepts postcards**:

1. You tear the book into pages and put each page on a postcard (**packets**), numbered so the recipient can reassemble them.
2. Each postcard carries a **destination address** (the recipient's building — an **IP address**) and an **apartment number** (the program on that machine — a **port**).
3. Postcards travel hop by hop. At each local post office (**router**), a clerk looks only at the destination and decides the next post office. Nobody plans the whole route in advance.
4. Between two post offices, the postcard rides a specific truck on a specific road (**a link**); for that ride it's put in an envelope addressed to the next stop's loading dock (a **frame** with **MAC addresses**).
5. Postcards can get lost, arrive out of order, or be duplicated. If you need the whole book intact, the sender and receiver must run a **protocol** on top: number pages, acknowledge receipt, resend missing ones (**TCP**).

Everything in computer networking elaborates one of those five sentences.

## Definition

- **Bit / signal**: data on a wire, fiber or radio is a physical signal (voltage levels, light pulses, radio waves) encoding bits.
- **Frame**: a unit of data on a single link (Layer 2, e.g., Ethernet, Wi-Fi), addressed with **MAC addresses**.
- **Packet**: a unit of data routed across networks (Layer 3, IP), addressed with **IP addresses**.
- **Segment / datagram**: transport-layer unit (TCP segment, UDP datagram), addressed with **ports**.
- **Switch**: forwards frames within a local network using MAC addresses.
- **Router**: forwards packets between networks using IP addresses.
- **Protocol**: an agreed format and set of rules for exchanging messages (HTTP, TCP, IP, Ethernet).

## Why It Exists

**The problem.** Millions of computers need to exchange data with any of millions of others, over shared cables, with no central coordinator — and links and routers fail all the time.

**The first answer, and why it didn't fit.** Early telephone networks used **circuit switching**: a dedicated path reserved for the whole call. Computers communicate in **bursts**, so reserving a path wastes capacity. A phone call talks continuously; a computer sends a burst, then goes quiet for seconds.

**The idea.** The internet uses **packet switching**: data is chopped into packets that share links with everyone else's packets, each routed independently. Every packet carries its own destination, so no route has to be set up in advance and a broken link just means "send the next packet another way".

| | Circuit switching | Packet switching |
|---|---|---|
| Resources | Reserved end-to-end for the session | Shared, on demand |
| Utilization for bursty traffic | Poor | High |
| Guarantees | Fixed bandwidth and latency | Best effort: delay varies, packets can be lost |
| Failure handling | A broken link breaks the call | Packets route around failures |
| Examples | Classic telephone network | Internet |

The price of packet switching is **queueing**: when many packets want the same link at once, they wait in router buffers (delay) or get dropped (loss). Much of networking — TCP congestion control, QoS, tail latency — exists to cope with that price.

**From idea to mechanism.** Once you decide "independent packets on shared links", the rest of the course falls out: packets need addresses to find hosts (**IP**), something to choose each next hop (**routing**), a way to cross each individual link (**Ethernet, MAC addresses**), a way to reach the right program on the host (**ports**), and — because packets can be lost or reordered — a way to rebuild a reliable stream (**TCP**).

:::callout[That's all it is]{type=insight}
Data is cut into packets with an address on each. Every router looks at the address and passes the packet one hop closer. The two ends fix up whatever goes wrong on the way: losses, reordering, duplicates.
:::

## How It Works

### Four kinds of addresses, four jobs

Why so many addresses? Because "deliver to that program on that machine across the world" is really four questions: which program (port), which machine globally (IP), which device on this cable right now (MAC), and what humans type (domain name).

| Address | Example | Scope | Who uses it |
|---|---|---|---|
| **MAC address** | `3c:22:fb:9a:10:4e` | One link / LAN | Switches, NICs |
| **IP address** | `93.184.215.14` | Global (or private network) | Routers |
| **Port** | `443` | One host | The OS, to find the right socket/program |
| **Domain name** | `example.com` | Human-friendly | DNS turns it into an IP address |

A connection between two programs is identified by the **5-tuple**: (protocol, source IP, source port, destination IP, destination port).

### One request's journey

You run `curl https://example.com` on a laptop on home Wi-Fi:

::::steps
1. **DNS**: the laptop asks a resolver for the IP of `example.com` ([DNS](lesson:cn-dns-fundamentals)).
2. **Is the destination local?** The laptop compares the IP with its own subnet — it isn't, so the packet goes to the **default gateway** (the home router).
3. **ARP**: to put the frame on the Wi-Fi link, the laptop needs the router's MAC address; it asks "who has 192.168.1.1?" ([ARP & DHCP](lesson:cn-arp-dhcp)).
4. **TCP handshake**: the laptop opens a TCP connection to port 443 ([TCP handshake](lesson:cn-tcp-handshake)); **TLS** then encrypts the channel.
5. **Framing**: the HTTP request is wrapped in TCP, then IP, then a Wi-Fi/Ethernet frame addressed to the router's MAC ([Encapsulation](lesson:cn-encapsulation)).
6. **NAT**: the home router rewrites the private source IP/port to its public IP/port ([NAT](lesson:cn-nat)).
7. **Routing**: across the ISP and the internet backbone, perhaps 10–20 routers each look up the destination IP and forward the packet one hop closer. At every hop the frame is rebuilt for the next link; the IP packet stays (mostly) the same.
8. **Delivery**: the server's NIC receives the frame; the kernel strips headers layer by layer and hands the bytes to the socket listening on port 443 — the web server process.
9. **Response** follows the same path backward.
::::

### What each device looks at

| Device | Reads | Changes |
|---|---|---|
| Switch | Destination MAC | Nothing (just forwards the frame) |
| Router | Destination IP | New Ethernet header per hop; decrements TTL; recomputes IPv4 checksum |
| NAT router | IP + port | Also rewrites source IP/port |
| Load balancer / proxy | Up to HTTP (Layer 7) | May terminate TCP/TLS and open a new connection |
| End host | Everything | Delivers to the socket |

## Internal Mechanism

### Where delay comes from

Every hop adds four kinds of delay ([Latency & Bandwidth](lesson:cn-latency-bandwidth)):

- **Processing**: examining headers, looking up routes (ns–µs).
- **Queueing**: waiting behind other packets in the output buffer (0 to many ms — the variable part).
- **Transmission**: pushing the bits onto the link = packet size / link bandwidth (1500 B at 1 Gb/s = 12 µs).
- **Propagation**: the signal traveling the distance at ~2/3 the speed of light in fiber (~5 µs per km — about 28 ms one way for the ~5,600 km New York → London great-circle distance, more in practice because cables don't follow great circles).

### The end-to-end principle

A design philosophy that explains why the internet looks the way it does. The network core (routers) is deliberately **simple and stateless** — "best effort" delivery of individual packets. Reliability, ordering, encryption and flow control are implemented at the **ends** (in hosts' TCP stacks and applications), because only the ends know what "correct" means for their application, and a smart network can't guarantee end-to-end correctness anyway. This is why the internet scaled: routers don't track your connections. (Middleboxes like NATs and firewalls do keep state, and they're a constant source of breakage — which is why QUIC encrypts almost everything.)

:::depth{level=advanced}
### Physical layer in one paragraph

Copper Ethernet encodes bits as voltage patterns (e.g., PAM levels), fiber as light pulses at specific wavelengths, Wi-Fi as modulated radio (OFDM/QAM). Link speed is the rate bits can be placed on the medium; errors from noise are detected by a **CRC** in every frame (corrupted frames are dropped, never "fixed" at Layer 2 for Ethernet), and higher layers retransmit. Wireless links lose and reorder far more than wired ones, which is why Wi-Fi does its own link-layer retransmissions and why TCP performance on mobile networks is its own discipline.
:::

## Example

See the hops yourself:

```bash
$ traceroute -n example.com
 1  192.168.1.1      1.9 ms     # home router (default gateway)
 2  100.64.0.1       8.7 ms     # ISP (carrier-grade NAT range)
 3  203.0.113.9     10.2 ms
 ...
 9  93.184.215.14   23.4 ms     # destination
```

Each line is a router that decremented the packet's TTL to zero and sent back an ICMP "time exceeded" message — that's how traceroute discovers the path ([IP & ICMP](lesson:cn-ip-packet-icmp)).

## Visualization

::viz{id=encapsulation}

## Complexity & Performance

- Latency is dominated by **propagation** for long distances and by **queueing** under congestion.
- Throughput is limited by the slowest link (the **bottleneck**) and, for TCP, by window size and round-trip time ([Latency & Bandwidth](lesson:cn-latency-bandwidth)).

## Trade-offs

- Packet switching: efficient and resilient, but no guaranteed latency.
- Keeping the core simple (end-to-end): scalable and evolvable, but pushes complexity (reliability, security) into every endpoint.
- Layering ([next lesson](lesson:cn-layered-models)): independent evolution of technologies, at the cost of header overhead and occasional layer violations.

## Failure Modes

- **Packet loss** from full buffers (congestion), bad links, or misconfigured MTU.
- **Wrong routes** (misconfiguration, BGP incidents) sending traffic nowhere.
- **Name resolution failures** that look like "the internet is down" ([DNS](lesson:cn-dns-fundamentals)).
- **Middlebox interference**: NATs and firewalls dropping idle connections or unfamiliar protocols.

## In Production

- The "what happens when you type a URL" question tests exactly this model; see [Opening a Website, End to End](lesson:x-website-journey).
- Cloud networks are virtual: your VM's "Ethernet" is emulated, and packets between VMs are encapsulated in overlay networks — the same concepts, one level up ([Container Networking](lesson:cn-container-networking)).

## Deeper Connections

- A packet is to the network what a page is to memory: a fixed-size unit that makes sharing and placement flexible.
- Queues in routers behave like run queues and I/O queues in the OS: latency explodes near saturation ([Performance Fundamentals](lesson:os-performance-method)).

## Common Misconceptions

- **"Data flows through a dedicated connection."** TCP "connections" exist only as state in the two endpoints; the network forwards independent packets.
- **"Routers know the whole path."** Each router knows only the next hop for each destination prefix.
- **"MAC addresses are used to reach remote servers."** MAC addresses are only meaningful on one link; they change at every hop.

## Interview Questions

### [L1 · compare] What is the difference between a switch and a router?

A switch forwards frames within a local network (Layer 2) based on destination MAC addresses it has learned. A router forwards packets between different networks (Layer 3) based on destination IP addresses and its routing table, rewriting the link-layer header at each hop and decrementing the TTL.

### [L1 · compare] MAC address vs IP address vs port?

A MAC address identifies a network interface on a single link and is used for delivery within a LAN. An IP address identifies a host's interface across networks and is used for routing end to end. A port identifies an application endpoint (socket) on a host. Together with the protocol, source/destination IPs and ports form the 5-tuple identifying a connection.

### [L2 · compare] Packet switching vs circuit switching?

Circuit switching reserves a dedicated path and bandwidth for the duration of a session (predictable, wasteful for bursty data). Packet switching splits data into packets that share links on demand and are routed independently (efficient and resilient, but with variable delay and possible loss). The internet is packet-switched.

### [L2 · trace] Which headers change as a packet goes from your laptop through your home router to a web server?

The Ethernet/Wi-Fi frame header is replaced at every hop (new source/destination MAC for each link). The IP header keeps its source and destination addresses across routers, except that TTL is decremented (and the IPv4 checksum updated) at every hop — and at the home router, NAT rewrites the source IP and port. TCP ports stay the same end to end except for NAT's source-port rewrite.

### [L3 · why] What is the end-to-end principle and why does it matter?

Functions like reliability, ordering and security should be implemented at the endpoints rather than in the network core, because only the endpoints can ensure correctness for the application and the core stays simple, stateless and scalable. It's why routers do best-effort forwarding and TCP/TLS live in hosts. Middleboxes that violate it (NATs, firewalls, TCP-modifying proxies) cause ossification — one reason QUIC runs over UDP and encrypts its headers.

## Practice

### [mcq] Which device primarily uses destination IP addresses to forward traffic between networks?

- [ ] Switch
- [x] Router
- [ ] Hub
- [ ] Network interface card

Routers work at Layer 3.

### [numeric 12 unit=µs] How long does it take to transmit a 1,500-byte packet onto a 1 Gb/s link (transmission delay), in microseconds?

:::answer
1,500 × 8 = 12,000 bits; 12,000 / 10⁹ bits/s = 12 × 10⁻⁶ s = **12 µs**.
:::

## Quick Revision

- Packet switching: data split into packets sharing links; best effort; queues → delay and loss.
- Addresses: **MAC** (per link), **IP** (end to end), **port** (program), **name** (DNS). Connection = 5-tuple.
- Switch = Layer 2 (MAC), router = Layer 3 (IP, next hop only, TTL−1, new frame each hop).
- Delay = processing + queueing + transmission + propagation.
- End-to-end principle: simple core, smart endpoints (TCP, TLS in hosts).
