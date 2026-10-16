// Classic memory-model litmus tests in Java: message passing, store buffering,
// load buffering and object publication. Enumerates every sequentially
// consistent interleaving, then marks the one outcome no interleaving produces
// and says whether the Java Memory Model allows it for each access mode.
// Pure data and functions, shared by the Memory Model lab and checkable with tsx.

export type Mode = "plain" | "final" | "release-acquire" | "volatile";

export interface Op {
  kind: "write" | "read";
  v: string; // shared variable
  value?: number; // for writes
  reg?: string; // for reads
  label?: string; // how to print the step, when the default would mislead
}

export interface Verdict {
  allowed: boolean;
  why: string;
}

export interface LitmusTest {
  id: string;
  name: string;
  short: string;
  intro: string;
  modes: Mode[];
  ops: [Op[], Op[]];
  regs: string[];
  /** The outcome no interleaving produces. */
  relaxed: Record<string, number>;
  /** How to print a register value ("null", "—"). */
  show?: (reg: string, value: number, all: Record<string, number>) => string;
  decl: Partial<Record<Mode, string>>;
  code: Partial<Record<Mode, [string, string]>>;
  verdict: Partial<Record<Mode, Verdict>>;
  /** Where plain accesses show the relaxed outcome in hardware, before the JIT does anything. */
  hardware: { x86: string; arm: string };
}

