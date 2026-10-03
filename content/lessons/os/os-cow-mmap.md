---
title: "Copy-on-Write, Memory-Mapped Files and Shared Memory"
subject: os
level: 7
order: 4
summary: "How the kernel shares pages lazily (fork, snapshots), how mmap turns files into memory, and why databases argue about whether to use it."
depth: advanced
difficulty: 4
minutes: 40
relevance: medium
stage: 3
prerequisites: [os-page-faults, os-process-creation]
related: [os-page-cache, os-ipc, db-buffer-pool, db-mvcc, os-file-descriptors]
tags: [copy-on-write, cow, mmap, memory mapped file, map_shared, map_private, msync, page cache, shared memory, redis bgsave, lmdb]
---

## Mental Model

**Copy-on-write** is "share until someone wants to scribble". After `fork`, parent and child point at the same physical pages marked read-only. The first time either one writes to a page, the kernel quietly makes that one page private for the writer. Pages never written are never copied.

**mmap** is "make the file *be* memory". Instead of `read()`ing bytes into a buffer, you map the file into your address space; touching an address page-faults the corresponding file page in from the page cache. The file and the memory become two views of the same pages.

Both are the same trick: **manipulate page tables and let page faults do the work lazily.**

## Definition

- **Copy-on-write (COW)**: pages shared between address spaces are mapped read-only; a write triggers a fault that copies the page and gives the writer a private writable copy.
- **`mmap(addr, len, prot, flags, fd, offset)`**: creates a mapping of a file (or anonymous memory) into the address space.
  - **`MAP_SHARED`**: writes go to the shared page-cache pages and eventually to the file; visible to other mappers.
  - **`MAP_PRIVATE`**: copy-on-write; writes create private copies never written back to the file.
  - **`MAP_ANONYMOUS`**: not backed by a file (zero-filled) — used by allocators and for shared memory between related processes.
- **`msync`**: flush dirty pages of a shared mapping to the file (durability).

## Why It Exists

- **COW** makes `fork` cheap, enables instant snapshots (Redis persistence, filesystem snapshots in Btrfs/ZFS), and lets `MAP_PRIVATE` mappings of executables share code pages while keeping writable data private.
- **mmap** avoids copying file data between the page cache and user buffers (one copy, the page-cache page, is mapped directly), gives random access with pointer arithmetic, lets many processes share one copy of a file in memory, and loads programs and libraries lazily.

## How It Works

### COW after fork

```text
Before write:                         After child writes page 2:
parent PT ─┬─> frame A (page 1) RO     parent PT ─┬─> frame A (page 1) RO
child PT  ─┘                           child PT  ─┘
parent PT ─┬─> frame B (page 2) RO     parent PT ───> frame B (page 2) RW (refcount 1)
child PT  ─┘                           child PT  ───> frame C (copy of B) RW
```

Steps on the write fault: check the VMA allows writes and the page is COW-shared (refcount > 1) → allocate frame C → copy 4 KB → map C writable in the child → decrement B's refcount (if the parent is now the only user, a later parent write just flips B to writable without copying).

### mmap of a file

```c
int fd = open("data.bin", O_RDONLY);
struct stat st; fstat(fd, &st);
const uint8_t *p = mmap(NULL, st.st_size, PROT_READ, MAP_PRIVATE, fd, 0);
uint64_t sum = 0;
for (off_t i = 0; i < st.st_size; i += 4096) sum += p[i];   // page faults load pages lazily
munmap((void *)p, st.st_size);
```

Each first touch of a page is a page fault: minor if the page is in the page cache, major (disk read) if not. Read-ahead fetches following pages on sequential access.

### read() vs mmap

| | `read()` into a buffer | `mmap` |
|---|---|---|
| Copies | Page cache → user buffer (1 extra copy) | None; page-cache pages mapped directly |
| Syscalls | One per read call | One mmap; then page faults |
| Error handling | Return codes (`EIO`) | Errors arrive as **SIGBUS** on access |
| Control over I/O timing | Explicit | Implicit (whenever a fault happens) |
| Address space use | Buffer only | Whole mapping (a problem on 32-bit) |
| Best for | Streaming, sequential, most code | Random access to large read-mostly files, sharing between processes |

