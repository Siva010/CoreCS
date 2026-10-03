// Curriculum skeleton: subjects, levels, mastery areas, study stages and
// interview roadmaps. Individual lessons live in content/lessons/<subject>/*.md
// and declare their own level, stage and prerequisites in frontmatter.
import type { RoadmapDef, StageDef, SubjectDef } from "@/lib/content/types";

export const SUBJECTS: SubjectDef[] = [
  {
    id: "os",
    path: "os",
    title: "Operating Systems",
    short: "OS",
    tagline: "Understand execution, memory, concurrency and I/O.",
    description:
      "From the hardware/software boundary to page faults, schedulers, locks and epoll. Learn what the kernel is actually doing on behalf of every program you run — and why it matters for the servers you build.",
    levels: [
      { n: 0, title: "OS Mental Model", summary: "What an operating system does, the hardware it manages, and what really happens when a program runs." },
      { n: 1, title: "Processes", summary: "Programs in execution: lifecycle, PCB, fork/exec, signals, context switches and IPC." },
      { n: 2, title: "Threads & Concurrency", summary: "Threads, shared memory, race conditions and the practical toolbox of concurrency primitives." },
      { n: 3, title: "CPU Scheduling", summary: "How the kernel decides who runs next — metrics, classic algorithms and real schedulers." },
      { n: 4, title: "Synchronization", summary: "The critical-section problem, atomic instructions, semaphores, monitors and the classic problems." },
      { n: 5, title: "Deadlocks", summary: "Coffman conditions, resource-allocation graphs, prevention, avoidance (Banker's), detection and recovery." },
      { n: 6, title: "Memory Management", summary: "Address spaces, the heap allocator, paging, page tables, TLBs and segmentation." },
      { n: 7, title: "Virtual Memory", summary: "Demand paging, page faults, replacement algorithms, thrashing, copy-on-write, mmap, huge pages and NUMA." },
      { n: 8, title: "Storage & Filesystems", summary: "Disks and SSDs, file descriptors, inodes, journaling, the page cache and RAID." },
      { n: 9, title: "I/O & the Kernel Boundary", summary: "System calls, interrupts, I/O models and the event loops that power backend servers." },
      { n: 10, title: "OS Performance", summary: "Diagnosing CPU, memory, I/O and contention bottlenecks like a working engineer." },
      { n: 11, title: "Isolation: VMs & Containers", summary: "Hypervisors, namespaces and cgroups — how modern infrastructure isolates workloads." },
    ],
    areas: [
      { id: "os-execution", title: "Processes & Scheduling", levels: [0, 1, 3] },
      { id: "os-concurrency", title: "Concurrency", levels: [2, 4, 5] },
      { id: "os-memory", title: "Memory", levels: [6, 7] },
      { id: "os-io", title: "Storage & I/O", levels: [8, 9] },
      { id: "os-performance", title: "Performance & Isolation", levels: [10, 11] },
    ],
  },
  {
    id: "cn",
    path: "networks",
    title: "Computer Networks",
    short: "Networks",
    tagline: "Understand how systems communicate.",
    description:
      "From frames and packets to TCP congestion control, DNS, TLS, HTTP/3 and Kubernetes networking. Built around one question: what actually happens to your bytes between two machines?",
    levels: [
      { n: 0, title: "Networking Mental Model", summary: "How data physically and logically travels from one machine to another." },
      { n: 1, title: "Network Models", summary: "Layering, OSI vs TCP/IP, and a real HTTP request traveling down and up the stack." },
      { n: 2, title: "Ethernet & LAN", summary: "Frames, MAC addresses, switches, broadcast domains, VLANs — and how a host joins a network (ARP, DHCP)." },
      { n: 3, title: "IP", summary: "Addressing, CIDR, subnetting, routing, NAT, ICMP and IPv6." },
      { n: 4, title: "TCP", summary: "Sockets, the handshake, reliability, flow control, congestion control and connection teardown." },
      { n: 5, title: "UDP", summary: "The datagram model and when giving up TCP's guarantees is the right call." },
      { n: 6, title: "DNS", summary: "The distributed naming system every request depends on — and how it fails." },
      { n: 7, title: "HTTP", summary: "Semantics, connections, caching, HTTP/2 multiplexing and HTTP/3 over QUIC." },
      { n: 8, title: "TLS & HTTPS", summary: "Cryptographic building blocks, certificates and exactly what happens in a TLS handshake." },
      { n: 9, title: "Web Networking", summary: "Cookies, CORS, CSRF, real-time transports, proxies, load balancers, CDNs and API styles." },
      { n: 10, title: "Network Performance", summary: "Latency, bandwidth, BDP, percentiles and the calculations behind them." },
      { n: 11, title: "Advanced Networking", summary: "BGP, anycast, service networking, containers, Kubernetes, VPNs and NAT traversal." },
    ],
    areas: [
      { id: "cn-fundamentals", title: "Fundamentals & IP", levels: [0, 1, 2, 3] },
      { id: "cn-transport", title: "TCP & UDP", levels: [4, 5] },
      { id: "cn-dns", title: "DNS", levels: [6] },
      { id: "cn-http", title: "HTTP", levels: [7] },
      { id: "cn-tls", title: "TLS", levels: [8] },
      { id: "cn-web", title: "Web & Infrastructure", levels: [9, 11] },
      { id: "cn-performance", title: "Performance", levels: [10] },
    ],
  },
  {
    id: "db",
    path: "databases",
    title: "Databases",
    short: "Databases",
    tagline: "Understand how data is stored, queried, synchronized and recovered.",
    description:
      "SQL from first query to window functions, then down into pages, B+ trees, query planners, MVCC, WAL and recovery — and out to replication, sharding and distributed consistency.",
    levels: [
      { n: 0, title: "Database Mental Model", summary: "Why databases exist and what a DBMS does that files cannot." },
      { n: 1, title: "Relational Model", summary: "Relations, keys, constraints and relationships." },
      { n: 2, title: "SQL Fundamentals", summary: "SELECT, filtering, NULL logic, aggregation and data modification.", track: "sql" },
      { n: 3, title: "SQL Joins", summary: "Every join type, visualized — including semi and anti joins.", track: "sql" },
      { n: 4, title: "Advanced SQL", summary: "Subqueries, CTEs, window functions, set operations, views and interview problem patterns.", track: "sql" },
      { n: 5, title: "Data Modeling", summary: "ER modeling, functional dependencies, normalization and practical schema design." },
      { n: 6, title: "Storage Internals", summary: "Pages, buffer pools, B+ trees, LSM trees and columnar storage." },
      { n: 7, title: "Indexing", summary: "Why indexes work, how to choose them, and what they cost." },
      { n: 8, title: "Query Execution", summary: "Parsing, planning, join algorithms, EXPLAIN and practical optimization." },
      { n: 9, title: "Transactions", summary: "ACID precisely, and how atomicity and durability are implemented with a WAL." },
      { n: 10, title: "Concurrency Control", summary: "Anomalies, isolation levels, locking, MVCC and optimistic vs pessimistic strategies." },
      { n: 11, title: "Recovery", summary: "Checkpoints, redo/undo and what happens when the server crashes right after COMMIT." },
      { n: 12, title: "Replication", summary: "Leaders, followers, lag, failover and split brain." },
      { n: 13, title: "Partitioning & Sharding", summary: "Splitting data across tables and machines, consistent hashing and hot partitions." },
      { n: 14, title: "NoSQL & Caching", summary: "Key-value, document, wide-column and graph models — and when each makes sense." },
      { n: 15, title: "Distributed Databases", summary: "CAP, PACELC, consistency models, quorums, consensus and distributed transactions." },
    ],
    areas: [
      { id: "db-sql", title: "SQL", levels: [2, 3, 4] },
      { id: "db-modeling", title: "Modeling", levels: [0, 1, 5] },
      { id: "db-internals", title: "Storage & Indexing", levels: [6, 7, 8] },
      { id: "db-transactions", title: "Transactions", levels: [9, 10, 11] },
      { id: "db-distributed", title: "Distributed DB", levels: [12, 13, 14, 15] },
    ],
  },
  {
    id: "x",
    path: "connections",
    title: "Cross-Domain Connections",
    short: "Connections",
    tagline: "Where OS, networking and databases meet in real systems.",
    description:
      "The lessons that tie everything together: one request, one query, one overloaded server — traced through every layer of the stack.",
    levels: [
      { n: 0, title: "End-to-End Journeys", summary: "Follow a single operation across application, kernel, network and database." },
      { n: 1, title: "Unifying Patterns", summary: "Caching, concurrency control and durability — the same ideas recurring at every layer." },
    ],
    areas: [{ id: "x-systems", title: "Systems Thinking", levels: [0, 1] }],
  },
];

