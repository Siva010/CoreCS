---
title: "What Happens During an Index Lookup"
summary: "WHERE email = 'asha@example.com' on a 50-million-row table: descending a B+ tree from root to leaf, binary search inside each page, following the TID to the heap, visibility checks — about four page reads, most of them already in memory."
subjects: [db]
order: 12
related: [db-btree, db-index-fundamentals, db-pages-records, db-buffer-pool, db-clustered-indexes, db-composite-covering-indexes]
---

`SELECT * FROM users WHERE email = 'asha@example.com';` with a unique B-tree index `users_email_key` on 50 million rows.

## [planner] The planner picks the index

Equality on a unique indexed column → estimated 1 row → Index Scan using `users_email_key` ([Index Fundamentals](lesson:db-index-fundamentals)).

## [buffer] Read the root page

The index's metapage says where the root is. The root page (always hot, in the buffer pool) holds a few hundred separator keys. Binary search finds the child whose key range contains `'asha@example.com'` ([B+ Trees](lesson:db-btree)).

## [buffer] Descend internal levels

With ~300 keys per page, 50 million entries need 4 levels: root → level 2 → level 1 → leaf. Each step: fetch the child page from the buffer pool (upper levels are almost certainly cached), binary search, follow the pointer. Concurrent page splits are handled by right-links: if the key is beyond the page's high key, move right.

## [buffer] Read the leaf page

The leaf holds sorted `(key, TID)` entries. Binary search finds `'asha@example.com' → TID (18342, 7)`: heap page 18,342, slot 7. The leaf may be a buffer miss — this is typically the first page that might require real I/O ([Buffer Pool](lesson:db-buffer-pool)).

## [buffer] Fetch the heap page

The executor requests heap page 18,342 (another possible miss), reads the slot array entry 7 to find the tuple's offset in the page ([Pages & Records](lesson:db-pages-records)).

## [db] Visibility check

The tuple's `xmin`/`xmax` are checked against the snapshot. If this version is dead (updated or deleted), PostgreSQL follows the HOT chain or finds that the index entry points to an obsolete version and continues. Here it's visible: return the row.

## [executor] Done in ~4–5 page accesses

Root + 2 internal pages (cached) + leaf + heap page. Warm: a few microseconds. Cold leaf and heap page on NVMe: ~0.2 ms. Compare with a sequential scan of ~700,000 pages. With a covering index (and all-visible pages), the heap fetch would be skipped entirely ([Covering Indexes](lesson:db-composite-covering-indexes)); in InnoDB, the leaf would contain the primary key and a second tree descent would fetch the row ([Clustered Indexes](lesson:db-clustered-indexes)).
