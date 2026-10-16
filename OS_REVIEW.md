# Operating Systems track — review and ratings

*Reviewed 16 October 2026, covering all 45 operating-systems lessons. They were then improved in the same five rounds as the [database track](DBMS_REVIEW.md), with every code example moved to Java, and a sixth round added two labs and a repeatable Java check. The track now has 48 lessons.*

## Verdict

The OS track was already **accurate and mechanism-first**. Paging, the TLB, scheduling, locks and epoll were explained from the problem up. The review found three weaknesses:

- **Almost no self-testing.** There were 103 practice items, about 2 per lesson, and only 36 numericals or exercises in a subject that exams test with numericals.
- **Code that didn't match the audience.** There were 37 C blocks, Python and Node.js snippets, and only 7 Java blocks, for readers preparing for Java backend interviews.
- **Textbook gaps** that campus interviews ask about by name: HRRN, file allocation methods and FAT, the access matrix, suspended states, address binding, and types of system calls.

The rounds:

- **Questions and theory:** 54 new questions, 19 textbook sections, and one accuracy fix.
- **Practice and new lessons:** every lesson now has at least 6 practice items, at least 2 of them numericals or exercises. There are three new lessons: *The Java Memory Model*, *The JVM on Linux* and *Protection & Security*.
- **Understandability:** long sentences split, more worked traces, and hover definitions for 115 OS terms.
- **Diagrams:** every lesson has one (14 of 45 did before).
- **Java:** 94 Java blocks, up from 7, all compile-checked with JDK 21. One C block is left on purpose.
- **Labs and a Java check:** two new labs, *File Allocation & Inodes* and *RAID Layout & Rebuild*, and a script that compiles every Java block.

**Overall 7.9 → 8.9.** Most of the gain is practice (3.5 → 8.7), which started very low.

A note on honesty: I wrote these lessons, so this is a review of my own work. I recorded each lesson's starting scores before editing it, and practice is scored by a fixed rule, not by impression. In hindsight, the 9s for content and clarity at the start were generous. The lessons then had 22 sentences over 45 words and only 14 diagrams. I didn't lower those scores after the fact, and I didn't raise them for this round's clarity work either. This also means the OS track's 8.9 shouldn't be read as "better than the database track's 8.5". The two were scored in separate passes, and the OS starting scores were kinder.

## How the ratings work

The same six dimensions as the database review, each scored 1–10:

| Dimension | What a 9 means |
|---|---|
| **Content accuracy & depth** | Correct for current Linux and JDK behaviour, explains the mechanism, no hand-waving. |
| **First-principles clarity** | Problem → idea → mechanism is obvious; a reader could re-derive the design. |
| **Interview readiness** | Covers the classic questions *and* the follow-ups (including the Java ones), with model answers at L1–L3 depth plus traps. |
| **Practice / self-testing** | Enough MCQs, numericals and exercises to check yourself, ideally hands-on. |
| **Production relevance** | Failure modes, real signals (`/proc`, `perf`, thread dumps, JFR), operational advice an engineer would use. |
| **Syllabus coverage** | Includes the textbook topics (Galvin, Stallings, Tanenbaum) that examiners and campus interviewers ask for by name. |

**Practice is scored by a fixed rule:**

| Items | Condition | Score |
|---|---|---|
| ≤ 3 | — | 3 |
| ≤ 3 | with a numerical or exercise | 4 |
| 4–5 | — | 5 |
| 4–5 | with ≥ 2 numericals/exercises | 6 |
| ≥ 6 | with a numerical or exercise | 7 |
| ≥ 6 | with ≥ 2 numericals/exercises | 8 |
| ≥ 6 | the same, plus practice that uses one of the site's labs or visualizations | 9 |

Nothing got a 10.

## Track-level scores

| Dimension | Before (45 lessons) | After, same 45 | After, all 48 |
|---|---|---|---|
| Content accuracy & depth | 9.0 | 9.0 | **9.0** |
| First-principles clarity | 9.0 | 9.0 | **9.0** |
| Interview readiness | 8.6 | 8.9 | **8.9** |
| Practice / self-testing | 3.5 | 8.7 | **8.7** |
| Production relevance | 8.8 | 8.9 | **8.9** |
| Syllabus coverage | 8.6 | 8.9 | **8.9** |
| **Overall** | **7.9** | **8.9** | **8.9** |