export const STAGES: StageDef[] = [
  {
    n: 1,
    title: "Foundations",
    goal: "Understand how computers communicate, execute programs, and persist data.",
    description:
      "The mental models everything else rests on. If a later lesson feels like magic, the missing piece is usually here.",
  },
  {
    n: 2,
    title: "Interview Core",
    goal: "Answer standard entry-level software-engineering interview questions by reasoning, not recall.",
    description:
      "Scheduling, synchronization, deadlocks, virtual memory, TCP, HTTP, TLS, indexes, transactions and isolation — the topics interviewers probe most.",
  },
  {
    n: 3,
    title: "Engineering Depth",
    goal: "Reason about real backend systems.",
    description:
      "I/O models, filesystems, performance, HTTP/2 and HTTP/3, CDNs, MVCC, recovery, replication and sharding — what you need when a production system misbehaves.",
  },
  {
    n: 4,
    title: "Advanced",
    goal: "Develop senior-level conceptual awareness without pretending it replaces production experience.",
    description:
      "NUMA, kernel I/O, QUIC, BGP, service meshes, consistency models, consensus and distributed transactions.",
  },
];

export const ROADMAPS: RoadmapDef[] = [
  {
    id: "fresher",
    title: "Fresher / Entry-Level",
    audience: "Final-year students and new graduates preparing for SDE-1 interviews.",
    summary:
      "DSA-independent CS fundamentals: how programs execute, how machines talk, and how to write correct SQL. Enough depth that you can answer the follow-up question, not just the first one.",
    expectations: [
      "Explain process vs thread, what a context switch costs, and why race conditions happen.",
      "Solve scheduling, page-replacement and Banker's algorithm numericals.",
      "Walk through what happens when you type a URL: DNS, TCP, TLS, HTTP.",
      "Write joins, aggregations, subqueries and window functions fluently.",
      "Explain indexes, ACID, isolation levels and normalization with examples.",
    ],
    notCovered: [
      "Interviewers at this level rarely expect production war stories — but they do expect you to reason from mechanisms when a question goes one step beyond the definition.",
      "This roadmap does not cover DSA or system design; it complements them.",
    ],
    phases: [
      {
        title: "How a computer runs your code",
        weeks: "Week 1",
        focus: "Build the OS mental model before memorizing anything.",
        lessons: ["os-what-an-os-does", "os-hardware-model", "os-program-execution", "os-processes", "os-process-creation", "os-context-switch", "os-threads"],
        practice: ["lab:process-lifecycle", "Interview Mode: OS Level 1 (Basic + Intermediate)"],
      },
      {
        title: "How machines talk",
        weeks: "Week 2",
        focus: "Packets, addresses, TCP and the request lifecycle.",
        lessons: ["cn-how-data-travels", "cn-layered-models", "cn-encapsulation", "cn-ipv4-addressing", "cn-subnetting", "cn-tcp-fundamentals", "cn-tcp-handshake", "cn-udp", "cn-dns-fundamentals", "cn-http-fundamentals"],
        practice: ["lab:subnet-calculator", "lab:tcp-handshake", "lab:dns-resolver"],
      },
      {
        title: "Data and SQL",
        weeks: "Week 3",
        focus: "Relational thinking and fluent SQL — practiced against a real PostgreSQL in your browser.",
        lessons: ["db-why-databases", "db-relational-model", "db-keys-constraints", "sql-select-basics", "sql-null-logic", "sql-aggregation", "sql-joins", "sql-semi-anti-joins", "sql-subqueries-ctes", "sql-window-functions", "sql-interview-patterns", "db-normalization"],
        practice: ["lab:sql-playground", "lab:normalization"],
      },
      {
        title: "Interview core: concurrency and memory",
        weeks: "Week 4",
        focus: "The OS topics that produce the most follow-up questions.",
        lessons: ["os-race-conditions", "os-sync-primitives", "os-classic-sync-problems", "os-deadlocks", "os-deadlock-handling", "os-scheduling-basics", "os-scheduling-algorithms", "os-address-spaces", "os-paging", "os-page-faults", "os-page-replacement"],
        practice: ["lab:cpu-scheduler", "lab:page-replacement", "lab:bankers", "lab:producer-consumer"],
      },
      {
        title: "Interview core: the web and transactions",
        weeks: "Week 5",
        focus: "HTTP, TLS, indexes and isolation — the backend fundamentals.",
        lessons: ["cn-http-connections", "cn-http-caching", "cn-tls-handshake", "cn-cookies-sessions", "cn-proxies-load-balancers", "db-index-fundamentals", "db-composite-covering-indexes", "db-transactions-acid", "db-anomalies", "db-isolation-levels"],
        practice: ["lab:isolation", "lab:btree", "lab:query-plan"],
      },
      {
        title: "Tie it together",
        weeks: "Week 6",
        focus: "End-to-end reasoning, traps and mock interviews.",
        lessons: ["x-website-journey", "x-sql-query-journey"],
        practice: ["Interview Traps (all)", "Interview Mode: mixed mock sessions", "Revision: 30-minute mode for every Stage 1–2 lesson"],
      },
    ],
    extras: [
      {
        title: "OOP connections interviewers like",
        body:
          "Where objects live (stack vs heap) → *Address Spaces*. Why immutable objects are thread-safe → *Race Conditions*. Why `synchronized`/`Lock` exist → *Concurrency Primitives*. How classes map to tables (and where ORMs leak) → *Schema Design* and *Query Optimization* (the N+1 problem). Garbage collection vs malloc/free → *Dynamic Memory Allocation*.",
      },
    ],
  },
  {
    id: "yoe-1-3",
    title: "1–3 Years of Experience",
    audience: "Backend and full-stack engineers moving from 'it works' to 'I know why it works — and why it broke'.",
    summary:
      "Everything in the fresher track, plus the mechanisms behind production behavior: concurrency primitives, I/O models, TCP internals, query plans, locking, MVCC, caching and replication.",
    expectations: [
      "Explain why a service is slow using CPU, memory, I/O and contention vocabulary — and what you would measure.",
      "Read an EXPLAIN ANALYZE plan and propose an index or rewrite.",
      "Reason about TIME_WAIT, connection pools, keep-alive and timeouts.",
      "Choose between optimistic and pessimistic concurrency and explain the failure modes of each.",
      "Discuss replication lag and the read-your-writes problem.",
    ],
    notCovered: [
      "Conceptual understanding makes production debugging faster — it does not replace having debugged production. Pair this material with the case studies and, ideally, your own incidents.",
    ],
    phases: [
      {
        title: "Fresher track (review)",
        weeks: "Weeks 1–2",
        focus: "Skim with 15-minute revision mode; stop and deep-dive wherever a follow-up question would stump you.",
        lessons: ["os-processes", "os-threads", "os-race-conditions", "os-paging", "cn-tcp-handshake", "cn-dns-fundamentals", "cn-http-fundamentals", "sql-joins", "sql-window-functions", "db-index-fundamentals", "db-isolation-levels"],
        practice: ["Revision: 15-minute mode", "Interview Traps"],
      },
      {
        title: "Concurrency for real",
        weeks: "Week 3",
        focus: "What the primitives actually do, and why more threads is not more throughput.",
        lessons: ["os-concurrency-vs-parallelism", "os-atomic-instructions", "os-semaphores-monitors", "os-thread-pools", "os-cpu-caches-contention"],
        practice: ["lab:race-condition", "lab:producer-consumer", "case:thread-contention"],
      },
      {
        title: "I/O, networking internals and performance",
        weeks: "Week 4",
        focus: "From system call to socket to TCP window.",
        lessons: ["os-syscalls-interrupts", "os-io-models", "os-epoll-event-loops", "os-file-descriptors", "os-page-cache", "cn-sockets", "cn-tcp-reliability", "cn-tcp-flow-control", "cn-tcp-congestion-control", "cn-tcp-termination", "cn-latency-bandwidth", "cn-tail-latency", "os-performance-method", "os-profiling-observability"],
        practice: ["lab:sliding-window", "lab:congestion", "lab:network-calculator", "case:connection-exhaustion", "case:high-cpu"],
      },
      {
        title: "Modern web",
        weeks: "Week 5",
        focus: "HTTP/2, real-time transports, CDNs and API styles.",
        lessons: ["cn-http2", "cn-realtime", "cn-cdn", "cn-api-styles", "cn-cors-csrf"],
        practice: ["lab:http-cache", "lab:realtime-transports"],
      },
      {
        title: "Databases in production",
        weeks: "Weeks 6–7",
        focus: "Plans, locks, MVCC, caching and replication.",
        lessons: ["db-query-lifecycle", "db-scans-joins", "db-explain", "db-query-optimization", "db-index-design-practice", "db-wal-durability", "db-locking", "db-mvcc", "db-optimistic-pessimistic", "db-replication", "db-redis-caching"],
        practice: ["lab:query-plan", "lab:isolation", "lab:db-locks", "case:missing-index", "case:pool-exhaustion", "case:replication-lag"],
      },
      {
        title: "Systems thinking",
        weeks: "Week 8",
        focus: "Cross-layer reasoning under load.",
        lessons: ["x-slow-query", "x-overloaded-server", "x-connection-management"],
        practice: ["All case studies", "Interview Mode: Level 3 questions across subjects"],
      },
    ],
  },
  {
    id: "yoe-3-5",
    title: "3–5+ Years of Experience",
    audience: "Senior backend engineers and those preparing for distributed-systems or infrastructure-heavy loops.",
    summary:
      "Database internals, distributed data, advanced networking and OS performance — the concepts behind architecture discussions and deep-dive interview rounds.",
    expectations: [
      "Explain how a storage engine turns a COMMIT into durable bytes, and what recovery does after a crash.",
      "Discuss consistency models precisely — and the cost of each.",
      "Reason about partitioning strategies, hot keys and rebalancing.",
      "Explain what a service mesh, overlay network or anycast deployment is actually doing.",
      "Frame capacity and failure trade-offs quantitatively.",
    ],
    notCovered: [
      "Senior interviews reward judgment formed by operating real systems. This track gives you the vocabulary and the mechanisms; it cannot give you the scar tissue. Be honest about which is which in interviews — interviewers notice.",
    ],
    phases: [
      {
        title: "Database internals",
        weeks: "Weeks 1–2",
        focus: "What sits under the SQL.",
        lessons: ["db-pages-records", "db-buffer-pool", "db-btree", "db-lsm-trees", "db-column-stores", "db-clustered-indexes", "db-specialized-indexes", "db-crash-recovery"],
        practice: ["lab:btree", "lab:wal-recovery", "lab:lsm"],
      },
      {
        title: "Distributed data",
        weeks: "Weeks 3–4",
        focus: "Replication, partitioning, consistency and consensus.",
        lessons: ["db-failover", "db-partitioning", "db-sharding", "db-consistent-hashing", "db-wide-column", "db-cap-pacelc", "db-consistency-models", "db-quorums-consensus", "db-distributed-transactions", "db-distributed-sql"],
        practice: ["lab:replication", "lab:consistent-hashing", "lab:quorum", "case:hot-partition", "case:failover"],
      },
      {
        title: "Advanced networking",
        weeks: "Week 5",
        focus: "How traffic moves through modern infrastructure.",
        lessons: ["cn-http3-quic", "cn-mtu-congestion", "cn-bgp-anycast", "cn-service-networking", "cn-container-networking", "cn-vpn-nat-traversal"],
        practice: ["lab:routing", "case:packet-loss", "case:dns-outage"],
      },
      {
        title: "OS performance and isolation",
        weeks: "Week 6",
        focus: "The machine under your containers.",
        lessons: ["os-mlfq-real-schedulers", "os-hugepages-numa", "os-journaling", "os-virtualization-containers", "os-thrashing-working-set"],
        practice: ["case:memory-leak", "case:context-switch-storm"],
      },
      {
        title: "Unifying patterns",
        weeks: "Week 7",
        focus: "Recognize the same trade-off at every layer.",
        lessons: ["x-caching-everywhere", "x-concurrency-everywhere", "x-durability-chain"],
        practice: ["Interview Mode: Senior Touch questions", "All Under-the-Hood walkthroughs"],
      },
    ],
  },
];
