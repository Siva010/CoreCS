---
title: "100% CPU From One Regular Expression"
subject: os
summary: "A new email-validation regex backtracked catastrophically on certain inputs. A handful of crafted signups pinned every event-loop thread, and the Node.js API stopped serving requests entirely — found in minutes with a CPU profile."
difficulty: 3
concepts: [os-profiling-observability, os-performance-method, os-epoll-event-loops, x-overloaded-server, os-scheduling-basics]
tags: [high cpu, redos, catastrophic backtracking, flame graph, event loop blocked, perf, input validation]
order: 21
---

## Context

A Node.js signup API (8 pods × 1 process, one event loop each). A release added stricter email validation:

```javascript
const EMAIL = /^([a-zA-Z0-9]+[._-]?)*[a-zA-Z0-9]+@example-partner\.com$/;
```

## Symptoms

- Minutes after the release, all pods show 100% CPU; health checks time out; the load balancer marks pods unhealthy.
- Request rate is normal; errors are timeouts, not exceptions.
- Rolling back fixes it; re-deploying reproduces it within an hour.

## Metrics

| Metric | Normal | Incident |
|---|---|---|
| CPU per pod | 20% | 100% (one core, user time) |
| Event-loop lag | < 5 ms | > 30 s |
| Requests completed/s | 400 | ~0 |
| Context switches | normal | low (a single thread spinning) |

High user CPU, low syscall and context-switch activity, normal traffic: a CPU-bound computation, not I/O or contention ([Performance Method](lesson:os-performance-method)).

## Hypotheses

1. An expensive code path triggered by specific inputs.
2. A hot loop from a bug in the new release.
3. GC thrashing → GC metrics normal; ruled out.

## Investigation

- `top -H -p <pid>`: one thread at 100% — the main (event-loop) thread.
- CPU profile (`node --cpu-prof`, or `perf record -g` with perf maps → flame graph): > 95% of samples in the V8 regex engine (`RegExp` backtracking) called from `validateEmail`.
- Replaying recent inputs: a signup with `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!` took **40 seconds** to reject. The nested quantifier `([a-zA-Z0-9]+[._-]?)*` can split a run of letters in exponentially many ways; on a non-matching input the backtracking engine tries them all — **catastrophic backtracking (ReDoS)**.
- With a single-threaded event loop, one such request blocks every other request on that process ([epoll & Event Loops](lesson:os-epoll-event-loops)).

## Root Cause

A regular expression with ambiguous nested quantifiers had exponential worst-case time on non-matching input. Because validation ran on the event loop, a few malicious or accidental inputs made each process unresponsive, and health-check failures removed pods from rotation.

## Fix

1. Rolled back; then replaced the regex with an unambiguous pattern (`^[a-zA-Z0-9]+(?:[._-][a-zA-Z0-9]+)*@example-partner\.com$`) and a length limit (254 chars) checked first.
2. Moved to a linear-time regex engine (RE2) for user-supplied input.
3. Added a request CPU budget / timeout at the edge.

## Prevention

- Lint for ReDoS-prone patterns; fuzz validators with adversarial input.
- Never run unbounded CPU work on an event loop; offload to worker threads with timeouts.
- Monitor event-loop lag as a first-class saturation signal ([Overloaded Server](lesson:x-overloaded-server)).

## Interview Angle

"CPU is at 100%, what do you do?" → confirm it's user CPU (not sys, not iowait, not steal), find the hot thread, take a profile/flame graph, and read the dominant stack. Bonus: explain why one slow request can freeze a single-threaded server and how backtracking regex engines blow up ([Profiling & Observability](lesson:os-profiling-observability)).