The new lessons don't change the averages. *The Java Memory Model* scores 9.0, while *The JVM on Linux* and *Protection & Security* score 8.7. Neither of the last two has a lab to practise against.

## What was already strong

- **Mechanism-first explanations.** The lessons build from the problem up: why paging beats segmentation, why the TLB exists, why MLFQ looks the way it does, why a spin lock needs an atomic instruction, why epoll scales. Most textbooks list these as facts instead.
- **Production realism.** The lessons cover:
  - page-fault and context-switch counters;
  - `perf`, `strace` and `/proc`;
  - container memory limits;
  - thread-pool sizing;
  - the USE method;
  - the `CLOSE_WAIT` and fd-leak stories.
- **Interactive labs** for the numerical topics: CPU scheduling, page replacement, Banker's algorithm, disk scheduling, address translation, race interleavings and producer–consumer.
- **Accuracy.** One real error was found. The scheduling-basics worked example labelled "SJF" was preemptive, so it was really SRTF. It is fixed.

## What the review found weak

1. **Thin practice.** There were 103 items across 45 lessons: 67 MCQs, 28 numericals and 8 exercises. No lesson had 6 items, and no practice item sent you to a lab.
2. **Code in the wrong language for the audience.** The code was:
   - 37 C blocks;
   - 3 Python and 1 Node.js snippet;
   - 7 Java blocks.

   A Java developer had to translate `pthread_mutex_lock`, `sigaction` and `mmap` in their head before seeing how these show up in their own code.
3. **Textbook gaps:**
   - kinds of OS;
   - average memory access time;
   - compile → link → load and the boot sequence;
   - suspended states and the three schedulers;
   - message-passing design choices;
   - HRRN;
   - rate-monotonic vs EDF;
   - the sleeping barber;
   - address binding and base/limit registers;
   - fixed vs variable partitioning;
   - file allocation methods and FAT;
   - free-space management;
   - directory structures;
   - types of system calls;
   - the whole protection and security chapter.
4. **Few diagrams.** 31 of 45 lessons had none; several drew diagrams as ASCII art in text blocks.

## Update 1: interview questions and textbook theory

- **Question bank 294 → 348.** That is 31 new questions in the original lessons and 23 in the new ones. Most of the new questions are the Java follow-up an interviewer asks next. For example:
  - Why do blocking calls inside a parallel stream hurt?
  - How would you find an fd leak in a Java service?
  - How does Kafka serve hundreds of MB/s without a large heap?
  - Where does epoll come in when a virtual thread blocks on a socket?
  - Asynchronous vs deferred cancellation: which does Java use?
- **Textbook sections added:**
  - kinds of OS (batch, time-sharing, real-time, distributed, embedded);
  - average memory access time and cache coherence;
  - compile/link/load, linker vs loader, and the boot sequence with a trace;
  - suspended states with the long-, medium- and short-term schedulers;
  - cascading termination;
  - context-switch efficiency q/(q+s);
  - message passing (direct/indirect, blocking, buffering, rendezvous);
  - thread states and cancellation;
  - HRRN with the Stallings example;
  - rate-monotonic vs EDF;
  - the sleeping barber;
  - the deadlock-free resource count n(m−1)+1;
  - address binding and base/limit registers;
  - fixed vs variable partitions and the 50% rule;
  - segmented paging;
  - the Clock algorithm traced step by step;
  - contiguous, linked and indexed allocation with FAT;
  - free-space management, directory structures and access methods;
  - types of system calls and how parameters are passed.
- **Every scheduling, page-replacement and disk-scheduling number was re-run through the site's own simulators.** Examples: FCFS/SJF/SRTF/RR on the convoy example, RR with q = 2, Clock on the classic reference string (14 faults), and SSTF/C-SCAN from head 50 (208 and 391 cylinders).

## Update 2: practice and new lessons

