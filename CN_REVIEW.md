# Computer Networks track — review and ratings

*Reviewed 19 October 2026, covering all 42 networking lessons. They were then improved in the same rounds as the [database](DBMS_REVIEW.md) and [operating-systems](OS_REVIEW.md) tracks: questions and textbook theory, practice and new lessons, understandability, diagrams, Java examples and labs. The track now has 49 lessons.*

## Verdict

The Networks track was already **modern and production-real**. TCP states, TIME_WAIT and CLOSE_WAIT, HTTP/2 and HTTP/3, TLS 1.3, CDNs, Kubernetes networking and tail latency were explained from the problem up. The review found four weaknesses:

- **Almost no self-testing.** There were 90 practice items, about 2 per lesson, and only 25 numericals or exercises.
- **A missing data link layer.** Framing, error detection, stop-and-wait, Go-Back-N, Selective Repeat, ALOHA and CSMA/CD weren't taught, and Dijkstra and Bellman-Ford appeared only as a table row. These are the topics campus exams and GATE test most with numericals.
- **No Java.** The code was 3 Python snippets, plus shell and HTTP examples. Java's own networking layer (`HttpClient`, timeouts, connection pools, the JVM's DNS cache, truststores) was named but not taught.
- **Few diagrams.** 26 of 42 lessons had none.

The rounds:

- **Questions and theory:** 104 new questions (60 in the original lessons, 44 in the new ones), 12 textbook sections, and one wording fix.
- **Practice and new lessons:** every lesson has at least 6 practice items, at least 2 of them numericals or exercises. There are seven new lessons: framing and error detection, reliable delivery (ARQ), sharing a link (MAC protocols), routing algorithms, email and file transfer, networking in Java, and network security.
- **Understandability:** no theory sentence is over 35 words (57 were), there are more worked traces, and hover definitions cover 143 networking terms.
- **Diagrams:** every lesson has one.
- **Java:** 14 Java blocks, up from none, all compile-checked with JDK 21. The Python is gone.
- **Labs:** three new labs (*Error Detection*, *ARQ Protocols* and *Routing Algorithms*), and 40 of 49 lessons now have practice that uses a lab or visualization.

**Overall 7.9 → 8.9.** Most of the gain is practice (3.4 → 8.8), which started very low.

A note on honesty: I wrote these lessons, so this is a review of my own work. I recorded each lesson's starting scores before editing it, and practice is scored by a fixed rule, not by impression. As with the OS track, the starting 9s for content and clarity were generous: the lessons then had 14 sentences over 45 words and diagrams in only 16 of 42 lessons. I didn't lower those scores after the fact, and I didn't raise them for this round's clarity work either. Interview scores below 9 went to 9 once a lesson had at least 6 questions covering the gaps its before-review named; that is a judgement, not a count alone. The three tracks were scored in separate passes, so their overall numbers aren't directly comparable.

## How the ratings work

The same six dimensions as the database and OS reviews, each scored 1–10:

| Dimension | What a 9 means |
|---|---|
| **Content accuracy & depth** | Correct for current protocols and implementations (RFCs, Linux, the JDK), explains the mechanism, no hand-waving. |
| **First-principles clarity** | Problem → idea → mechanism is obvious; a reader could re-derive the design. |
| **Interview readiness** | Covers the classic questions *and* the follow-ups (including the Java ones), with model answers at L1–L3 depth plus traps. |
| **Practice / self-testing** | Enough MCQs, numericals and exercises to check yourself, ideally hands-on. |
| **Production relevance** | Failure modes, real signals (`ss`, `tcpdump`, `dig`, `curl -v`, metrics), operational advice an engineer would use. |
| **Syllabus coverage** | Includes the textbook topics (Kurose & Ross, Tanenbaum, Forouzan) that examiners and campus interviewers ask for by name. |

**Practice is scored by a fixed rule:**

| Items | Condition | Score |
|---|---|---|
| ≤ 3 | — | 3 |
| ≤ 3 | with a numerical or exercise | 4 |
| 4–5 | — | 5 |
| 4–5 | with ≥ 2 numericals/exercises | 6 |
| ≥ 6 | with a numerical or exercise | 7 |
| ≥ 6 | with ≥ 2 numericals/exercises | 8 |
| ≥ 6 | the same, plus practice that uses one of the site's labs or visualizations | 9 |

Nothing got a 10.