export const TESTS: LitmusTest[] = [
  {
    id: "mp",
    name: "Message passing",
    short: "MP",
    intro: "Thread 1 writes some data, then raises a flag. Thread 2 checks the flag, then reads the data. Can it see the flag up but the data still old?",
    modes: ["plain", "release-acquire", "volatile"],
    ops: [
      [
        { kind: "write", v: "data", value: 1 },
        { kind: "write", v: "ready", value: 1 },
      ],
      [
        { kind: "read", v: "ready", reg: "r1" },
        { kind: "read", v: "data", reg: "r2" },
      ],
    ],
    regs: ["r1", "r2"],
    relaxed: { r1: 1, r2: 0 },
    decl: {
      plain: "int data, ready;",
      "release-acquire": "int data, ready;   // ready accessed through VarHandle READY",
      volatile: "int data;\nvolatile int ready;",
    },
    code: {
      plain: ["data = 1;\nready = 1;", "int r1 = ready;\nint r2 = data;"],
      "release-acquire": ["data = 1;\nREADY.setRelease(this, 1);", "int r1 = (int) READY.getAcquire(this);\nint r2 = data;"],
      volatile: ["data = 1;\nready = 1;", "int r1 = ready;\nint r2 = data;"],
    },
    verdict: {
      plain: {
        allowed: true,
        why: "Nothing orders two plain writes for another thread. The JIT may swap them, and an ARM core may make them visible out of order. Thread 2 can see ready = 1 and still read the old data.",
      },
      "release-acquire": {
        allowed: false,
        why: "A release write publishes every write before it to an acquire read that sees it. If thread 2 reads ready = 1, it must also see data = 1. Data itself can stay a plain field.",
      },
      volatile: {
        allowed: false,
        why: "The volatile write of ready happens-before the volatile read that sees it, and data = 1 comes before that write in program order. By transitivity thread 2 must see data = 1.",
      },
    },
    hardware: {
      x86: "No: x86 keeps stores in order and loads in order. In Java the JIT may still reorder the plain accesses.",
      arm: "Yes: ARM and POWER may make the two stores visible in either order.",
    },
  },
  {
    id: "sb",
    name: "Store buffering (Dekker)",
    short: "SB",
    intro: "Each thread raises its own flag, then checks the other's. This is the heart of Dekker's and Peterson's locks. Can both threads miss each other's flag?",
    modes: ["plain", "release-acquire", "volatile"],
    ops: [
      [
        { kind: "write", v: "x", value: 1 },
        { kind: "read", v: "y", reg: "r1" },
      ],
      [
        { kind: "write", v: "y", value: 1 },
        { kind: "read", v: "x", reg: "r2" },
      ],
    ],
    regs: ["r1", "r2"],
    relaxed: { r1: 0, r2: 0 },
    decl: {
      plain: "int x, y;",
      "release-acquire": "int x, y;   // accessed through VarHandles X and Y",
      volatile: "volatile int x, y;",
    },
    code: {
      plain: ["x = 1;\nint r1 = y;", "y = 1;\nint r2 = x;"],
      "release-acquire": ["X.setRelease(this, 1);\nint r1 = (int) Y.getAcquire(this);", "Y.setRelease(this, 1);\nint r2 = (int) X.getAcquire(this);"],
      volatile: ["x = 1;\nint r1 = y;", "y = 1;\nint r2 = x;"],
    },
    verdict: {
      plain: {
        allowed: true,
        why: "Each store waits in its core's store buffer while the following load runs ahead and reads the old value from the cache. Both threads read 0.",
      },
      "release-acquire": {
        allowed: true,
        why: "Release and acquire order only one way: earlier accesses stay before a release, later ones stay after an acquire. A release store followed by an acquire load of a different variable may still swap, and on x86 both compile to plain moves.",
      },
      volatile: {
        allowed: false,
        why: "All volatile accesses fall into one total order that respects each thread's program order. Whichever write comes first in it, the other thread's later read sees it. HotSpot pays with a full fence after each volatile write on x86.",
      },
    },
    hardware: {
      x86: "Yes: this is the one reordering x86 does, through its store buffers.",
      arm: "Yes.",
    },
  },
  {
    id: "lb",
    name: "Load buffering",
    short: "LB",
    intro: "Each thread reads one variable, then writes the other. Can each read see the write that comes after the other thread's read?",
    modes: ["plain", "release-acquire", "volatile"],
    ops: [
      [
        { kind: "read", v: "x", reg: "r1" },
        { kind: "write", v: "y", value: 1 },
      ],
      [
        { kind: "read", v: "y", reg: "r2" },
        { kind: "write", v: "x", value: 1 },
      ],
    ],
    regs: ["r1", "r2"],
    relaxed: { r1: 1, r2: 1 },
    decl: {
      plain: "int x, y;",
      "release-acquire": "int x, y;   // accessed through VarHandles X and Y",
      volatile: "volatile int x, y;",
    },
    code: {
      plain: ["int r1 = x;\ny = 1;", "int r2 = y;\nx = 1;"],
      "release-acquire": ["int r1 = (int) X.getAcquire(this);\nY.setRelease(this, 1);", "int r2 = (int) Y.getAcquire(this);\nX.setRelease(this, 1);"],
      volatile: ["int r1 = x;\ny = 1;", "int r2 = y;\nx = 1;"],
    },
    verdict: {
      plain: {
        allowed: true,
        why: "The store doesn't depend on the load, so either may be performed first. Each read can then see the other thread's write.",
      },
      "release-acquire": {
        allowed: false,
        why: "Nothing after an acquire load may move before it, so each store happens after its own thread's load. Reading 1 in both threads would need each write to happen before the other: a cycle.",
      },
      volatile: {
        allowed: false,
        why: "Volatile accesses keep program order within the single total order, so no read can see a write that comes after it in that order.",
      },
    },
    hardware: {
      x86: "No: x86 never lets a store pass an earlier load.",
      arm: "Allowed by the architecture, but rarely seen in practice.",
    },
  },
  {
    id: "pub",
    name: "Publishing an object",
    short: "Pub",
    intro: "Thread 1 constructs an object (its constructor sets f = 42) and stores the reference. Thread 2 reads the reference and, if it isn't null, reads f. Can it see the object but f still 0?",
    modes: ["plain", "final", "release-acquire", "volatile"],
    ops: [
      [
        { kind: "write", v: "f", value: 42, label: "f = 42 (constructor)" },
        { kind: "write", v: "shared", value: 1, label: "shared = h" },
      ],
      [
        { kind: "read", v: "shared", reg: "r", label: "r = shared" },
        { kind: "read", v: "f", reg: "r.f", label: "read r.f" },
      ],
    ],
    regs: ["r", "r.f"],
    relaxed: { r: 1, "r.f": 0 },
    show: (reg, value, all) => (reg === "r" ? (value ? "the object" : "null") : all.r ? String(value) : "—"),
    decl: {
      plain: "class Holder { int f; Holder() { f = 42; } }\nHolder shared;",
      final: "class Holder { final int f; Holder() { f = 42; } }\nHolder shared;",
      "release-acquire": "class Holder { int f; Holder() { f = 42; } }\nHolder shared;   // accessed through VarHandle SHARED",
      volatile: "class Holder { int f; Holder() { f = 42; } }\nvolatile Holder shared;",
    },
    code: {
      plain: ["Holder h = new Holder();   // writes f = 42\nshared = h;", "Holder r = shared;\nif (r != null) use(r.f);"],
      final: ["Holder h = new Holder();   // writes f = 42\nshared = h;", "Holder r = shared;\nif (r != null) use(r.f);"],
      "release-acquire": ["Holder h = new Holder();   // writes f = 42\nSHARED.setRelease(this, h);", "Holder r = (Holder) SHARED.getAcquire(this);\nif (r != null) use(r.f);"],
      volatile: ["Holder h = new Holder();   // writes f = 42\nshared = h;", "Holder r = shared;\nif (r != null) use(r.f);"],
    },
    verdict: {
      plain: {
        allowed: true,
        why: "The constructor's write to f and the write of the reference are both plain, so the reference can become visible first. Thread 2 gets a non-null object whose f is still the default 0. This is how double-checked locking without volatile breaks.",
      },
      final: {
        allowed: false,
        why: "Final-field semantics: a thread that sees a reference to an object after its constructor finished sees the constructor's values of its final fields, as long as the constructor didn't let a reference to the object escape before it finished. No volatile is needed.",
      },
      "release-acquire": {
        allowed: false,
        why: "setRelease publishes the constructor's writes to a getAcquire that sees the reference.",
      },
      volatile: {
        allowed: false,
        why: "Safe publication: the constructor's writes come before the volatile write of shared, which happens-before the volatile read that sees it.",
      },
    },
    hardware: {
      x86: "No: x86 keeps the two stores in order. The JIT is still allowed to reorder them.",
      arm: "Yes, unless the JVM adds a barrier.",
    },
  },
];