- **Practice 103 → 308 items:**
  - 118 MCQs;
  - 129 numericals;
  - 61 written exercises with worked solutions.

  Every lesson has at least 6 items, with at least 2 numericals or exercises. The content validator checks each numerical answer against its worked solution.
- **30 of 48 lessons now have practice that uses a lab or visualization** (none did before). The lab items ask something the lab answers. Examples:
  - find a lost update in the race-condition lab, then explain why `AtomicInteger` removes it;
  - fill the producer–consumer buffer, then map it onto a full pipe and onto `ThreadPoolExecutor`'s rejection policy;
  - watch a zombie appear in the process-lifecycle lab, then explain the JDK's reaper thread and PID 1 in containers.
- **Three new lessons:**
  - *The Java Memory Model* (level 4) covers:
    - happens-before rules, volatile, synchronized, and final-field safe publication;
    - double-checked locking and the holder idiom;
    - the guarantees of `java.util.concurrent`;
    - how the JIT maps all this onto x86 and ARM fences;
    - VarHandle access modes;
    - `long`/`double` tearing.
  - *The JVM on Linux* (level 10) covers:
    - the JVM as a Linux process, with its memory regions and Native Memory Tracking;
    - why RSS exceeds `-Xmx`;
    - JVM threads as kernel threads (`top -H` → `nid` in a thread dump);
    - GC and the OS: THP, swap and CPU quotas;
    - safepoints;
    - signals the JVM uses;
    - a production flag list.
  - *Protection & Security* (level 11, now named "Isolation & Security") covers:
    - the access matrix, ACLs vs capability lists, and Unix permissions with the `open()` check;
    - setuid and effective UIDs;
    - Linux capabilities, and DAC vs MAC (SELinux, AppArmor);
    - buffer overflows and their defences (canaries, NX, ASLR);
    - seccomp sandboxing and TOCTOU races;
    - a hardened Java container image.
- **Roadmaps:**
  - Protection & Security joins the fresher "interview core" track.
  - The JMM joins the 1–3 YOE concurrency list.
  - JVM on Linux joins the 1–3 YOE I/O list and the advanced list.

## Update 3: understandability

Measured on the theory sections (Mental Model through Example):

| Measure | Before (45 lessons) | After (48 lessons) |
|---|---|---|
| Sentences over 45 words | 22 | 0 |
| Sentences over 35 words | 90 | 7 |
| Sentences over 30 words | 176 | 112 |
| Worked examples with concrete values (`text` traces) | 45 | 59 (55 in the original 45) |
| OS terms with a hover definition | 0 | 115 (604 first uses marked) |

- **Long sentences were rewritten, not trimmed.** Lists hidden inside sentences became bullet lists, and no facts or links were removed.
- **New worked traces with real values**, for example:
  - a `write()` from Java to the disk;
  - `java -jar` from `execve` to `main`;
  - `ProcessBuilder.start()` seen through `strace`;
  - the Clock hand sweeping frames;
  - a four-level page walk in Java bit arithmetic;
  - `top -H` → `nid` → the thread-dump line.
- **The glossary covers OS lessons now.** It already had the database terms. The first plain use of a term shows a definition on hover or tap, with a link to the lesson that explains it.
  - An entry marks only lessons of its own subject, so "page" in a database lesson never links to OS paging.
  - Words with everyday meanings are limited to the lessons where they mean the OS thing: page, swap, frame, fork, signal, monitor and interrupt. The dining philosophers' forks, for example, aren't marked as `fork()`.

## Update 4: diagrams

| Measure | Before | After |
|---|---|---|
| Lessons with a Mermaid diagram | 14 of 45 | 48 of 48 |
| Mermaid diagrams | 14 | 50 |
| New diagrams below 80% of natural size (desktop column) | — | 0 of 36 |

- **36 new diagrams**, each placed next to the text it illustrates. For example:
  - a virtual-to-physical mapping for two processes;
  - the four-level page walk;
  - the Clock hand;
  - a happens-before edge from a volatile write;
  - the Mesa monitor race that makes `while` necessary;
  - the dining philosophers' wait cycle;
  - a RAID-5 small write;
  - the `open()` permission check;
  - `read()` vs `mmap`;
  - the fd → open-file → inode tables;
  - path resolution;
  - journaling recovery;
  - reclaim → OOM kill;
  - the JVM's memory regions;
  - a VM vs a container;
  - a timeline of concurrency vs parallelism.