## Track-level scores

| Dimension | Before (42 lessons) | After, same 42 | After, all 49 |
|---|---|---|---|
| Content accuracy & depth | 9.0 | 9.0 | **9.0** |
| First-principles clarity | 9.0 | 9.0 | **9.0** |
| Interview readiness | 8.4 | 9.0 | **9.0** |
| Practice / self-testing | 3.4 | 8.8 | **8.8** |
| Production relevance | 8.8 | 8.9 | **8.8** |
| Syllabus coverage | 8.6 | 9.0 | **9.0** |
| **Overall** | **7.9** | **8.9** | **8.9** |

The new lessons score 8.5 to 9.0. *Network Security* scores 9.0. *Sharing a Link* scores 8.5: it has no lab to practise against, and its topics (ALOHA, CSMA/CD) matter more in exams than in production.

## What was already strong

- **Mechanism-first explanations.** The lessons build from the problem up: why TCP needs a three-way handshake, why TIME_WAIT exists, why HTTP/2 still suffers head-of-line blocking over TCP, why QUIC runs over UDP, why a CDN cuts latency. Most textbooks list these as facts instead.
- **Production realism.** The lessons cover:
  - CLOSE_WAIT leaks and ephemeral-port exhaustion;
  - PMTU black holes and MSS clamping;
  - DNS TTLs during failover;
  - load balancer health checks and connection draining;
  - Kubernetes Services, conntrack and `ndots`;
  - tail latency at fan-out, hedged requests and coordinated omission.
- **Interactive labs** for the transport and IP topics: the TCP handshake, the sliding window, congestion control, DNS resolution, subnetting, packet routing with NAT, HTTP caching, real-time transports and head-of-line blocking.
- **Accuracy.** The worked numbers checked out. One wording error was found: the flow-control lesson headed a 64 KB vs 16 MB comparison "Two 50 KB windows". It is fixed.

## What the review found weak

1. **Thin practice.** There were 90 items across 42 lessons: 65 MCQs, 23 numericals and 2 exercises. No lesson had more than 3 items, and no practice item sent you to a lab.
2. **Textbook gaps:**
   - network topologies, store-and-forward and message switching;
   - devices by layer (hub, bridge, switch, router, gateway) and connection-oriented vs connectionless service;
   - framing and stuffing, parity, the Internet checksum, CRC and Hamming codes;
   - stop-and-wait, Go-Back-N and Selective Repeat, with the window limits and utilization formulas;
   - ALOHA, CSMA/CD's minimum frame size, CSMA/CA;
   - Dijkstra and Bellman-Ford traced, count to infinity, split horizon, RIP vs OSPF;
   - RARP/BOOTP and proxy ARP; static and dynamic NAT vs PAT; the IPv6 header;
   - DNS zones, delegation and SOA; SMTP, IMAP, POP3 and FTP;
   - RSA and Diffie–Hellman with small numbers; block ciphers and modes; IPsec modes;
   - the network-security chapter: firewalls, DMZs, IDS/IPS and DDoS.
3. **Code in the wrong language for the audience.** Three examples (`recv_exact` framing, an echo server and a UDP socket) were Python, and there was no Java at all.
4. **Few diagrams.** 26 of 42 lessons had none. Several of them had a visualization instead, but a diagram you can read in place was missing.

## Update 1: interview questions and textbook theory

- **Question bank 195 → 299.** That is 60 new questions in the original lessons and 44 in the new ones. The lessons that had 3 or 4 questions now have at least 6. Examples:
  - How does a gRPC call map onto HTTP/2?
  - What is OCSP stapling, and why is it better than the client asking the CA?
  - Walk through RSA with p = 3, q = 11, e = 3, encrypting m = 4.
  - A router learns 10.5.0.0/16 from OSPF and has a static route for it too. Which one does it use?
  - How many round trips before the first response byte with HTTP/3, compared with HTTP/2 over TCP and TLS 1.3?
  - How do you send and receive UDP in Java, and what does one `receive()` call return?
