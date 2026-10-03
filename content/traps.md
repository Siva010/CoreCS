---
title: Interview Traps
---

## [os] "A process and a program are the same thing"

**Correction:** a program is a file; a process is a running instance with its own address space, registers, open files and scheduling state.

One program can run as many processes (every shell you open runs the same `/bin/bash`), and one process can replace its program entirely with `exec` while keeping its PID and open descriptors. Interviewers follow up with "what does the kernel keep per process?" — answer with the PCB contents ([Processes](lesson:os-processes)).

## [os] "Threads are cheap, so more threads means more throughput"

**Correction:** beyond the number of cores (for CPU-bound work), extra threads add context switches, cache pollution, memory and lock contention — throughput falls.

Size pools by workload: CPU-bound ≈ cores; I/O-bound ≈ cores × (1 + wait/compute), or use async I/O ([Thread Pools](lesson:os-thread-pools), case: [Context-Switch Storm](case:context-switch-storm)).

## [os] "fork() copies the whole memory of the parent"

**Correction:** modern kernels share the parent's pages copy-on-write; only pages that either side later writes are copied.

That's why fork + exec is cheap even for large processes — and why a write-heavy forked child (e.g., Redis snapshots) can suddenly double memory use ([Copy-on-Write](lesson:os-cow-mmap)).

## [os] "Concurrency and parallelism are the same"

**Correction:** concurrency is structuring a program as independent tasks that *can* overlap in time; parallelism is actually executing at the same instant on multiple cores.

A single-core event loop is highly concurrent and not parallel at all ([Concurrency vs Parallelism](lesson:os-concurrency-vs-parallelism)).

## [os] "volatile makes a variable thread-safe"

**Correction:** in C/C++ `volatile` only prevents certain compiler optimizations; it provides no atomicity and no inter-thread ordering. Use atomics or locks.

(In Java, `volatile` gives visibility and ordering, but `count++` on a volatile is still a non-atomic read-modify-write — [Race Conditions](lesson:os-race-conditions).)

## [os] "A deadlock is just a slow program / a livelock is a deadlock"

**Correction:** a deadlock is a cycle of waits where no thread can ever proceed; a livelock keeps threads busy (changing state) without progress; starvation is one thread never getting a resource while others progress.

Name the four Coffman conditions and which one each prevention technique breaks ([Deadlocks](lesson:os-deadlocks)).

## [os] "Virtual memory means using the disk as extra RAM"

**Correction:** virtual memory is address translation — each process gets its own address space mapped to physical frames by page tables. Swapping is one optional feature built on it.

Isolation, shared libraries, mmap, copy-on-write and lazy allocation all come from translation, not from swap ([Address Spaces](lesson:os-address-spaces)).

## [os] "Belady's anomaly applies to LRU"

**Correction:** only non-stack algorithms like FIFO can get *more* faults with *more* frames; LRU and OPT are stack algorithms and never do.

Try it in the [Page Replacement lab](lab:page-replacement) with the classic reference string ([Page Replacement](lesson:os-page-replacement)).

## [os] "write() means the data is on disk"

**Correction:** `write()` copies data into the page cache; durability needs `fsync()`/`fdatasync()` — and a device that honors flushes.

This is the heart of every database's durability design ([Durability Chain](lesson:x-durability-chain)).

## [os] "A context switch costs a few microseconds, so it doesn't matter"

**Correction:** the direct cost is microseconds; the indirect cost — cold caches, TLB refills, mispredicted branches — can be much larger and is paid by the next task.

At hundreds of thousands of switches per second it dominates ([Context Switch](lesson:os-context-switch)).

## [os] "Containers are lightweight virtual machines"

**Correction:** containers are ordinary processes isolated by kernel namespaces and limited by cgroups; they share the host kernel. VMs run their own kernels on virtualized hardware.

Consequences: faster startup and less overhead, but a weaker isolation boundary ([VMs & Containers](lesson:os-virtualization-containers)).

## [os] "epoll is faster because it's asynchronous I/O"

**Correction:** epoll is readiness notification: it tells you which descriptors can be read/written without blocking; the reads and writes themselves are still synchronous syscalls. Its advantage is O(ready) cost instead of O(watched) per wait.

True async completion-based I/O is io_uring (or IOCP on Windows) ([I/O Models](lesson:os-io-models)).

## [cn] "TCP guarantees delivery"

**Correction:** TCP guarantees that bytes the receiver *does* get are in order and uncorrupted, and it retries; it cannot guarantee delivery if the network or peer fails. An application-level acknowledgement is the only proof the other side processed your data.

