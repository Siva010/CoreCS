---
title: "Distributed Transactions: 2PC, Sagas and the Outbox Pattern"
subject: db
level: 15
order: 4
summary: "Keeping several databases or services consistent: two-phase commit and why it blocks, sagas with compensating actions, the dual-write problem and the transactional outbox, idempotent consumers, and exactly-once as an effect rather than a delivery guarantee."
depth: senior
difficulty: 4
minutes: 50
relevance: high
stage: 4
prerequisites: [db-quorums-consensus, db-transactions-acid]
related: [db-sharding, db-distributed-sql, db-optimistic-pessimistic, db-failover, db-replication, sql-dml-ddl]
tags: [distributed transactions, two phase commit, 2pc, coordinator, prepare, blocking, xa, saga, compensating transaction, orchestration, choreography, dual write, transactional outbox, cdc, idempotency, exactly once, inbox pattern]
---

## Mental Model

A single database makes a multi-step change atomic with one commit record in one log. Spread the change over two databases (two shards, or two services each owning its data) and there is **no single log**. Each side can commit or fail independently, and the network between them can lose the message that says "the other side committed".

Concretely, moving ₹500 between wallets on two shards with no coordination:

```text
shard 1: BEGIN; debit wallet A by 500; COMMIT       ✓ committed, can't be undone by the database
         the request to shard 2 is lost (or shard 2 crashes before it commits)
shard 2: credit wallet B never happens              → ₹500 has vanished
```

Two families of answers:

- **Atomic commitment (2PC)**: make all participants agree to commit or abort — strong, but blocking and coupled.
- **Sagas + reliable messaging**: commit locally step by step, and if a later step fails, run **compensating actions** — available and decoupled, but only **eventually** consistent, with intermediate states visible.

## Definition

