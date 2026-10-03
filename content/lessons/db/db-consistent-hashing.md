---
title: "Consistent Hashing: Adding Nodes Without Reshuffling Everything"
subject: db
level: 13
order: 3
summary: "Why hash mod N breaks when N changes, the hash ring, virtual nodes for balance, replication along the ring, rendezvous hashing and jump hash — the mechanism behind Dynamo-style databases, distributed caches and load balancers."
depth: advanced
difficulty: 3
minutes: 35
relevance: high
stage: 3
prerequisites: [db-sharding]
related: [db-wide-column, db-quorums-consensus, db-redis-caching, cn-proxies-load-balancers, cn-cdn]
visualizations: [consistent-hashing]
labs: [consistent-hashing]
tags: [consistent hashing, hash ring, virtual nodes, vnodes, rendezvous hashing, highest random weight, jump consistent hash, rebalancing, key movement, replication factor, preference list, dynamo, cassandra, memcached]
---

## Mental Model

With `shard = hash(key) mod N`, changing N changes almost every key's shard: going from 4 to 5 servers moves ~80% of the data — a cache flush or a massive migration.

Consistent hashing puts **both servers and keys on the same circle** of hash values. Each key belongs to the **first server clockwise** from it. Adding a server only takes over the keys between it and its counter-clockwise neighbour; removing a server hands its keys to the next one. **Only ~1/N of keys move.**

## Definition

- **Hash ring**: the hash space (e.g., 0 … 2⁶⁴−1) treated as a circle.
- **Node position**: hash(node id) placed on the ring.
- **Key ownership**: a key is stored on the first node at or after hash(key), clockwise.
- **Virtual nodes (vnodes)**: each physical node is placed at many points (e.g., 100–256 tokens), smoothing the distribution.
- **Replication along the ring**: with replication factor R, a key is stored on the next R distinct physical nodes clockwise (its *preference list*).
- **Rendezvous (HRW) hashing**: each key picks the node with the highest hash(key, node) — no ring needed.
- **Jump consistent hash**: a tiny, fast algorithm mapping keys to buckets 0..N−1 with minimal movement when N grows (numbered buckets only).

## Why It Exists