- **Readable at real size.** Every new diagram was measured at its rendered width.
  - Wide chains became top-to-bottom.
  - Long labels got explicit line breaks.
  - Sequence diagrams got narrower actor boxes.
  - The gantt chart is pinned to the column width, since gantt otherwise draws at the full window width (it was at 44% of natural size).
  - The smallest new diagram renders at 82%.
- **Accuracy.** The new `open()` diagram first skipped a step: it never checked the selected permission bits against the requested mode. It was fixed before publishing.

## Update 5: Java examples

| Code blocks | Before | After |
|---|---|---|
| Java | 7 | 94 |
| C | 37 | 1 |
| Python | 3 | 0 |
| JavaScript | 1 | 0 |
| Shell (kept as shell) | 26 | 31 |

- **Program code is Java.** Examples:
  - `ProcessBuilder` replaces `fork`/`exec`;
  - shutdown hooks replace `sigaction`;
  - `ReentrantLock`, `Semaphore` and `Condition` replace pthreads;
  - an `AtomicBoolean` test-and-set lock, a ticket lock and a Treiber stack replace the C atomics;
  - `FileChannel.map` and `MemorySegment` replace `mmap`;
  - `Selector` and NIO replace `select`/`epoll` in C;
  - `@Contended` shows false sharing;
  - `force(true)` with `ATOMIC_MOVE` and a directory `fsync` shows the atomic-replace pattern.
- **Kept on purpose:**
  - **The C `fork()` counting puzzle**, because Java has no `fork` and the puzzle is a classic campus question.
  - **Shell commands** (`strace`, `perf`, `/proc`, `ps`, `lsof`), because they are what you type on a server.
- **Compile-checked.** All 94 Java blocks went through `javac` 21:

  | Result | Blocks |
  |---|---|
  | Compile as written | 52 |
  | Compile except for names the lesson defines around them (`Account`, `Node`, `produce()`) | 39 |
  | Not compilable on purpose: two threads drawn side by side | 1 |
  | Netty examples, not checked (they need the Netty library) | 2 |

  The check found **two real errors**, and both are fixed. One block had a `for` loop at class level. The other called `Config.load()` on a record that doesn't define it.
- **Java facts were checked against current JDK behaviour:**
  - Since JDK 20, `Thread.stop` throws `UnsupportedOperationException`.
  - Pinning on `synchronized` for virtual threads was removed in JDK 24.
  - The JDK `Selector` is level-triggered, while Netty's native transport is edge-triggered.
  - The default heap is 25% of the container's memory limit (`MaxRAMPercentage`).
  - `availableProcessors()` rounds a CPU quota up.
  - Outside the JDK, `@Contended` needs `--add-exports` to compile and `-XX:-RestrictContended` to take effect.
  - The SecurityManager was disabled in JDK 24.

## Update 6: labs and a repeatable Java check

The database round added two labs for its new theory. This round does the same for the OS topics that had numericals but nothing to practise them on.

- **File Allocation & Inodes** (`/labs/file-allocation`) has two parts.
  - **Inode pointers.** You set the block size, the address size and the number of direct, single, double and triple indirect pointers. The lab shows:
    - what each pointer reaches and the largest file;
    - for any byte offset, the logical block, the entry used in each index block (with the division written out) and the disk reads;
    - how many index blocks a file of a given size needs.

    Presets cover ext2 with 4 KB and 1 KB blocks, and an exam-style inode.
  - **Allocation methods.** One file is laid out on a deliberately fragmented 32-block disk with contiguous, linked, FAT and indexed allocation. The lab shows:
    - the disk reads to reach block k under each method, side by side;
    - contiguous allocation failing with 16 blocks free.
