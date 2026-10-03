---
title: "The Failover That Lost Four Seconds of Orders"
subject: db
summary: "An automated failover promoted an asynchronous replica after the primary's host failed. Four seconds of acknowledged orders existed only on the dead primary, and some app servers kept writing to it via cached DNS until it rebooted — a lesson in RPO, fencing and client routing."
difficulty: 4
concepts: [db-failover, db-replication, db-quorums-consensus, db-cap-pacelc, cn-dns-fundamentals]
tags: [failover, rpo, asynchronous replication, split brain, fencing, dns ttl, pg_rewind, patroni]
order: 5
---

## Context

PostgreSQL primary in zone A, one asynchronous replica in zone B, a failover script triggered by a health check (3 failures × 10 s). Applications connect via a DNS name (`db-primary.internal`, TTL 60 s) updated by the script.

## Symptoms

- 14:02: primary host hardware fault; the database stops responding.
- 14:03: the script promotes the replica and updates DNS.
- 14:03–14:05: about half the app servers write successfully to the new primary; the other half get connection errors.
- 14:06: the old primary's host reboots, PostgreSQL starts as a primary, and some app servers (still resolving the old IP) write to it successfully.
- Next day: customers report orders confirmed by email but missing from their accounts.

## Metrics

| Metric | Value |
|---|---|
| Replication lag at failure (last monitoring sample) | ~4 s (a bulk import was running) |
| Orders acknowledged by old primary but absent on new primary | 312 |
| Orders written to old primary after its reboot (14:06–14:09) | 57 |
| DNS TTL | 60 s (some clients cached longer: JVM default DNS caching) |

## Hypotheses

1. Asynchronous replication lost the tail of the log (RPO > 0).
2. Split brain: the old primary accepted writes after failover.
3. Client DNS caching kept traffic on the old IP.

All three turned out to be true.

## Investigation

- Compared WAL: the old primary's WAL extended 4.1 s beyond the promoted replica's timeline fork point → 312 committed transactions never shipped.
- The old primary's logs show it starting at 14:06 **as a primary** (nothing told it otherwise) and accepting connections.
- App servers using a JVM with `networkaddress.cache.ttl` = infinite (a security manager default in that environment) never re-resolved the name until restart.

## Root Cause

A failover design without **fencing** or **consensus**: (1) async replication meant acknowledged commits could be lost (RPO ≈ lag); (2) the old primary could return as a writable primary (split brain); (3) client routing depended on DNS caching behavior outside the team's control ([Failover](lesson:db-failover)).

## Fix

1. Recovered the 312 + 57 orders by extracting them from the old primary (logical decoding / queries by timestamp) and re-applying them to the new primary after reconciliation; contacted affected customers.
2. Rebuilt the old primary as a replica with `pg_rewind`.
3. Re-architected: Patroni with etcd (leader lease; a primary that loses the lease demotes itself), one synchronous replica in another zone (`synchronous_standby_names = 'ANY 1 (…)'` over two replicas), connections through HAProxy/PgBouncer that routes only to the lease holder, and short DNS TTLs honored by clients.

## Prevention

- Define RPO per data class; orders require RPO = 0 → synchronous replication to at least one replica.
- Fencing is mandatory: self-demotion on lease loss plus routing only to the elected leader.
- Chaos drills: kill the primary host, partition it, reboot it — verify no writes land on the old primary.

## Interview Angle

Excellent for senior-level discussions: RPO/RTO, why async replication loses acknowledged writes, what split brain is, why fencing and consensus are needed, and how client-side caching (DNS, connection pools) can defeat server-side failover. Candidates who mention lease-based self-demotion and fencing tokens stand out ([Quorums & Consensus](lesson:db-quorums-consensus)).