Distributed caches (memcached clusters), Dynamo-style databases (Cassandra, Riak, DynamoDB's partitioning heritage), CDNs and load balancers with sticky routing all need to map keys to a changing set of nodes. Every node change under `mod N` would invalidate most caches or move most data; consistent hashing makes membership changes cheap and incremental.

## How It Works

### The ring

```text
                 0
           N3 ●     ● k1 → N1
        k4 ●           ● N1
          N2 ●       ● k2 → N2 … (next clockwise)
               ● k3
```

(Positions are hash values; each key walks clockwise to the first node.)

- Add N4 between N1 and N2: only keys in (N1, N4] move from N2 to N4. Everything else stays.
- Remove N2: its keys go to the next node clockwise; others unaffected.

### Why virtual nodes

With one point per node, arc lengths are random and uneven — one node may own 3× another's share; and when a node leaves, its entire load lands on a single neighbour. With many virtual points per node:

- each node owns many small arcs → load evens out (standard deviation shrinks roughly with 1/√vnodes);
- a departing node's arcs are spread over **many** other nodes;
- heterogeneous hardware gets proportionally more vnodes.

::viz{id=consistent-hashing}

### Replication

Store each key on the first R distinct physical nodes clockwise (skipping vnodes of a node already chosen, and ideally spreading across racks/zones). Reads and writes then use quorums over those R replicas ([Quorums & Consensus](lesson:db-quorums-consensus)).

### Alternatives

| Method | Lookup | Movement on change | Notes |
|---|---|---|---|
| mod N | O(1) | about N/(N+1) of keys when going from N to N+1 nodes | fine only for fixed-size clusters |
| Ring + vnodes | O(log V) binary search over V points | ~1/N | supports weights, replication by walking the ring |
| Rendezvous (HRW) | O(N) per key (compute all scores) | ~1/N | simple, perfect balance in expectation; good for small N or with hierarchies |
| Jump hash | O(log N), no memory | ~1/N when adding at the end | buckets must be numbered 0..N−1; can't remove arbitrary nodes |
| Directory | O(1) lookup | only what you choose to move | needs a coordinated mapping service ([Sharding](lesson:db-sharding)) |

## Internal Mechanism

:::depth{level=advanced}
### Expected movement

Adding one node to N existing nodes: the new node takes ~1/(N+1) of the keyspace, so ~1/(N+1) of keys move — the theoretical minimum for balance. With mod N, a key stays only if hash mod N = hash mod (N+1), which happens for roughly 1/(N+1) of keys — so ~N/(N+1) move.

### Bounded loads

Even with vnodes, popular keys make load uneven. "Consistent hashing with bounded loads" (used by some load balancers, e.g., for cache affinity) caps each node at (1 + ε) × average load and spills excess keys to the next node clockwise, trading a little affinity for balance.

### Membership is the real problem

The ring needs every client/router to agree on membership. Cassandra gossips ring state between nodes; clients may cache token maps. During membership changes, some requests hit the "old" owner — systems handle it with hinted handoff, forwarding, or by streaming data before the new node takes ownership.
:::

## Example

A 4-node cache cluster using `mod 4`, grown to 5 nodes: about 80% of keys map to a different node → cache hit rate collapses from 95% to ~20% and the database behind it is flooded ([Redis & Caching](lesson:db-redis-caching)). With a ring and 200 vnodes per node, adding the fifth node moves ~20% of keys; the hit rate dips briefly to ~76% and recovers as the new node warms.

Try adding and removing nodes, and changing the vnode count, in the [Consistent Hashing lab](lab:consistent-hashing).

## Complexity & Performance

- Lookup: binary search over sorted vnode positions — O(log(N × vnodes)), microseconds.
- Memory: the token map (N × vnodes entries), small.
- Rebalancing: ~1/N of the data per node change, spread across many nodes with vnodes.

## Trade-offs

- More vnodes → better balance and parallel rebalancing; larger token maps and more metadata work (Cassandra moved from 256 to 16 default tokens with a smarter allocation algorithm).
- Hash-based placement → no range scans across keys (keys are scattered); range-partitioned systems use ordered ranges and split them instead.

## Failure Modes

- Too few vnodes → imbalanced nodes, one node receiving a failed neighbour's entire load.
- Hot keys still overload their owner — consistent hashing balances keys, not traffic per key.
- Clients with inconsistent ring views → requests to wrong nodes, cache misses, or data written to the wrong replica set.

## In Production

- Cassandra/ScyllaDB tokens, DynamoDB partitioning, memcached client libraries (ketama), Envoy/NGINX consistent-hash load balancing for cache affinity, CDN request routing.
- Monitor per-node load and data size; adjust weights (vnode counts) for heterogeneous hardware.

## Deeper Connections

- It's the standard answer to "how does the shard map change when we add a shard?" ([Sharding](lesson:db-sharding)).
- Load balancers use it to keep a client or cache key on the same backend ([Proxies & Load Balancers](lesson:cn-proxies-load-balancers)).

## Common Misconceptions

- **"Consistent hashing guarantees even load."** It guarantees minimal movement; balance needs vnodes, and hot keys need separate handling.
- **"Consistent hashing is about consistency (the C in CAP)."** It's about stable key placement; unrelated to data consistency.

## Interview Questions

### [L2 · conceptual] What problem does consistent hashing solve and how?

With hash mod N, changing the number of nodes remaps almost every key, forcing massive data movement or cache invalidation. Consistent hashing maps nodes and keys onto a ring; each key belongs to the next node clockwise, so adding or removing a node only moves the keys in the affected arc — about 1/N of the keys.

### [L2 · why] Why use virtual nodes?

With a single position per node, arcs are uneven and a failed node's whole range falls on one neighbour. Placing each physical node at many points evens out ownership, spreads a departing node's keys across many nodes (and rebalancing work across many sources), and allows weighting nodes by capacity.

### [L3 · design] Design key placement for a distributed cache that must survive node failures and scale out without cache stampedes.

Consistent hashing with ~100–200 vnodes per node (or rendezvous hashing for small clusters), clients sharing membership from a coordination service; optionally replicate hot keys to the next node for failover. Add nodes gradually (warm them by shadow-filling or slowly increasing their weight), use request coalescing and stale-while-revalidate at the application to avoid stampedes during movement, and handle hot keys with local caches or key splitting.

## Practice

### [numeric 20 unit=%] A cluster with 4 nodes (many vnodes each) adds a fifth node. About what percentage of keys move?

:::answer
The new node ends up owning about 1/5 of the ring, and only those keys move: **20%**.
:::

### [mcq] What mainly determines how evenly keys spread across physical nodes on a hash ring?

- [ ] The replication factor
- [x] The number of virtual nodes per physical node
- [ ] The hash function's output size
- [ ] Whether keys are strings or integers

More points per node → many small arcs → load averages out.

## Quick Revision

- mod N remaps ~N/(N+1) of keys on growth; ring moves ~1/(N+1).
- Key → first node clockwise; add/remove affects one arc.
- Virtual nodes: balance, spread failover load, weights.
- Replicas: next R distinct nodes clockwise (across zones).
- Alternatives: rendezvous (HRW), jump hash, directory. Hot keys still need special handling.
