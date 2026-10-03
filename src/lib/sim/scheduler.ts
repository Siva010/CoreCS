// Discrete-time CPU scheduling simulator (1 tick = 1 time unit).
// Conventions (stated in the UI): ties are broken by arrival time, then input
// order; in Round Robin, processes arriving at time t are queued before a
// process whose quantum expired at t is re-queued.

export type Algo = "fcfs" | "sjf" | "srtf" | "rr" | "prio" | "prio-p" | "mlfq";

export const ALGO_LABELS: Record<Algo, string> = {
  fcfs: "FCFS",
  sjf: "SJF (non-preemptive)",
  srtf: "SRTF (preemptive SJF)",
  rr: "Round Robin",
  prio: "Priority (non-preemptive)",
  "prio-p": "Priority (preemptive)",
  mlfq: "MLFQ (3 levels)",
};

export interface Proc {
  name: string;
  arrival: number;
  burst: number;
  priority: number; // lower = more important
}

export interface Segment {
  pid: number | null; // index into procs, null = idle
  start: number;
  end: number;
  level?: number; // MLFQ queue level
}

export interface ProcResult {
  completion: number;
  turnaround: number;
  waiting: number;
  response: number;
  firstRun: number;
}

export interface SimResult {
  segments: Segment[];
  results: ProcResult[];
  contextSwitches: number;
  makespan: number;
  avg: { turnaround: number; waiting: number; response: number };
  events: string[];
}

export interface SimOptions {
  quantum: number;
  aging: number; // priority boost every N ticks of waiting (0 = off)
  mlfqQuanta: [number, number];
  boost: number; // MLFQ priority boost period (0 = off)
}

export const DEFAULT_OPTIONS: SimOptions = { quantum: 4, aging: 0, mlfqQuanta: [2, 4], boost: 0 };