- **RAID Layout & Rebuild** (`/labs/raid`) covers RAID 0, 1, 5, 6 and 10 stripe by stripe, with a real byte in every block.
  - **Fail disks** and each lost block is rebuilt with its working shown: the XOR for RAID 5, the mirror for RAID 1 and 10, and P plus Reed–Solomon Q for RAID 6.
  - **Change a block** and the read-modify-write I/Os appear with the new P (and Q) values.
  - **Stats** cover usable capacity, random-write IOPS, rebuild time and the chance of an unreadable sector during a rebuild.

  RAID 6's Q uses the same GF(2⁸) arithmetic as Linux md. The simulation was checked exhaustively: all 1,031 single and double failures on 3–8 disks rebuild the original bytes. Every small write's new P and Q also matches a full recomputation.
- **Practice:** filesystem internals and RAID each gained a lab-based item.
  - Totals: practice 308 → 310 items, and lessons whose practice uses a lab 30 → 32.
  - Both lessons' practice scores go from 8 to 9.
  - Track practice goes from 8.6 to 8.7; the overall stays 8.9.
- **`scripts/_verify-java.mts`** makes the Java check repeatable.
  - It compiles every Java block in the lessons, trying each fragment as written, as a class body and as a method body.
  - It fails on anything except names the lesson defines elsewhere.
  - Deliberate non-Java (the side-by-side threads) and Netty examples are listed in the script with the reason.
  - Its first run found that the false-sharing lesson's prose and exercise mentioned only the runtime flag for `@Contended`, not the `--add-exports` flag needed to compile. Both now give both flags.

## Readiness by audience

| Audience | Before | After | Comment |
|---|---|---|---|
| **Freshers / campus placements / GATE-style theory** | 7.5 | **8.9** | Every lesson has at least two numericals or worked exercises. Numericals cover scheduling, page replacement, EAT/AMAT, Banker's, disk scheduling, working set, RAID capacity and permission bits. They are checked against the site's simulators, and inode and RAID questions now have labs of their own. The textbook gaps are filled. |
| **1–3 YOE Java backend** | 7.0 | **9.0** | Every concept is shown in the code the reader writes. The JMM and JVM-on-Linux lessons cover what Java interviews and incidents actually ask: volatile and safe publication, RSS vs heap, OOMKilled vs `OutOfMemoryError`, thread dumps. |
| **3–5+ YOE / performance and systems rounds** | 8.0 | **8.6** | Covers JFR, async-profiler and `jcmd`, epoll and virtual threads, NUMA and hugepage flags, and CPU quotas. It is still conceptual: there are no hands-on performance labs. |

## What is still missing (honest gaps)

- **Written exercises are self-graded.** MCQs and the 130 numericals are checked automatically. The 62 written exercises rely on comparing your answer with the worked solution.
- **16 lessons have no lab to practise against.** The ones that would most benefit are journaling, the page cache, profiling and protection. Labs that would help:
  - a journaling lab that crashes mid-write and replays the log;
  - a JMM litmus-test explorer that shows which outcomes are allowed;
  - an AMAT/EAT calculator.
- **The Java check isn't part of the build.** `scripts/_verify-java.mts` needs a local JDK, so it runs by hand, not in `npm run check` or the Cloudflare build. 39 blocks are fragments that only compile with the lesson's surrounding names, and none of the code is executed.
- **Eight older diagrams render below 80% of natural size.** They are in hardware model, what an OS does, program execution, signals, threads, deadlocks, page cache and epoll, and range from 53% to 74%. A separate session is fixing them. Merging that work may conflict with this round's edits in the same eight files.
- **Linux-first.** Windows gets only occasional notes (NT scheduling, handles, IOCP), and macOS almost none.
- **112 theory sentences are still over 30 words.** The readability work targeted the longest ones first.
- **Production relevance barely moved (8.8 → 8.9).** It was already high, and these rounds added practice, theory and Java mapping, not new operational depth.

## Per-lesson scorecard

Arrows show before → after where something changed. Questions and practice items are counts; the other columns are scores.