A successful `send()` means the bytes are in your kernel's buffer, nothing more ([TCP Reliability](lesson:cn-tcp-reliability)).

## [cn] "UDP is unreliable, so it's only for unimportant data"

**Correction:** UDP just doesn't provide reliability itself; protocols build exactly the reliability they need on top — QUIC (HTTP/3), DNS with retries, real-time media with loss concealment.

Choosing UDP is about control over latency and head-of-line blocking, not about not caring ([UDP](lesson:cn-udp)).

## [cn] "A two-way handshake would be enough for TCP"

**Correction:** both sides must choose an initial sequence number *and* learn that the other side received it — four logical messages (SYN, ACK, SYN, ACK). The server's ACK and SYN travel in one segment, so it takes three packets; with only two, the server could never confirm the client got its sequence number.

This also protects against old duplicate SYNs creating bogus connections ([TCP Handshake](lesson:cn-tcp-handshake)).

## [cn] "TIME_WAIT is a bug you should disable"

**Correction:** TIME_WAIT (2×MSL) on the side that closes first prevents delayed segments from an old connection corrupting a new one with the same 4-tuple, and lets the final ACK be retransmitted.

Fix port exhaustion with connection reuse (keep-alive, pooling), not by removing the state ([TCP Termination](lesson:cn-tcp-termination)).

## [cn] "Flow control and congestion control are the same thing"

**Correction:** flow control protects the **receiver** (rwnd, advertised by the peer); congestion control protects the **network** (cwnd, inferred from loss/delay). The sender uses min(cwnd, rwnd).

([Flow Control](lesson:cn-tcp-flow-control), [Congestion Control](lesson:cn-tcp-congestion-control))

## [cn] "HTTP/2 solved head-of-line blocking"

**Correction:** HTTP/2 removed HTTP-level HOL blocking by multiplexing streams, but all streams share one TCP connection, so a single lost packet stalls every stream. HTTP/3 over QUIC fixes transport-level HOL blocking.

See it in the [Head-of-Line Blocking visualization](viz:hol-blocking) ([HTTP/3 & QUIC](lesson:cn-http3-quic)).

## [cn] "HTTPS encrypts everything, including which site I visit"

**Correction:** TLS hides URLs, headers and bodies, but the destination IP is visible, DNS may be visible (unless encrypted), and SNI in the ClientHello is plaintext unless Encrypted Client Hello is used.

([TLS Handshake](lesson:cn-tls-handshake))

## [cn] "The certificate proves the server's identity"

**Correction:** a certificate is public — anyone can send it. Identity is proven by the server's **signature** (CertificateVerify) made with the private key matching the certificate, over the handshake transcript.

([Certificates & PKI](lesson:cn-certificates-pki))

## [cn] "DNS changes propagate in a few minutes"

**Correction:** there's no propagation; resolvers cache answers until their TTL expires (plus misbehaving caches that ignore TTLs). Lower the TTL well before a planned change.

([DNS](lesson:cn-dns-fundamentals))

## [cn] "Cache-Control: no-cache means don't cache"

**Correction:** `no-cache` means store but revalidate before every use; `no-store` means don't store at all.

([HTTP Caching](lesson:cn-http-caching))

## [cn] "More bandwidth fixes slow page loads"

**Correction:** most web requests are latency-bound: round trips for DNS, TCP, TLS and request waterfalls dominate. Doubling bandwidth barely changes a 50 KB response; halving RTT or removing round trips does.

([Latency & Bandwidth](lesson:cn-latency-bandwidth))

## [cn] "CORS protects my API from other websites"

**Correction:** CORS is a browser mechanism that *relaxes* the same-origin policy for reading responses. It doesn't stop non-browser clients, and simple cross-site requests are still sent (that's CSRF's territory).

([CORS & CSRF](lesson:cn-cors-csrf))

## [db] "An index makes queries faster"

**Correction:** an index makes *some* queries faster — selective, sargable predicates and ordering on its leading columns — and makes every write slower. For low-selectivity predicates the planner correctly prefers a sequential scan.

([Index Fundamentals](lesson:db-index-fundamentals))

## [db] "An index on (a, b) helps queries on b"

**Correction:** B-tree composite indexes serve leftmost prefixes: (a) or (a, b). A query on b alone can't seek (except via skip scan in some engines).

([Composite Indexes](lesson:db-composite-covering-indexes))

## [db] "WHERE col = NULL finds NULLs"

**Correction:** any comparison with NULL is UNKNOWN; use `IS NULL`. And `NOT IN (subquery)` returns nothing if the subquery yields a NULL — use `NOT EXISTS`.