export function simulate(procs: Proc[], algo: Algo, opt: SimOptions = DEFAULT_OPTIONS): SimResult {
  const n = procs.length;
  const rem = procs.map((p) => Math.max(0, Math.floor(p.burst)));
  const done = new Array<boolean>(n).fill(false);
  const first = new Array<number>(n).fill(-1);
  const completion = new Array<number>(n).fill(0);
  const waitSince = procs.map((p) => p.arrival);
  const level = new Array<number>(n).fill(0);
  const levelUsed = new Array<number>(n).fill(0);
  const ticks: { pid: number | null; level?: number }[] = [];
  const events: string[] = [];
  const queue: number[] = []; // RR queue
  const mq: number[][] = [[], [], []]; // MLFQ queues
  let cur: number | null = null;
  let slice = 0;
  let expired: number | null = null;
  const q = Math.max(1, Math.floor(opt.quantum));
  const mlfqQ = [Math.max(1, opt.mlfqQuanta[0]), Math.max(1, opt.mlfqQuanta[1]), Infinity];
  const arrived = (i: number, t: number) => procs[i].arrival <= t && !done[i];
  const cmp = (a: number, b: number) => procs[a].arrival - procs[b].arrival || a - b;
  const effPrio = (i: number, t: number) =>
    opt.aging > 0 ? procs[i].priority - Math.floor(Math.max(0, t - waitSince[i]) / opt.aging) : procs[i].priority;

  const limit = procs.reduce((s, p) => Math.max(s, p.arrival), 0) + rem.reduce((a, b) => a + b, 0) + 1;
  for (let t = 0; t <= limit; t++) {
    if (done.every(Boolean)) break;
    // arrivals
    for (let i = 0; i < n; i++) {
      if (procs[i].arrival === t && rem[i] > 0) {
        if (algo === "rr") queue.push(i);
        if (algo === "mlfq") mq[0].push(i);
        events.push(`t=${t}: ${procs[i].name} arrives`);
      }
      if (procs[i].arrival === t && rem[i] === 0) {
        done[i] = true;
        completion[i] = t;
        first[i] = t;
      }
    }
    if (algo === "rr" && expired !== null) {
      queue.push(expired);
      expired = null;
    }
    if (algo === "mlfq") {
      if (expired !== null) {
        mq[level[expired]].push(expired);
        expired = null;
      }
      if (opt.boost > 0 && t > 0 && t % opt.boost === 0) {
        const all = [...mq[1], ...mq[2]];
        if (cur !== null && level[cur] > 0) all.push(cur);
        if (all.length) events.push(`t=${t}: priority boost — all jobs move to Q0`);
        for (const i of all) {
          level[i] = 0;
          levelUsed[i] = 0;
        }
        mq[0].push(...mq[1].splice(0), ...mq[2].splice(0));
      }
    }

    // choose
    const prev: number | null = cur;
    const ready = () => procs.map((_, i) => i).filter((i) => arrived(i, t) && rem[i] > 0);
    switch (algo) {
      case "fcfs":
        if (cur === null) cur = ready().sort(cmp)[0] ?? null;
        break;
      case "sjf":
        if (cur === null) cur = ready().sort((a, b) => rem[a] - rem[b] || cmp(a, b))[0] ?? null;
        break;
      case "srtf": {
        const best = ready().sort((a, b) => rem[a] - rem[b] || cmp(a, b))[0] ?? null;
        if (cur === null || (best !== null && rem[best] < rem[cur])) cur = best;
        break;
      }
      case "prio":
        if (cur === null) cur = ready().sort((a, b) => effPrio(a, t) - effPrio(b, t) || cmp(a, b))[0] ?? null;
        break;
      case "prio-p": {
        const best = ready().sort((a, b) => effPrio(a, t) - effPrio(b, t) || cmp(a, b))[0] ?? null;
        if (cur === null || (best !== null && effPrio(best, t) < effPrio(cur, t))) cur = best;
        break;
      }
      case "rr":
        if (cur === null && queue.length) {
          cur = queue.shift()!;
          slice = 0;
        }
        break;
      case "mlfq": {
        const top = mq.findIndex((qq) => qq.length > 0);
        if (cur !== null && top !== -1 && top < level[cur]) {
          // higher-priority work arrived: preempt, keep used allotment, return to front of its queue
          mq[level[cur]].unshift(cur);
          events.push(`t=${t}: ${procs[cur].name} preempted by a job in Q${top}`);
          cur = null;
        }
        if (cur === null) {
          const lv = mq.findIndex((qq) => qq.length > 0);
          if (lv !== -1) cur = mq[lv].shift()!;
        }
        break;
      }
    }
    if (cur !== prev && cur !== null) {
      if (first[cur] < 0) first[cur] = t;
      events.push(`t=${t}: dispatch ${procs[cur].name}${algo === "mlfq" ? ` (Q${level[cur]})` : ""}`);
    }
    if (prev !== null && cur !== prev && !done[prev] && rem[prev] > 0 && algo !== "rr" && algo !== "mlfq") {
      events.push(`t=${t}: ${procs[prev].name} preempted`);
      waitSince[prev] = t;
    }

    // run one tick
    if (cur === null) {
      ticks.push({ pid: null });
      continue;
    }
    ticks.push({ pid: cur, level: algo === "mlfq" ? level[cur] : undefined });
    rem[cur] -= 1;
    slice += 1;
    if (algo === "mlfq") levelUsed[cur] += 1;
    if (rem[cur] === 0) {
      done[cur] = true;
      completion[cur] = t + 1;
      events.push(`t=${t + 1}: ${procs[cur].name} completes`);
      cur = null;
    } else if (algo === "rr" && slice >= q) {
      events.push(`t=${t + 1}: ${procs[cur].name} quantum expires`);
      expired = cur;
      cur = null;
    } else if (algo === "mlfq" && levelUsed[cur] >= mlfqQ[level[cur]]) {
      const from = level[cur];
      level[cur] = Math.min(2, level[cur] + 1);
      levelUsed[cur] = 0;
      events.push(`t=${t + 1}: ${procs[cur].name} used its Q${from} allotment → demoted to Q${level[cur]}`);
      expired = cur;
      cur = null;
    }
  }

  // merge ticks into segments
  const segments: Segment[] = [];
  ticks.forEach((tk, t) => {
    const last = segments[segments.length - 1];
    if (last && last.pid === tk.pid && last.level === tk.level) last.end = t + 1;
    else segments.push({ pid: tk.pid, start: t, end: t + 1, level: tk.level });
  });
  let contextSwitches = 0;
  let lastPid: number | null = null;
  for (const s of segments) {
    if (s.pid === null) continue;
    if (lastPid !== null && lastPid !== s.pid) contextSwitches++;
    lastPid = s.pid;
  }
  const results: ProcResult[] = procs.map((p, i) => {
    const turnaround = completion[i] - p.arrival;
    return {
      completion: completion[i],
      turnaround,
      waiting: turnaround - p.burst,
      response: first[i] - p.arrival,
      firstRun: first[i],
    };
  });
  const avg = (f: (r: ProcResult) => number) => (n ? results.reduce((s, r) => s + f(r), 0) / n : 0);
  return {
    segments,
    results,
    contextSwitches,
    makespan: ticks.length,
    avg: { turnaround: avg((r) => r.turnaround), waiting: avg((r) => r.waiting), response: avg((r) => r.response) },
    events,
  };
}