- **Textbook sections added to the original lessons:**
  - network topologies and store-and-forward delay, with a numerical (*How Data Travels*);
  - devices by layer and connection-oriented service (*Layered Models*);
  - demultiplexing by port and protocol number (*Encapsulation*);
  - MAC address structure and cut-through switching (*Ethernet*);
  - RARP, BOOTP and proxy ARP (*ARP & DHCP*);
  - static NAT, dynamic NAT and PAT (*NAT*);
  - IPv6 header fields and extension headers (*IPv6*);
  - administrative distance (*Routing*);
  - zones, delegation and the SOA record (*DNS Records*);
  - block ciphers, modes and AEAD, with small-number RSA and Diffie–Hellman (*Crypto Foundations*);
  - IPsec transport vs tunnel mode, AH vs ESP (*VPNs*);
  - circuit-breaker states (*Service Networking*).
- **Every new numerical was computed in code before it was written down**, for example RSA with n = 33 (ciphertext 31, d = 7), Diffie–Hellman with p = 23 (shared secret 2), and 1,000 packets across four store-and-forward links (802.4 ms).

## Update 2: practice and new lessons

- **Practice 90 → 342 items:**
  - 126 MCQs;
  - 150 numericals;
  - 66 written exercises with worked solutions.

  Every lesson has at least 6 items, with at least 2 numericals or exercises. The content validator checks each numerical answer against its worked solution.
- **31 of 49 lessons now have practice that uses a lab or visualization** (none did before). The lab items ask something the lab answers. Examples:
  - lose the SYN-ACK in the TCP lab, then describe each side's state and what each retransmits;
  - resolve a name with a cold cache, a warm cache and after its TTL in the DNS simulator, counting the queries each time;
  - set `Cache-Control` for fingerprinted assets, the HTML that loads them, and an API response in the HTTP caching simulator;
  - model a Java connection pool as an M/M/c queue in the OS track's queueing lab (24 connections for 400 requests/s).
- **Seven new lessons:**
  - *Framing and Error Detection* (level 2) covers byte and bit stuffing, parity, the Internet checksum, CRC by XOR division (1101011011 with 10011 leaves 1110), Hamming(7,4) correction, and Java's `CRC32`.
  - *Reliable Delivery* (level 2) covers stop-and-wait utilization 1 / (1 + 2a), Go-Back-N and Selective Repeat, why their windows are limited to 2^k − 1 and 2^(k−1), and how TCP mixes the two.
  - *Sharing a Link* (level 2) covers pure and slotted ALOHA (18.4% and 36.8%), CSMA/CD with the minimum frame calculation and binary exponential backoff, and Wi-Fi's CSMA/CA with RTS/CTS.
  - *Routing Algorithms* (level 3) covers Dijkstra traced on a five-router network with a Java implementation, Bellman-Ford, count to infinity and its fixes, RIP vs OSPF, OSPF areas, and BGP's path vector.
  - *Email, File Transfer and Remote Access* (level 7) covers SMTP, IMAP and POP3, SPF, DKIM and DMARC, FTP's active and passive modes, and SSH.
  - *Networking in Java* (level 9) covers blocking sockets vs NIO vs virtual threads, `HttpClient` used correctly, the three timeouts every call needs, pool sizing (24 connections for 400 requests/s at 50 ms), the JVM's DNS cache (30 s, 10 s for failures), and "PKIX path building failed".
  - *Network Security* (level 11) covers stateless and stateful firewalls, DMZs, security groups vs network ACLs, WAFs, IDS vs IPS, the three kinds of DDoS, a Java token bucket, and zero trust.
- **Structure and roadmaps:**
  - Level 2 is now *Data Link & LAN*, and level 7 is *HTTP & Application Protocols*.
  - The "how machines talk" roadmap gains error detection, ARQ, MAC protocols, routing algorithms and email.
  - *Networking in Java* joins the I/O roadmap, and *Network Security* the web and advanced roadmaps.

## Update 3: understandability

Measured on the theory sections (Mental Model through Example):

| Measure | Before (42 lessons) | After (49 lessons) |
|---|---|---|
| Sentences over 45 words | 14 | 0 |
| Sentences over 35 words | 57 | 0 |
| Sentences over 30 words | 137 | 98 |
| Worked examples with concrete values (`text` traces) | 22 | 37 |
| Networking terms with a hover definition | 0 | 143 (335 first uses marked) |

- **Long sentences were rewritten, not trimmed.** Lists hidden inside sentences became bullet lists, and no facts or links were removed.
- **New worked traces with real values**, for example:
  - Dijkstra's algorithm settling A, B, C, D, E with every distance shown;
  - a CRC division and a Hamming syndrome;
  - Go-Back-N recovering from one lost frame;
  - an Internet checksum over a real IPv4 header (B861);
  - count to infinity, exchange by exchange.