([NULL Logic](lesson:sql-null-logic))

## [db] "HAVING is WHERE for aggregates, so either works"

**Correction:** WHERE filters rows before grouping; HAVING filters groups after aggregation. Non-aggregate conditions belong in WHERE, both for clarity and so rows are discarded early.

([Aggregation](lesson:sql-aggregation))

## [db] "A LEFT JOIN always returns every row of the left table"

**Correction:** a WHERE condition on the right table's columns discards the NULL-padded rows and silently turns it into an inner join. Put right-table conditions in ON.

([Joins](lesson:sql-joins))

## [db] "ACID means my transactions are serializable"

**Correction:** most databases default to Read Committed (PostgreSQL) or Repeatable Read (MySQL), which allow anomalies like lost updates or write skew. Serializable must be requested — and then retries handled.

([Isolation Levels](lesson:db-isolation-levels))

## [db] "Repeatable Read means the same thing in PostgreSQL and MySQL"

**Correction:** PostgreSQL's Repeatable Read is snapshot isolation with first-updater-wins; MySQL's uses snapshots for plain reads but current-version locking reads with gap locks, and allows lost updates without FOR UPDATE.

([Isolation Levels](lesson:db-isolation-levels))

## [db] "Snapshot isolation is serializable"

**Correction:** snapshot isolation still allows write skew — two transactions reading overlapping data and writing different rows (the on-call doctors example).

([Anomalies](lesson:db-anomalies))

## [db] "COMMIT writes my changes to the table files"

**Correction:** COMMIT makes the WAL durable; data pages are written later by checkpoints. After a crash, WAL replay reconstructs them.

([WAL & Durability](lesson:db-wal-durability))

## [db] "DELETE frees disk space"

**Correction:** in MVCC databases a delete marks row versions dead; vacuum/purge makes the space reusable inside the table; the file shrinks only after a rewrite.

([MVCC](lesson:db-mvcc))

## [db] "Normalization always makes queries slower"

**Correction:** normalization removes redundancy and anomalies; with proper indexes, joins are cheap. Denormalize deliberately for measured hot paths, with a mechanism to keep copies consistent.

([Normalization](lesson:db-normalization))

## [db] "3NF and BCNF are the same"

**Correction:** they differ when a non-key attribute determines part of a candidate key (teacher → subject in Teaching(student, subject, teacher)); 3NF allows it because the dependent attribute is prime, BCNF doesn't.

([Normalization](lesson:db-normalization))

## [db] "Read replicas scale writes"

**Correction:** every replica applies every write. Replicas scale reads (with staleness); writes scale by sharding or distributed databases.

([Replication](lesson:db-replication))

## [db] "Replicas are my backup"

**Correction:** replicas replicate mistakes instantly — a `DROP TABLE` reaches them in milliseconds. Backups plus WAL archiving (PITR) protect against human error and corruption.

([Crash Recovery](lesson:db-crash-recovery))

## [db] "CAP: pick any two of consistency, availability, partition tolerance"

**Correction:** partitions aren't optional in a distributed system; the choice is between (linearizable) consistency and availability *during* a partition. PACELC adds the everyday latency-versus-consistency trade-off.

([CAP & PACELC](lesson:db-cap-pacelc))

## [db] "W + R > N means strongly consistent"

**Correction:** quorum overlap ensures reads contact a replica with the latest *successful* write, but partial failures, sloppy quorums and last-write-wins with skewed clocks break linearizability.

([Quorums & Consensus](lesson:db-quorums-consensus))

## [x] "Add a cache and the system becomes more reliable"

**Correction:** a cache adds capacity and a new failure mode: when it's cold, flushed or down, the backend receives the full load. Size and protect the backend for cache failure.

([Caching Everywhere](lesson:x-caching-everywhere), case: [Cache Stampede](case:cache-stampede))

## [x] "Retries make systems more reliable"

**Correction:** retries help with transient faults but multiply load during overload; they need backoff with jitter, budgets and a single retrying layer — and only for idempotent operations.

([Overloaded Server](lesson:x-overloaded-server))

## [x] "The pool is exhausted, so increase the pool size"

**Correction:** pool size needed = throughput × hold time. Exhaustion usually means connections are held too long (slow queries, external calls inside transactions); a bigger pool just moves the overload to the database.

([Connection Management](lesson:x-connection-management), case: [Pool Exhaustion](case:pool-exhaustion))

## [x] "A timeout means the operation failed"

**Correction:** a timeout means you don't know. The operation may have completed and only the response was lost — design retries around idempotency keys or state checks.

([SQL Query Journey](lesson:x-sql-query-journey))