- **Two-phase commit (2PC)**: a coordinator asks all participants to **prepare** (make the change durable but not visible, promise to commit if asked); if all vote yes, it tells them to **commit**; otherwise to abort.
- **In-doubt (prepared) transaction**: a participant that voted yes and hasn't heard the decision — it must hold locks and wait.
- **Saga**: a sequence of local transactions T1…Tn with compensations C1…Cn−1; if Tk fails, run Ck−1…C1.
- **Orchestration** (a central saga coordinator) vs **choreography** (services react to each other's events).
- **Dual write**: writing to a database and a second system (message broker, cache, search) without a shared transaction.
- **Transactional outbox**: write the business change and an "event to publish" row in the same local transaction; a relay publishes outbox rows to the broker.
- **Idempotent consumer**: processing the same message twice has the same effect as once.

## Why It Exists

**The problem.** Sharded databases and microservices split data that business operations touch together: an order service, a payment service and an inventory service; or two customers' wallets on different shards. Without a strategy, partial failures leave money charged without an order, inventory reserved forever, or events published for changes that rolled back.

**Why it's hard.** Atomicity in one database comes from one commit record in one log. With two databases there are two logs, and the message linking them can be lost — so neither side can know for certain what the other did.

**The two ideas.**

- *Make everyone promise first, then decide once* (2PC). Strong, but participants must wait for the decision.
- *Commit each step on its own, and undo with a compensating step if a later one fails* (sagas). Never blocks, but others can see in-between states.

:::callout[That's all it is]{type=insight}
2PC: ask every database "can you commit?", then tell all of them the single answer. Saga: do each step as its own transaction and, if one fails, run "undo" steps for the earlier ones. The outbox makes "change data + send event" one local transaction.
:::

## How It Works

### Two-phase commit

```mermaid
sequenceDiagram
    participant C as Coordinator
    participant A as Shard A
    participant B as Shard B
    C->>A: PREPARE
    C->>B: PREPARE
    A-->>C: YES (durably prepared, locks held)
    B-->>C: YES
    Note over C: log decision COMMIT (durable)
    C->>A: COMMIT
    C->>B: COMMIT
    A-->>C: done
    B-->>C: done
```

- Any NO or timeout during prepare → abort everywhere.
- **The blocking problem**: if the coordinator crashes after participants voted YES but before they learn the decision, they must **wait** (holding locks) — they can't safely commit or abort alone. Other transactions touching those rows block too.
- Mitigations: make the coordinator highly available by replicating its decision log with consensus (Spanner, CockroachDB) — then 2PC over consensus groups is both atomic and non-blocking in practice ([Distributed SQL](lesson:db-distributed-sql)).
- XA transactions across heterogeneous systems (database + message broker) exist but are operationally painful and rarely used in modern stacks. PostgreSQL supports `PREPARE TRANSACTION` / `COMMIT PREPARED` as a participant.

### Sagas

"Place order" across services:

| Step | Local transaction | Compensation |
|---|---|---|
| 1 | Order service: create order `PENDING` | cancel order |
| 2 | Payment service: charge card | refund |
| 3 | Inventory service: reserve items | release reservation |
| 4 | Order service: mark `CONFIRMED` | — |

If step 3 fails (out of stock): refund (C2), cancel order (C1). Properties:

- **No isolation**: between steps, other requests see intermediate states (a pending order, a charge without confirmation). Design states explicitly (`PENDING`, `CANCELLED`), use semantic locks (e.g., "reserved" flags), and make reads aware.
- **Compensations are business actions**, not rollbacks: a refund, a cancellation email. Some actions can't be compensated (an email sent), so order steps with irreversible ones last.
- Every step and compensation must be **idempotent** and retried until it succeeds.

### The dual-write problem and the outbox

The smallest distributed transaction — "update my database and publish an event" — already has the problem: two systems, no shared commit.

```python
db.execute("UPDATE orders SET status='PAID' WHERE id=%s", oid)
db.commit()
kafka.publish("order_paid", {"order_id": oid})   # crash here → event never sent
```

Reversing the order (publish, then commit) sends events for changes that may roll back. Fix with a **transactional outbox**:

```sql
BEGIN;
UPDATE orders SET status = 'PAID' WHERE id = $1;
INSERT INTO outbox (aggregate_id, event_type, payload) VALUES ($1, 'order_paid', $2);
COMMIT;
```

A relay (polling the outbox, or CDC reading the WAL — Debezium) publishes rows to the broker and marks them sent. The event is published **at least once** if and only if the change committed.

### Exactly-once effects

Networks force a choice between at-most-once delivery (may lose messages) and at-least-once delivery (may duplicate them). "Exactly once" is achieved as an **effect**: at-least-once delivery plus idempotent processing. Two common ways: an `inbox`/`processed_messages` table with a unique message id, checked in the same transaction as the side effect; or naturally idempotent operations (`SET status = 'PAID'` rather than `balance = balance - 100`).

## Internal Mechanism

:::depth{level=advanced}
### Why 2PC blocks, fundamentally

After voting YES, a participant has given up its right to decide. Only the coordinator knows the outcome. If it's unreachable, any unilateral decision could contradict what other participants were told. Three-phase commit reduces blocking only under synchrony assumptions that don't hold in real networks; the practical fix is making the coordinator's decision fault-tolerant through consensus.

### Deterministic and single-shard designs

The cheapest distributed transaction is the one you avoid:

- choose shard keys so that most transactions are single-shard ([Sharding](lesson:db-sharding));
- co-locate data that must change atomically;
- turn cross-entity invariants into single-row operations (e.g., a ledger of immutable entries per account, with asynchronous settlement).

### Saga orchestration engines

Workflow engines (Temporal, AWS Step Functions, Camunda) persist saga state, retry steps with backoff, and run compensations — replacing ad-hoc event chains that are hard to observe and debug.
:::

## Example

Money transfer between wallets on two shards:

- **With 2PC over consensus** (distributed SQL): one `BEGIN … COMMIT` touching both rows; the database coordinates atomically. Simple code, higher latency.
- **With a ledger + saga**: debit wallet A (local transaction, writes an outbox event `transfer_debited`), credit wallet B on consumption (idempotent by transfer id), and on failure credit A back. Money is "in flight" briefly; a reconciliation job checks that debits and credits match.

Banks run on the second model far more often than people assume — with careful ledgers and reconciliation.

## Complexity & Performance

- 2PC: at least two round trips plus durable writes at each participant and the coordinator; locks held across the whole protocol.
- Sagas: each step is a fast local transaction; end-to-end completion is asynchronous; throughput scales with services.

## Trade-offs

| | 2PC | Saga |
|---|---|---|
| Atomicity | all-or-nothing | eventual, via compensations |
| Isolation | yes (locks) | none between steps |
| Availability | blocks on coordinator/participant failure | each service independent |
| Coupling | tight (all participants online) | loose (async) |
| Complexity | in the infrastructure | in the business logic (states, compensations) |

## Failure Modes

- Dual writes without an outbox → lost or phantom events, caches/search out of sync.
- Non-idempotent consumers processing redelivered messages twice (double emails, double charges).
- Sagas without timeouts → orders stuck in `PENDING` forever.
- Orphaned prepared transactions in PostgreSQL holding locks and blocking vacuum after a coordinator crash (`pg_prepared_xacts`).
- Compensation that fails and isn't retried.

## In Production

- Standard toolkit: outbox + CDC, idempotency keys with unique constraints, saga/workflow engines, reconciliation jobs, dead-letter queues with alerting.
- Monitor stuck states (orders pending > N minutes), outbox lag, consumer lag, DLQ size.

## Deeper Connections

- 2PC's coordinator problem is a consensus problem ([Quorums & Consensus](lesson:db-quorums-consensus)).
- Idempotency keys are unique constraints doing distributed-systems work ([Keys & Constraints](lesson:db-keys-constraints), [Optimistic vs Pessimistic](lesson:db-optimistic-pessimistic)).
- The outbox leans on the WAL-based durability of a single local transaction ([Transactions](lesson:db-transactions-acid)).

## Common Misconceptions

- **"Kafka gives exactly-once, so my consumer is safe."** Broker-level exactly-once doesn't cover your database side effects; consumers must be idempotent.
- **"Sagas are distributed transactions."** They're sequences of local transactions without isolation.
- **"2PC guarantees availability."** It guarantees atomicity and can block.

## Interview Questions

### [L2 · how] How does two-phase commit work, and what is its main weakness?

A coordinator sends prepare to all participants; each makes the transaction durable and votes yes/no. If all vote yes, the coordinator durably records commit and tells everyone to commit; otherwise abort. Weakness: participants that voted yes are blocked, holding locks, until they learn the decision — if the coordinator crashes, they can't proceed alone. Also latency and tight coupling of all participants.

### [L2 · design] How do you reliably update the database and publish an event?

Use the transactional outbox: in the same local transaction as the business change, insert an event row into an outbox table. A separate relay (poller or CDC on the WAL) publishes outbox rows to the message broker and marks them sent, retrying until successful. Consumers must be idempotent because the event may be delivered more than once.

### [L3 · design] Design order placement across order, payment and inventory services.

Orchestrated saga: the order service creates a PENDING order and drives steps — reserve inventory (idempotent by order id), charge payment with an idempotency key, then confirm the order. On failure, compensate in reverse (release reservation, refund, cancel order). Each step publishes/consumes events via outboxes; all handlers are idempotent; timeouts move stuck sagas to compensation; the UI shows pending states; reconciliation jobs compare payments, reservations and orders.

### [L2 · compare] Saga orchestration vs choreography?

Orchestration: a central coordinator (a workflow engine or a saga service) tells each service what to do next and runs compensations on failure — easy to see and change the flow, but one more component to run. Choreography: each service listens for events and reacts ("payment succeeded" → inventory reserves) — loosely coupled, but the overall flow is implicit and hard to trace once it spans many services. Orchestration is usually preferred beyond three or four steps.

### [L1 · conceptual] What is an idempotency key and why do payment APIs require one?

A unique client-generated identifier sent with a request. The server stores it (with a unique constraint) together with the result; if the same key arrives again — because the client timed out and retried — the server returns the stored result instead of performing the action twice. Networks force at-least-once delivery; idempotency keys turn that into exactly-once *effects* for operations like charging a card.

### [L2 · conceptual] What does three-phase commit add to 2PC, and why isn't it used much?

3PC inserts a "pre-commit" phase so that, after a coordinator failure, participants can tell whether any of them could already have committed and decide without blocking. But it assumes bounded network delays and no partitions; with real asynchronous networks a partition can still lead participants to different decisions. Practical systems instead make the 2PC coordinator fault-tolerant by replicating its decision with consensus.

## Practice

### [mcq] What problem does the transactional outbox solve?

- [ ] Slow queries on the orders table
- [x] Atomically recording a state change and the fact that an event must be published (avoiding dual writes)
- [ ] Deadlocks between services
- [ ] Exactly-once delivery by the broker

The event row commits or rolls back with the business change; publishing happens afterwards, at least once.

### [mcq] In 2PC, a participant voted YES and then lost contact with the coordinator. What must it do?

- [ ] Commit, since it voted yes
- [ ] Abort after a timeout
- [x] Wait (holding its locks) until it learns the decision
- [ ] Ask another participant to decide

Unilateral action could contradict the coordinator's decision; that's the blocking problem.

### [numeric 12] In basic two-phase commit with one coordinator and 3 participants, how many messages are exchanged for a successful commit (prepare, vote, commit, acknowledgement)?

:::answer
Each participant receives PREPARE, sends a vote, receives COMMIT and sends an ACK: 4 messages × 3 participants = **12**.
:::

### [numeric 2 unit=compensations] A saga has four steps. Step 3 fails after steps 1 and 2 committed. How many compensating actions run?

:::answer
Only completed steps need undoing, in reverse order: compensate step 2, then step 1 — **2** compensations. Step 3 failed (its own transaction rolled back) and step 4 never ran.
:::

### [mcq] In two-phase commit, every participant has voted YES, and the coordinator crashes before sending the decision. What happens to the participants?

- [ ] They commit after a timeout
- [ ] They abort after a timeout
- [x] They stay blocked in the prepared state, holding their locks, until the coordinator (or its log) is available again
- [ ] They elect a new coordinator and commit

A prepared participant promised to obey the coordinator's decision and can't know what it was: committing might contradict an abort decided elsewhere, and aborting might contradict a commit. This blocking is 2PC's fundamental weakness.

### [exercise] Design a saga for "place order" across three services: inventory (reserve stock), payments (charge card) and shipping (create shipment). Give each step's compensation and how you make retries safe.

:::solution
| Step | Action | Compensation |
|---|---|---|
| 1 | Inventory: reserve items (status RESERVED, with expiry) | release the reservation |
| 2 | Payments: charge the card | refund the charge |
| 3 | Shipping: create the shipment | cancel the shipment |
| 4 | Order service: mark order CONFIRMED | — |

- If step 2 fails (card declined): release the reservation, mark the order FAILED.
- If step 3 fails: refund, then release.

Order the steps so the hardest-to-undo action (charging money) comes after the easiest one (a reservation that can also simply expire). Make every step and compensation **idempotent** with a saga or order id as the idempotency key, because messages will be redelivered. Publish each step's events through a **transactional outbox** so a service's state change and the event announcing it are committed together. Users can observe the intermediate state (stock reserved but not yet paid) — sagas give atomicity eventually, not isolation.
:::

## Quick Revision

- No shared log across databases → atomic commit needs coordination.
- 2PC: prepare/vote, then commit/abort; blocking on coordinator failure; fixed by consensus-replicated coordinators.
- Sagas: local transactions + compensations; no isolation; explicit states; idempotent steps; irreversible steps last.
- Dual writes → transactional outbox + CDC/relay; consumers idempotent (inbox/dedupe table).
- Exactly-once = at-least-once delivery + idempotent effects. Best: design so most transactions are single-shard.
- Saga orchestration (central coordinator, visible flow) vs choreography (events, implicit flow). Idempotency keys = exactly-once effects over at-least-once delivery. 3PC needs synchrony; real systems replicate the 2PC coordinator. 2PC ≈ 4N messages.