## Internal Mechanism

### Shared memory via mmap

`MAP_SHARED` mappings of the same file (or of a `shm_open`/`memfd` object) in several processes point to the **same physical pages** — the fastest IPC ([IPC](lesson:os-ipc)). PostgreSQL's shared buffers are created this way (anonymous shared mmap or System V shared memory).

### Durability of mmap writes

Writes to a `MAP_SHARED` mapping dirty page-cache pages; the kernel writes them back eventually (writeback thresholds, dirty expiry ~30 s by default). For durability you must call **`msync(MS_SYNC)`** (or `fsync` on the fd). Worse: you can't control *when* dirty pages are written — the kernel may flush a half-updated data structure before you're ready, which breaks crash-consistency protocols like WAL ordering ("the data page must not reach disk before its log record").

:::depth{level=advanced}
### Why many databases avoid mmap for their data

The CIDR 2022 paper "Are You Sure You Want to Use MMAP in Your Database Management System?" (Crotty, Leis, Pavlo) summarizes the problems:

1. **Transactional safety**: the OS can flush dirty pages at any time, violating write-ahead ordering; workarounds (MAP_PRIVATE + copying, shadow paging) add complexity.
2. **I/O stalls**: a page fault blocks the thread with no async alternative; the DB can't schedule or prioritize I/O.
3. **Error handling**: I/O errors surface as SIGBUS at arbitrary memory accesses.
4. **Performance at scale**: page-table contention, TLB shootdowns on eviction, and single-threaded kernel eviction limit throughput with fast NVMe.

Counterexamples exist: **LMDB** uses a read-only mmap plus copy-on-write B+ tree pages written with explicit writes, getting great read performance; MongoDB's original MMAPv1 engine was replaced by WiredTiger (own cache). PostgreSQL uses `read()/write()` via its own buffer pool plus the OS page cache; InnoDB manages its own buffer pool with `O_DIRECT`.
:::

## Example

**Redis BGSAVE with COW**: Redis forks; the child iterates the dataset and writes a snapshot file while the parent keeps serving writes. Memory overhead = pages the parent modifies during the snapshot. With a write-heavy workload touching most pages, memory use approaches 2×. Transparent huge pages make it worse (a small write copies 2 MB), which is why Redis warns to disable THP.

**Zero-copy static file serving**: `sendfile()` (or mmap + write) serves file bytes straight from the page cache to the socket without copying into user space — how Nginx and Kafka achieve high throughput.

## Complexity & Performance

- COW `fork` cost ∝ page-table size; each subsequent write to a shared page costs a fault + 4 KB copy (~1–5 µs).
- mmap sequential scans are competitive with `read()`; random access to a hot, cached file is often faster (no syscalls); cold random access is dominated by major faults either way.
- `munmap` or eviction of mapped pages in multithreaded processes triggers TLB shootdowns ([TLB](lesson:os-tlb)).

## Trade-offs

- **COW**: cheap snapshots and forks, but unpredictable memory growth and latency when writes break sharing.
- **mmap**: zero-copy and simple code, but no control over I/O timing, awkward error handling, durability pitfalls, and address-space limits on 32-bit systems.

## Failure Modes