- **The glossary covers Networks lessons now.** The first plain use of a term shows a definition on hover or tap, with a link to the lesson that explains it.
  - An entry marks only lessons of its own subject, so "frame" in an OS lesson never links to Ethernet frames.
  - Words that mean something else in some lessons are kept out of those lessons. For example, "TTL" (the IP hop limit) isn't marked in the DNS, CDN and caching lessons, where TTL means a cache lifetime. "Sequence number" isn't marked in the crypto and TLS lessons. "Frame" is marked only in link-layer lessons.

## Update 4: diagrams

| Measure | Before | After |
|---|---|---|
| Lessons with a Mermaid diagram | 16 of 42 | 49 of 49 |
| Mermaid diagrams | 16 | 55 |
| Diagrams below 80% of natural size (desktop column) | — | 0 |

- **39 new diagrams**, each placed next to the text it illustrates. For example:
  - a request's path from a laptop through NAT and the backbone to a server;
  - demultiplexing from the EtherType to the protocol number to a socket;
  - the DHCP DORA exchange;
  - NAT rewriting a connection in both directions;
  - an IPv6 extension-header chain;
  - stop-and-wait with a lost ACK, and Go-Back-N after a loss;
  - the routing graph Dijkstra runs on;
  - a certificate chain from the root CA to the leaf;
  - a CORS preflight;
  - a server-side session backed by Redis;
  - retries multiplying across three tiers (27 calls);
  - a DMZ between two firewalls.
- **Readable at real size.** Every diagram was measured at its rendered width in a desktop window.
  - Six first rendered below 80% of natural size: API styles, cookies and sessions, HTTP fundamentals, MTU and congestion, network security and routing algorithms.
  - Wide fans became left-to-right, the routing graph became top-to-bottom, and long sequence messages were shortened. All six now render at 91% or more.
  - The original 16 diagrams had already been fixed for size in an earlier session (11 of them needed it).

## Update 5: Java examples

| Code blocks | Before | After |
|---|---|---|
| Java | 0 | 14 (in 10 lessons) |
| Python | 3 | 0 |
| Shell (kept as shell) | 23 | 25 |
| HTTP messages (kept) | 13 | 13 |

- **Program code is Java.** Examples:
  - `DataInputStream.readFully` replaces Python's `recv_exact` for length-prefixed framing;
  - a `ServerSocket` echo server, with connect and read timeouts;
  - `DatagramSocket` replaces Python's UDP socket;
  - a `java.net.http.WebSocket` client;
  - HMAC webhook verification with a constant-time `MessageDigest.isEqual`;
  - `CRC32` and an Internet checksum;
  - Dijkstra's algorithm with a `PriorityQueue`;
  - `HttpClient` with timeouts, and a token-bucket rate limiter.
- **Kept on purpose:** shell commands (`dig`, `curl`, `ss`, `tcpdump`, `openssl`) and raw HTTP messages, because they are what you type and read on a server.
- **Compile-checked.** All 14 blocks went through `javac` 21 with `scripts/_verify-java.mts`: 10 compile as written, and 4 compile apart from names the lesson defines around them. None failed. The check's import list gained `java.security`, `javax.crypto`, `javax.net.ssl` and `java.util.zip` for these lessons. It also caught one problem in the new code: the CRC32 snippet was missing its import.

## Update 6: labs

Three labs for the new data-link and routing theory, each checked against the lesson's own worked answers.

- **Error Detection** (`/labs/error-detection`) has three tabs.
  - **CRC:** the sender's XOR long division step by step, for three generators. You then click bits to damage the frame and see the receiver's remainder. It shows that an error pattern equal to the generator goes undetected.
  - **Hamming code:** any 1–11 data bits, with the check bits, what each covers, and the syndrome. Flip one bit and it is corrected; flip two and the receiver "corrects" the wrong bit.
  - **Checksum and parity:** the Internet checksum over any 16-bit words, with each end-around carry shown, plus even and odd parity.

  It reproduces the lesson's examples: remainder 1110, codeword 0110011 and checksum B861.
