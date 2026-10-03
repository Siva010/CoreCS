---
title: "The Disk That Filled With WAL"
subject: db
summary: "A decommissioned analytics consumer left an inactive logical replication slot. The primary retained every WAL segment for it until the disk filled at 03:40 and PostgreSQL stopped accepting writes."
difficulty: 3
concepts: [db-wal-durability, db-replication, db-crash-recovery, x-durability-chain]
tags: [wal retention, replication slot, disk full, logical replication, cdc, monitoring]
order: 7
---

## Context

PostgreSQL primary with 1 TB data volume (data ~420 GB). Two physical replicas and one logical replication slot used by a CDC pipeline (Debezium) feeding an analytics warehouse. The analytics team migrated to a new pipeline three weeks earlier and shut down the old connector.

## Symptoms

- Weeks of slowly rising disk usage, unnoticed (alert threshold at 95%).
- 03:40: `PANIC: could not write to file "pg_wal/…": No space left on device`; the primary goes down; failover to a replica.
- The new primary works, but the team fears it will happen again.

## Metrics

| Metric | Value |
|---|---|
| `pg_wal` directory size | 560 GB (normally ~5 GB) |
| WAL generation | ~27 GB/day |
| Days since slot last advanced | 21 |
| Table data growth in the same period | +9 GB |

## Hypotheses

1. A replication slot or consumer isn't advancing → WAL retained.
2. `archive_command` failing → WAL retained until archived.
3. Runaway table bloat → data size barely changed; ruled out.

## Investigation

```sql
SELECT slot_name, slot_type, active, restart_lsn,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained
FROM pg_replication_slots;
-- debezium_old | logical | f | 3A/1C… | 558 GB
```

An **inactive** logical slot, created by the old connector, still pinned WAL from three weeks ago. Replication slots guarantee the consumer can resume from where it stopped — even if it never will. `pg_stat_archiver` showed archiving healthy.

## Root Cause

An abandoned replication slot retained all WAL generated since its consumer stopped (27 GB/day × 21 days), filling the disk. Nothing bounded slot retention, and disk alerts fired too late.

## Fix

1. Service was restored by the failover. In this PostgreSQL version logical slots are not synchronized to standbys, so the promoted replica carried no stale slot — but the *new* CDC pipeline's slot was also missing there and had to be recreated, with its connector re-snapshotting.
2. The old primary was rebuilt as a replica. As a rule for every node, abandoned slots are dropped: `SELECT pg_drop_replication_slot('debezium_old');`, after which WAL is recycled at the next checkpoint.
3. Set `max_slot_wal_keep_size = 100GB` so a stuck slot is invalidated instead of taking the database down.

## Prevention

- Alert on slot lag (bytes retained per slot) and on inactive slots older than N hours.
- Decommissioning checklists include dropping slots, publications and users.
- Disk alerts on growth rate (days until full), not only on percentage.

## Interview Angle

Shows the WAL's second life: it isn't just for crash recovery but for replication and CDC, and retention is driven by the slowest consumer. Good answers name `pg_replication_slots`, explain why the database can't delete WAL a slot still needs, and propose bounded retention plus monitoring ([WAL & Durability](lesson:db-wal-durability)).
