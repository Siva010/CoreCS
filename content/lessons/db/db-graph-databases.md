---
title: "Graph Databases: When Relationships Are the Data"
subject: db
level: 14
order: 5
summary: "The property-graph model, index-free adjacency, traversal queries in Cypher, how they compare with recursive SQL, and the workloads (fraud rings, recommendations, dependency graphs) where graph stores beat relational ones — and where they don't."
depth: advanced
difficulty: 3
minutes: 30
relevance: low
stage: 3
prerequisites: [db-nosql-landscape]
related: [sql-subqueries-ctes, db-er-modeling, db-sharding, db-nosql-landscape]
tags: [graph database, property graph, nodes, edges, relationships, cypher, gremlin, neo4j, index free adjacency, traversal, shortest path, recursive cte, fraud detection, recommendations, knowledge graph, rdf, sparql]
---

## Mental Model

In a relational database a relationship is a **value you search for** (`orders.customer_id = customers.id` — an index lookup per hop). In a graph database a relationship is a **stored pointer** from one node to another. Following it costs roughly the same no matter how big the graph is.

For queries that hop through many relationships of variable depth — "friends of friends who bought this", "accounts connected to this fraudster within 4 transfers" — pointer chasing beats repeated joins. For everything else, it usually doesn't.

## Definition

- **Property graph**: **nodes** (with labels like `:Person`) and **relationships/edges** (typed, directed, like `:FRIEND_OF`), both carrying key–value properties.
- **Index-free adjacency**: each node stores direct references to its relationships, so traversal doesn't need an index lookup per hop.
- **Traversal**: walking the graph from start nodes along relationship patterns.
- **Cypher** (Neo4j, openCypher, ISO GQL), **Gremlin** (TinkerPop): graph query languages. **RDF/SPARQL**: triple-based semantic-web model.

## Why It Exists

Some questions are inherently about paths and neighborhoods of unknown depth. In SQL they become recursive CTEs or chains of self-joins whose cost multiplies with each hop ([Subqueries & CTEs](lesson:sql-subqueries-ctes)). Graph databases store the graph in a shape that makes those traversals the fast path, and offer languages that express patterns directly.

## How It Works

### Pattern matching in Cypher

```cypher
// People who are friends-of-friends of Asha (not already friends) and who bought a product Asha bought
MATCH (a:Person {name: 'Asha'})-[:FRIEND_OF]-(:Person)-[:FRIEND_OF]-(fof:Person),
      (a)-[:BOUGHT]->(p:Product)<-[:BOUGHT]-(fof)
WHERE NOT (a)-[:FRIEND_OF]-(fof) AND a <> fof
RETURN fof.name, count(p) AS shared
ORDER BY shared DESC LIMIT 10;

// Shortest transfer path between two accounts, up to 6 hops
MATCH path = shortestPath((x:Account {id: 'A1'})-[:TRANSFER*..6]-(y:Account {id: 'Z9'}))
RETURN path;
```

The ASCII-art pattern `(node)-[:REL]->(node)` is the query.

### The same question in SQL

```sql
-- Friends of friends (one fixed depth): two self-joins on a friendships table
SELECT DISTINCT f2.friend_id
FROM friendships f1
JOIN friendships f2 ON f2.user_id = f1.friend_id
WHERE f1.user_id = $asha AND f2.friend_id <> $asha
  AND NOT EXISTS (SELECT 1 FROM friendships x WHERE x.user_id = $asha AND x.friend_id = f2.friend_id);
```

Fine at depth 2 with indexes. At variable depth 4–6 with fan-out of hundreds per hop, intermediate results explode (100⁴ = 100 million paths) — in *any* system; graph databases handle it better by traversing with pruning and without per-hop index lookups, but "six degrees" queries on huge social graphs are expensive everywhere.

### Where graphs shine

| Workload | Why graph |
|---|---|
| Fraud rings (shared devices, cards, addresses) | variable-depth connections between entities |
| Recommendations (people/products "near" you) | neighborhood patterns |
| Network/IT dependency and impact analysis | "what breaks if this service fails?" = reachability |
| Access control graphs (users → groups → roles → resources) | transitive membership |
| Knowledge graphs | heterogeneous entities and relationship types |

## Internal Mechanism

:::depth{level=advanced}
### Native graph storage

Neo4j stores fixed-size node and relationship records; each node points to its first relationship, and relationships form doubly-linked lists per node. Traversing a hop = following record pointers (often in cache). Cost ∝ edges actually traversed, independent of total graph size — versus an O(log n) index lookup per hop in relational joins (small, but multiplied by fan-out and depth).