export interface Interleaving {
  order: { thread: 0 | 1; op: Op }[];
  result: Record<string, number>;
}

/** Every sequentially consistent run: all orders that keep each thread's own order. */
export function interleavings(t: LitmusTest): Interleaving[] {
  const [a, b] = t.ops;
  const out: Interleaving[] = [];
  const go = (i: number, j: number, order: Interleaving["order"]) => {
    if (i === a.length && j === b.length) {
      const mem: Record<string, number> = {};
      const result: Record<string, number> = {};
      for (const { op } of order) {
        if (op.kind === "write") mem[op.v] = op.value!;
        else result[op.reg!] = mem[op.v] ?? 0;
      }
      out.push({ order, result });
      return;
    }
    if (i < a.length) go(i + 1, j, [...order, { thread: 0, op: a[i] }]);
    if (j < b.length) go(i, j + 1, [...order, { thread: 1, op: b[j] }]);
  };
  go(0, 0, []);
  return out;
}

/** Printed value of one register ("null", "—" where the test says so). */
export const shown = (t: LitmusTest, reg: string, all: Record<string, number>) => (t.show ? t.show(reg, all[reg], all) : String(all[reg]));

// outcomes that print the same are the same outcome (a null reference makes r.f irrelevant)
const key = (t: LitmusTest, r: Record<string, number>) => t.regs.map((g) => shown(t, g, r)).join(",");

export interface Outcome {
  result: Record<string, number>;
  runs: Interleaving[]; // interleavings producing it (empty for the relaxed outcome)
  relaxed: boolean;
}

/** The distinct outcomes: those some interleaving produces, plus the relaxed one. */
export function outcomes(t: LitmusTest): Outcome[] {
  const map = new Map<string, Outcome>();
  for (const run of interleavings(t)) {
    const k = key(t, run.result);
    if (!map.has(k)) map.set(k, { result: run.result, runs: [], relaxed: false });
    map.get(k)!.runs.push(run);
  }
  const rk = key(t, t.relaxed);
  if (!map.has(rk)) map.set(rk, { result: t.relaxed, runs: [], relaxed: true });
  return [...map.values()];
}

export const opText = (op: Op) => op.label ?? (op.kind === "write" ? `${op.v} = ${op.value}` : `${op.reg} = ${op.v}`);