- **ARQ Protocols** (`/labs/arq-protocols`) runs stop-and-wait, Go-Back-N and Selective Repeat over the same link. You choose the window, the propagation delay a and which frames lose their first transmission. It draws the sender's timeline, logs every send, discard, ACK and timeout, and warns when the window is too large for the sequence bits.

  It agrees with the lesson: losing frame 2 costs Go-Back-N 12 transmissions and Selective Repeat 9, and stop-and-wait at a = 2.5 runs at 16.7%.
- **Routing Algorithms** (`/labs/routing-algorithms`) has three tabs on the lesson's five-router network. You can change any link cost or fail a link.
  - **Dijkstra**, step by step, with the forwarding table at the end.
  - **Distance vector:** every router's table after each exchange, with the changes highlighted.
  - **Count to infinity** on A — B — C, with no fix, split horizon or poison reverse.

  With no fix the distances climb to 16 in 15 exchanges; either fix ends it in 2. Failing C–D moves A's routes to D and E from C to B, with costs 5 and 7, as in the lesson's practice.
- **Practice:** the three lessons gained 5 lab-based items. Seven other lessons gained one each, using the encapsulation, queueing, routing and TCP labs. Their answers were worked out with the same code the labs run. For example:
  - four backends with separate queues average 50 ms, while one shared queue (M/M/4) averages 17.5 ms, which is why least-outstanding-requests balancing works (*Load Balancers*);
  - a 10 ms server at 90% busy averages 100 ms, with p99 near 460 ms (*Tail Latency*);
  - the server's half-open SYN_RECV entry after a lost SYN-ACK is what a SYN flood exhausts (*Network Security*);
  - R1's NAT entry explains why two peers behind NATs need hole punching (*VPNs and NAT Traversal*).

  Totals: practice 330 → 342 items, and lessons whose practice uses a lab 31 → 40. Track practice goes from 8.6 to 8.8; the overall stays 8.9.

## Readiness by audience

| Audience | Before | After | Comment |
|---|---|---|---|
| **Freshers / campus placements / GATE-style theory** | 6.5 | **8.9** | The data link layer, routing algorithms and the security chapter were missing; now they are taught with traces and numericals. Numericals cover subnetting, CRC and Hamming, ARQ utilization and windows, ALOHA, Dijkstra, transmission and propagation delay, RSA and Diffie–Hellman. ARQ, CRC and routing have labs of their own. |
| **1–3 YOE Java backend** | 7.5 | **8.9** | *Networking in Java* covers what Java incidents actually involve: missing timeouts, pool sizing, the JVM DNS cache after a failover, and PKIX errors. Sockets, UDP, WebSockets and HMAC are shown in Java. |
| **3–5+ YOE / systems and SRE rounds** | 8.3 | **8.7** | The production lessons were already strong. Queueing practice now backs the tail-latency and load-balancer lessons, and network security covers firewalls, NACLs and DDoS defence. Packet-level debugging is still read about, not practised. |

## What is still missing (honest gaps)

- **Written exercises are self-graded.** MCQs and the 150 numericals are checked automatically. The 66 written exercises rely on comparing your answer with the worked solution.
- **9 lessons have no lab-based practice:** MAC protocols, IPv6, email, cookies and sessions, CORS and CSRF, API styles, MTU and congestion, BGP and anycast, and service networking. Labs that would help:
  - an ALOHA and CSMA/CD simulator with collisions and backoff;
  - a PMTU and MSS calculator for tunnels and overlays;
  - a CORS preflight simulator;
  - BGP path selection with prepending and more-specific prefixes.
- **No packet captures.** `tcpdump`, Wireshark and `ss` appear in the lessons, but nothing lets you read a real capture.
- **IPv4-first.** The subnet calculator handles only IPv4, and IPv6 gets one lesson.
- **The Java check isn't part of the build.** `scripts/_verify-java.mts` needs a local JDK, so it runs by hand, not in `npm run check` or the Cloudflare build. None of the code is executed.
- **98 theory sentences are still over 30 words.** The readability work removed everything over 35 words first.
- **Production relevance barely moved (8.8 → 8.9 on the original 42 lessons).** It was already high, and these rounds added practice, theory and Java, not new operational depth.

## Per-lesson scorecard

Arrows show before → after where something changed. Questions and practice items are counts; the other columns are scores. Lessons are in course order.