- **COW memory blowup** during fork-based snapshots → OOM.
- **SIGBUS** when accessing an mmap'd page past end of a truncated file or on I/O error.
- **Stale reads** across processes if one uses `write()` and another uses `MAP_PRIVATE` mappings (private pages don't see later file changes once copied).
- **Durability surprises**: assuming `munmap` or process exit flushes to disk — it flushes to the page cache, not to stable storage.

## In Production

- Kafka, Elasticsearch/Lucene (memory-mapped index files via `MMapDirectory`), LMDB, SQLite (optional mmap I/O) rely on mmap for reads.
- Snapshot-based persistence: Redis RDB, Btrfs/ZFS snapshots, VM snapshots, container image layers (overlay filesystems are COW at the file level).
- `vm.max_map_count` must be raised for applications creating many mappings (Elasticsearch requires 262,144).

## Deeper Connections

- COW at the page level ↔ MVCC at the row level: never overwrite what readers might still be using; create a new version ([MVCC](lesson:db-mvcc)).
- mmap's durability problems explain why databases use a WAL and their own buffer pool ([Buffer Pool](lesson:db-buffer-pool), [WAL](lesson:db-wal-durability)).
- The page cache sits under both `read()` and `mmap` ([Page Cache](lesson:os-page-cache)).

## Common Misconceptions

- **"fork doubles memory usage."** Only pages that get written are copied.
- **"mmap makes file I/O free."** The first access to each page still costs a fault and possibly a disk read.
- **"Writing to an mmap'd file makes it durable."** Only after msync/fsync completes.

## Interview Questions

### [L2 · how] How does copy-on-write work after fork()?

The kernel duplicates the parent's page tables for the child and marks all writable private pages read-only in both, incrementing each page's reference count. When either process writes to such a page, a protection fault occurs; the kernel allocates a new frame, copies the page, maps it writable for the writer, and restarts the instruction. Unwritten pages stay shared.

### [L2 · compare] What's the difference between MAP_SHARED and MAP_PRIVATE?

MAP_SHARED maps the file's page-cache pages directly; writes modify those pages, are visible to other processes mapping the file, and are eventually written to the file. MAP_PRIVATE maps pages copy-on-write; writes create private copies that aren't visible to others and aren't written to the file.

### [L2 · compare] When would you use mmap instead of read()?

For large files accessed randomly or repeatedly (indexes, lookup tables), when multiple processes should share one in-memory copy, or to avoid copying data between the page cache and user buffers. Prefer read() for streaming/sequential processing, when you need explicit error handling and I/O control, or for writes requiring careful durability ordering.

### [L3 · why] Why do many databases avoid mmap for their data files?

They lose control over when dirty pages are written (breaking write-ahead logging order), page faults block threads without async alternatives, I/O errors appear as SIGBUS, and kernel eviction/TLB shootdowns limit scalability on fast SSDs. A self-managed buffer pool lets the DB control eviction, prefetching, durability order and I/O scheduling.

### [L3 · incident] During Redis background saves, memory usage spikes and the instance is OOM-killed. Explain and mitigate.

BGSAVE forks; the child writes the snapshot while the parent keeps handling writes. Every page the parent modifies is copied (COW), so memory can approach twice the dataset under write-heavy load; with transparent huge pages, each small write copies 2 MB. Mitigate: disable THP, provision headroom (maxmemory well below the limit), reduce write load during saves or save less frequently, use replicas for persistence, and ensure `vm.overcommit_memory = 1` so fork itself isn't refused.

## Practice

### [mcq] A process maps a file with MAP_PRIVATE and writes to it. What happens to the file on disk?

- [ ] It's updated after msync()
- [ ] It's updated when the process exits
- [x] It is not modified; the writes go to private copies of the pages
- [ ] It's corrupted

Private mappings are copy-on-write; the file never sees the changes.

### [mcq] How are I/O errors reported to a program reading an mmap'd file whose disk sector fails?

- [ ] read() returns -1 with EIO
- [x] The process receives SIGBUS when accessing the page
- [ ] mmap() returns MAP_FAILED at mapping time
- [ ] The page silently contains zeros

There's no system call to return an error from — the fault is delivered as a signal.

## Quick Revision

- **COW**: share pages read-only; copy a page on first write. Powers fork, snapshots, MAP_PRIVATE.
- **mmap**: file pages from the page cache mapped into memory; faults load pages lazily.
- `MAP_SHARED` (writes go to file, visible to others) vs `MAP_PRIVATE` (COW, invisible) vs `MAP_ANONYMOUS`.
- Durability needs `msync`/`fsync`; errors arrive as **SIGBUS**.
- DBs often avoid mmap: no control over flush order/I/O, blocking faults, SIGBUS, eviction scalability.
- Redis BGSAVE: COW growth under writes; disable THP.