| Lesson | Questions | Practice items | Content | First principles | Interview | Practice | Production | Syllabus | Overall |
|---|---|---|---|---|---|---|---|---|---|
| `os-address-spaces` | 7 → 8 | 2 → 7 | 9 | 9 | 9 | 3 → **9** | 9 | 8 → **9** | 7.8 → **9.0** |
| `os-atomic-instructions` | 6 | 2 → 7 | 9 | 9 | 9 | 3 → **9** | 9 | 9 | 8.0 → **9.0** |
| `os-classic-sync-problems` | 7 | 2 → 6 | 9 | 9 | 9 | 3 → **9** | 9 | 8 → **9** | 7.8 → **9.0** |
| `os-concurrency-vs-parallelism` | 6 → 7 | 3 → 7 | 9 | 9 | 8 → **9** | 4 → **8** | 9 | 9 | 8.0 → **8.8** |
| `os-context-switch` | 7 → 8 | 2 → 6 | 9 | 9 | 9 | 3 → **9** | 9 | 8 → **9** | 7.8 → **9.0** |
| `os-cow-mmap` | 5 → 6 | 2 → 6 | 9 | 9 | 8 → **9** | 3 → **8** | 9 | 9 | 7.8 → **8.8** |
| `os-cpu-caches-contention` | 5 → 6 | 2 → 6 | 9 | 9 | 8 → **9** | 3 → **8** | 9 | 9 | 7.8 → **8.8** |
| `os-critical-section-problem` | 6 | 2 → 6 | 9 | 9 | 9 | 3 → **9** | 8 | 9 | 7.8 → **8.8** |
| `os-deadlock-handling` | 8 | 3 → 6 | 9 | 9 | 9 | 4 → **9** | 9 | 9 | 8.2 → **9.0** |
| `os-deadlocks` | 7 | 2 → 6 | 9 | 9 | 9 | 3 → **9** | 9 | 9 | 8.0 → **9.0** |
| `os-dynamic-allocation` | 7 | 3 → 7 | 9 | 9 | 9 | 4 → **9** | 9 | 9 | 8.2 → **9.0** |
| `os-epoll-event-loops` | 6 → 7 | 2 → 6 | 9 | 9 | 8 → **9** | 3 → **9** | 9 | 9 | 7.8 → **9.0** |
| `os-file-descriptors` | 5 → 6 | 2 → 6 | 9 | 9 | 8 → **9** | 3 → **8** | 9 | 9 | 7.8 → **8.8** |
| `os-filesystem-internals` | 6 → 7 | 2 → 9 | 9 | 9 | 8 → **9** | 3 → **9** | 9 | 7 → **9** | 7.5 → **9.0** |
| `os-hardware-model` | 7 → 8 | 2 → 6 | 9 | 9 | 8 → **9** | 4 → **8** | 8 → **9** | 7 → **8** | 7.5 → **8.7** |
| `os-hugepages-numa` | 4 → 6 | 2 → 7 | 9 | 9 | 7 → **8** | 4 → **8** | 9 | 9 | 7.8 → **8.7** |
| `os-io-models` | 6 → 7 | 2 → 6 | 9 | 9 | 8 → **9** | 3 → **9** | 9 | 9 | 7.8 → **9.0** |
| `os-ipc` | 7 → 8 | 2 → 7 | 9 | 9 | 8 → **9** | 3 → **9** | 8 → **9** | 8 → **9** | 7.5 → **9.0** |
| `os-java-memory-model` | 8 (new) | 6 (new) | 9 | 9 | 9 | 9 | 9 | 9 | **9.0** (new) |
| `os-journaling` | 6 | 2 → 6 | 9 | 9 | 9 | 3 → **8** | 9 | 9 | 8.0 → **8.8** |
| `os-jvm-on-linux` | 7 (new) | 6 (new) | 9 | 9 | 9 | 8 | 9 | 8 | **8.7** (new) |
| `os-mlfq-real-schedulers` | 6 | 2 → 6 | 9 | 9 | 9 | 3 → **9** | 9 | 8 → **9** | 7.8 → **9.0** |
| `os-page-cache` | 5 → 6 | 2 → 6 | 9 | 9 | 8 → **9** | 3 → **8** | 9 | 9 | 7.8 → **8.8** |
| `os-page-faults` | 7 | 2 → 6 | 9 | 9 | 9 | 4 → **9** | 9 | 9 | 8.2 → **9.0** |
| `os-page-replacement` | 8 | 4 → 6 | 9 | 9 | 9 | 6 → **9** | 9 | 9 | 8.5 → **9.0** |
| `os-paging` | 8 | 3 → 8 | 9 | 9 | 9 | 4 → **9** | 9 | 9 | 8.2 → **9.0** |
| `os-performance-method` | 7 | 3 → 7 | 9 | 9 | 9 | 4 → **8** | 9 | 9 | 8.2 → **8.8** |
| `os-process-creation` | 8 → 9 | 3 → 6 | 9 | 9 | 9 | 4 → **9** | 9 | 8 → **9** | 8.0 → **9.0** |
| `os-processes` | 9 → 10 | 3 → 6 | 9 | 9 | 9 | 4 → **9** | 9 | 8 → **9** | 8.0 → **9.0** |
| `os-profiling-observability` | 5 → 6 | 2 → 6 | 9 | 9 | 8 → **9** | 3 → **8** | 9 | 9 | 7.8 → **8.8** |
| `os-program-execution` | 6 → 8 | 2 → 6 | 9 | 9 | 8 → **9** | 4 → **8** | 9 | 8 → **9** | 7.8 → **8.8** |
| `os-protection-security` | 8 (new) | 7 (new) | 9 | 9 | 8 | 8 | 9 | 9 | **8.7** (new) |
| `os-race-conditions` | 8 → 9 | 3 → 7 | 9 | 9 | 9 | 4 → **9** | 9 | 9 | 8.2 → **9.0** |
| `os-raid` | 4 → 6 | 2 → 8 | 9 | 9 | 7 → **8** | 4 → **9** | 8 | 9 | 7.7 → **8.7** |
| `os-scheduling-algorithms` | 8 → 9 | 3 → 7 | 9 | 9 | 9 | 4 → **9** | 8 | 8 → **9** | 7.8 → **8.8** |
| `os-scheduling-basics` | 7 | 2 → 6 | 8 → **9** | 9 | 9 | 4 → **9** | 9 | 9 | 8.0 → **9.0** |
| `os-segmentation` | 4 → 6 | 2 → 6 | 9 | 9 | 7 → **8** | 4 → **8** | 7 → **8** | 9 | 7.5 → **8.5** |
| `os-semaphores-monitors` | 7 | 2 → 6 | 9 | 9 | 9 | 4 → **9** | 9 | 9 | 8.2 → **9.0** |
| `os-signals` | 7 → 8 | 2 → 7 | 9 | 9 | 8 → **9** | 3 → **9** | 9 | 8 | 7.7 → **8.8** |
| `os-storage-devices` | 7 | 3 → 7 | 9 | 9 | 9 | 4 → **9** | 9 | 9 | 8.2 → **9.0** |
| `os-sync-primitives` | 8 | 2 → 6 | 9 | 9 | 9 | 3 → **9** | 9 | 9 | 8.0 → **9.0** |
| `os-syscalls-interrupts` | 7 → 8 | 2 → 7 | 9 | 9 | 9 | 3 → **9** | 9 | 8 → **9** | 7.8 → **9.0** |
| `os-thrashing-working-set` | 6 → 7 | 2 → 6 | 9 | 9 | 9 | 3 → **9** | 9 | 9 | 8.0 → **9.0** |
| `os-thread-pools` | 7 | 2 → 7 | 9 | 9 | 9 | 4 → **9** | 9 | 9 | 8.2 → **9.0** |
| `os-threads` | 7 → 9 | 2 → 6 | 9 | 9 | 9 | 3 → **9** | 9 | 8 → **9** | 7.8 → **9.0** |
| `os-tlb` | 6 | 3 → 7 | 9 | 9 | 9 | 4 → **9** | 9 | 9 | 8.2 → **9.0** |
| `os-virtualization-containers` | 6 | 2 → 6 | 9 | 9 | 9 | 3 → **8** | 9 | 8 | 7.8 → **8.7** |
| `os-what-an-os-does` | 8 → 9 | 2 → 6 | 9 | 9 | 8 → **9** | 3 → **8** | 8 | 7 → **9** | 7.3 → **8.7** |