| Lesson | Questions | Practice items | Content | First principles | Interview | Practice | Production | Syllabus | Overall |
|---|---|---|---|---|---|---|---|---|---|
| `cn-how-data-travels` | 5 → 7 | 2 → 7 | 9 | 9 | 8 → **9** | 4 → **9** | 8 | 7 → **9** | 7.5 → **8.8** |
| `cn-layered-models` | 5 → 7 | 2 → 7 | 9 | 9 | 8 → **9** | 3 → **9** | 8 | 8 → **9** | 7.5 → **8.8** |
| `cn-encapsulation` | 4 → 6 | 2 → 7 | 9 | 9 | 8 → **9** | 4 → **9** | 9 | 9 | 8.0 → **9.0** |
| `cn-ethernet-switching` | 4 → 6 | 2 → 8 | 9 | 9 | 8 → **9** | 3 → **9** | 8 | 7 → **9** | 7.3 → **8.8** |
| `cn-arp-dhcp` | 5 → 6 | 2 → 7 | 9 | 9 | 9 | 3 → **9** | 9 | 8 → **9** | 7.8 → **9.0** |
| `cn-error-detection` | 6 (new) | 9 (new) | 9 | 9 | 9 | 9 | 8 | 9 | **8.8** (new) |
| `cn-arq-protocols` | 6 (new) | 10 (new) | 9 | 9 | 9 | 9 | 8 | 9 | **8.8** (new) |
| `cn-mac-protocols` | 6 (new) | 7 (new) | 9 | 9 | 9 | 8 | 7 | 9 | **8.5** (new) |
| `cn-ipv4-addressing` | 5 → 6 | 3 → 7 | 9 | 9 | 9 | 4 → **9** | 8 | 9 | 8.0 → **8.8** |
| `cn-subnetting` | 5 → 6 | 3 → 6 | 9 | 9 | 9 | 4 → **9** | 8 | 9 | 8.0 → **8.8** |
| `cn-routing` | 5 → 6 | 2 → 7 | 9 | 9 | 8 → **9** | 3 → **9** | 9 | 7 → **9** | 7.5 → **9.0** |
| `cn-nat` | 5 → 6 | 2 → 7 | 9 | 9 | 9 | 3 → **9** | 9 | 8 → **9** | 7.8 → **9.0** |
| `cn-ip-packet-icmp` | 5 → 6 | 2 → 7 | 9 | 9 | 9 | 4 → **9** | 9 | 9 | 8.2 → **9.0** |
| `cn-ipv6` | 4 → 6 | 2 → 7 | 9 | 9 | 8 → **9** | 3 → **8** | 8 | 8 → **9** | 7.5 → **8.7** |
| `cn-routing-algorithms` | 6 (new) | 9 (new) | 9 | 9 | 9 | 9 | 8 | 9 | **8.8** (new) |
| `cn-tcp-fundamentals` | 6 → 7 | 2 → 7 | 9 | 9 | 9 | 4 → **9** | 9 | 9 | 8.2 → **9.0** |
| `cn-sockets` | 5 → 6 | 2 → 7 | 9 | 9 | 9 | 3 → **9** | 9 | 9 | 8.0 → **9.0** |
| `cn-tcp-handshake` | 6 | 2 → 7 | 9 | 9 | 9 | 4 → **9** | 9 | 9 | 8.2 → **9.0** |
| `cn-tcp-reliability` | 6 | 2 → 7 | 9 | 9 | 9 | 4 → **9** | 9 | 9 | 8.2 → **9.0** |
| `cn-tcp-flow-control` | 6 | 3 → 7 | 9 | 9 | 9 | 4 → **9** | 9 | 9 | 8.2 → **9.0** |
| `cn-tcp-congestion-control` | 6 | 3 → 7 | 9 | 9 | 9 | 4 → **9** | 9 | 9 | 8.2 → **9.0** |
| `cn-tcp-termination` | 6 | 2 → 6 | 9 | 9 | 9 | 4 → **9** | 9 | 9 | 8.2 → **9.0** |
| `cn-udp` | 5 → 6 | 2 → 8 | 9 | 9 | 9 | 3 → **9** | 9 | 9 | 8.0 → **9.0** |
| `cn-dns-fundamentals` | 6 → 7 | 2 → 7 | 9 | 9 | 9 | 3 → **9** | 9 | 9 | 8.0 → **9.0** |
| `cn-dns-records` | 4 → 6 | 2 → 7 | 9 | 9 | 8 → **9** | 3 → **9** | 9 | 8 → **9** | 7.7 → **9.0** |
| `cn-http-fundamentals` | 5 → 6 | 2 → 7 | 9 | 9 | 9 | 3 → **9** | 9 | 9 | 8.0 → **9.0** |
| `cn-http-connections` | 4 → 6 | 2 → 6 | 9 | 9 | 8 → **9** | 4 → **9** | 9 | 9 | 8.0 → **9.0** |
| `cn-http-caching` | 5 | 2 → 6 | 9 | 9 | 9 | 3 → **9** | 9 | 9 | 8.0 → **9.0** |
| `cn-http2` | 4 → 6 | 2 → 6 | 9 | 9 | 8 → **9** | 3 → **9** | 9 | 9 | 7.8 → **9.0** |
| `cn-http3-quic` | 4 → 6 | 2 → 6 | 9 | 9 | 8 → **9** | 3 → **9** | 9 | 9 | 7.8 → **9.0** |
| `cn-email-file-transfer` | 6 (new) | 7 (new) | 9 | 9 | 9 | 8 | 8 | 9 | **8.7** (new) |
| `cn-crypto-foundations` | 4 → 6 | 2 → 7 | 9 | 9 | 8 → **9** | 3 → **9** | 8 → **9** | 7 → **9** | 7.3 → **9.0** |
| `cn-certificates-pki` | 4 → 6 | 2 → 7 | 9 | 9 | 8 → **9** | 3 → **9** | 9 | 9 | 7.8 → **9.0** |
| `cn-tls-handshake` | 6 | 3 → 7 | 9 | 9 | 9 | 4 → **9** | 9 | 9 | 8.2 → **9.0** |
| `cn-cookies-sessions` | 4 → 6 | 2 → 7 | 9 | 9 | 8 → **9** | 3 → **8** | 9 | 9 | 7.8 → **8.8** |
| `cn-cors-csrf` | 4 → 6 | 2 → 7 | 9 | 9 | 8 → **9** | 3 → **8** | 9 | 9 | 7.8 → **8.8** |
| `cn-realtime` | 4 → 6 | 2 → 7 | 9 | 9 | 8 → **9** | 3 → **9** | 9 | 9 | 7.8 → **9.0** |
| `cn-proxies-load-balancers` | 5 → 6 | 2 → 8 | 9 | 9 | 9 | 3 → **9** | 9 | 9 | 8.0 → **9.0** |
| `cn-cdn` | 4 → 6 | 2 → 6 | 9 | 9 | 8 → **9** | 3 → **9** | 9 | 9 | 7.8 → **9.0** |
| `cn-api-styles` | 4 → 6 | 2 → 6 | 9 | 9 | 8 → **9** | 3 → **8** | 9 | 8 | 7.7 → **8.7** |
| `cn-java-networking` | 7 (new) | 7 (new) | 9 | 9 | 9 | 9 | 9 | 8 | **8.8** (new) |
| `cn-latency-bandwidth` | 5 → 6 | 3 → 6 | 9 | 9 | 9 | 4 → **9** | 9 | 9 | 8.2 → **9.0** |
| `cn-tail-latency` | 4 → 6 | 2 → 7 | 9 | 9 | 8 → **9** | 4 → **9** | 9 | 9 | 8.0 → **9.0** |
| `cn-mtu-congestion` | 3 → 6 | 2 → 6 | 9 | 9 | 7 → **9** | 4 → **8** | 9 | 9 | 7.8 → **8.8** |
| `cn-bgp-anycast` | 3 → 6 | 2 → 6 | 9 | 9 | 7 → **9** | 3 → **8** | 9 | 8 → **9** | 7.5 → **8.8** |
| `cn-service-networking` | 4 → 6 | 2 → 6 | 9 | 9 | 8 → **9** | 3 → **8** | 9 | 8 → **9** | 7.7 → **8.8** |
| `cn-container-networking` | 4 → 6 | 2 → 7 | 9 | 9 | 8 → **9** | 3 → **9** | 9 | 9 | 7.8 → **9.0** |
| `cn-vpn-nat-traversal` | 3 → 6 | 2 → 7 | 9 | 9 | 7 → **9** | 4 → **9** | 9 | 8 → **9** | 7.7 → **9.0** |
| `cn-network-security` | 7 (new) | 8 (new) | 9 | 9 | 9 | 9 | 9 | 9 | **9.0** (new) |
