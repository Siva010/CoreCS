---
title: "What Happens When a Write Is Replicated"
summary: "A committed change travels from the primary's WAL to a standby: walsender and walreceiver processes, streaming over TCP, flush acknowledgements that synchronous commit waits for, single-threaded replay, and when a read on the replica finally sees the row."
subjects: [db, cn]
order: 15
related: [db-replication, db-wal-durability, db-failover, db-consistency-models, db-crash-recovery]
---

An `UPDATE profiles SET name = 'Asha R.' WHERE id = 42` commits on the primary. A streaming standby in another zone will eventually show the new name.

## [wal] The change is in the primary's WAL

The UPDATE and its commit record are in the primary's WAL, flushed locally up to LSN `3/7A000188` ([Commit](uth:commit)).

## [replica] walsender streams it

Each connected standby is served by a `walsender` process on the primary. It notices new WAL and sends the new bytes over the replication connection (a long-lived TCP connection using the replication protocol) — the same WAL bytes, not SQL statements ([Replication](lesson:db-replication)).

## [network] Across zones

The WAL travels over the network: ~1 ms between zones, more across regions. Bandwidth matters for bulk writes; latency matters for synchronous commit.

## [replica] walreceiver writes and flushes

On the standby, the `walreceiver` process writes the received WAL to its own `pg_wal` directory and fsyncs it, then reports its positions back: **write**, **flush** and **replay** LSNs.

## [db] Synchronous commit waits (if configured)

If this standby is synchronous, the primary backend that committed has been waiting for the standby's flush LSN to pass `3/7A000188`; now it returns "COMMIT OK" to the client. With asynchronous replication, the client was acknowledged long ago.

## [replica] Startup process replays

The standby's startup process — the same code as crash recovery, running forever — reads the WAL and applies each record to its pages, then marks the transaction committed in its commit log. Replay is single-threaded; heavy write bursts on the primary show up here as lag ([Crash Recovery](lesson:db-crash-recovery)).

## [replica] Visible to replica queries

A query on the standby taking a snapshot **after** replay passed the commit record sees `name = 'Asha R.'`. A query a millisecond earlier — or during a lag spike, seconds earlier — sees the old name: that's replication lag and the reason for read-your-writes routing ([Consistency Models](lesson:db-consistency-models)).

## [replica] Feedback and failover readiness

The standby reports its positions (and, with `hot_standby_feedback`, its oldest snapshot) to the primary. Monitoring reads these as `write_lag`, `flush_lag` and `replay_lag`. If the primary dies, the standby with the highest flushed LSN is the best promotion candidate ([Failover](lesson:db-failover)).