### Supernodes

A node with millions of edges (a celebrity, a popular product, a default "unknown" address) makes any traversal through it explode. Mitigations: typed/directed relationship filtering, relationship indexes, modeling the supernode differently, or pruning by properties early.

### Scaling out

Graphs are hard to shard: any partitioning cuts edges, and traversals crossing partitions become network hops. Many graph databases scale reads with replicas and keep the graph on one (large) machine; distributed graph systems exist (JanusGraph over Cassandra, TigerGraph, Neptune) with their own trade-offs ([Sharding](lesson:db-sharding)).
:::

## Example

Fraud detection: flag a new account if, within 3 hops over `USES_DEVICE`, `HAS_CARD` and `LIVES_AT` relationships, it connects to an account previously marked fraudulent.

```cypher
MATCH (new:Account {id: $id})-[:USES_DEVICE|HAS_CARD|LIVES_AT*1..3]-(bad:Account {flagged: true})
RETURN bad.id LIMIT 1;
```

In SQL this is a recursive CTE across three relationship tables with cycle protection — possible, but slower and harder to read; in a graph store it's a bounded traversal from one node.

## Complexity & Performance

- Traversal cost ∝ number of edges visited (fan-out^depth in the worst case), not total graph size.
- Aggregations over the whole graph (counts, reports) are not a graph store's strength — use analytics tools or a warehouse.

## Trade-offs

- Graph DB: expressive variable-depth traversals, fast neighborhood queries; weaker at bulk aggregation, harder to scale out, another system to operate and sync.
- Relational + recursive CTEs: often good enough for trees and shallow graphs, with transactions and all your other data in one place ([Subqueries & CTEs](lesson:sql-subqueries-ctes)).

## Failure Modes

- Unbounded traversals (`*` without a depth limit) exploring huge portions of the graph.
- Supernodes turning local queries into global ones.
- Using a graph database as the system of record for non-graph data.

## In Production

- Common pattern: relational system of record → graph projection (via CDC or batch) for traversal-heavy features like fraud scoring and recommendations.
- PostgreSQL extensions (Apache AGE) and SQL/PGQ (SQL:2023 property-graph queries) bring graph querying into relational databases.

## Deeper Connections

- Graph traversal is BFS/DFS with storage-aware costs; recursive CTEs are the relational equivalent ([Subqueries & CTEs](lesson:sql-subqueries-ctes)).
- ER diagrams are themselves graphs of entity types; graph databases store graphs of entity *instances* ([ER Modeling](lesson:db-er-modeling)).

## Common Misconceptions

- **"Relational databases can't handle relationships."** They handle them very well via joins; graph stores specialize in deep, variable-length traversals.
- **"Graph databases are faster for everything connected."** For single-hop lookups and aggregations, relational indexes are just as fast or faster.

## Interview Questions

### [L2 · compare] When would you choose a graph database over a relational one?

When the core queries traverse relationships of variable or significant depth — fraud rings, recommendations, network impact analysis, access graphs — where each hop in SQL is another join and intermediate results explode. For CRUD, reporting and shallow relationships, relational databases are simpler and usually faster; trees and shallow hierarchies are well served by recursive CTEs.

### [L2 · how] What is index-free adjacency?

Each node physically stores references to its relationships (and they to their endpoint nodes), so moving from a node to its neighbors follows pointers rather than performing an index lookup per hop. Traversal cost depends on the edges visited, not the overall size of the graph.

## Practice

### [mcq] Which query is the most natural fit for a graph database?

- [ ] Total revenue per month
- [ ] Look up a user by email
- [x] Find all accounts within 4 transfer hops of a flagged account
- [ ] Insert 100,000 log lines per second

Variable-depth traversal over relationships is the graph sweet spot.

### [mcq] What is a "supernode" problem?

- [ ] A node that stores too many properties
- [x] A node with an enormous number of relationships, making traversals through it explode
- [ ] A node replicated across all servers
- [ ] A node without any relationships

Traversals fan out through every edge of a highly connected node.

## Quick Revision

- Property graph: nodes + typed relationships, both with properties; Cypher/Gremlin/GQL.
- Index-free adjacency: hops follow stored pointers; cost ∝ edges traversed.
- Great for variable-depth traversal (fraud, recommendations, dependencies, access graphs).
- Weak at bulk aggregation and sharding; watch supernodes and unbounded traversals.
- Recursive CTEs cover trees/shallow graphs in SQL; graph stores are usually derived views, not systems of record.
