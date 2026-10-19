// A MESI cache-coherence simulator for the false-sharing lab: two or more
// cores, two variables (a, b) that either share one 64-byte line or are padded
// onto separate lines, and a sequence of reads and writes. Snooping MESI as in
// the CPU caches lesson. Pure functions, checkable with tsx.

export type State = "M" | "E" | "S" | "I";
export type Var = "a" | "b";

export interface Access {
  core: number;
  op: "read" | "write";
  v: Var;
}

export type Event = "hit" | "silent-upgrade" | "miss-memory" | "miss-from-cache" | "upgrade" | "rfo";

export interface StepResult {
  access: Access;
  line: number;
  event: Event;
  invalidated: number[]; // cores whose copy was invalidated
  supplier: number | null; // core that supplied the data (cache-to-cache)
  states: State[][]; // after the step: states[line][core]
  text: string;
}

export interface Totals {
  hits: number;
  misses: number;
  invalidations: number;
  transfers: number; // cache-to-cache transfers of a modified/exclusive line
}

export const lineOf = (v: Var, padded: boolean) => (padded && v === "b" ? 1 : 0);

/** Runs the accesses and returns the state after each one. */
export function simulate(accesses: Access[], cores: number, padded: boolean): { steps: StepResult[]; totals: Totals } {
  const lines = padded ? 2 : 1;
  const st: State[][] = Array.from({ length: lines }, () => Array<State>(cores).fill("I"));
  const totals: Totals = { hits: 0, misses: 0, invalidations: 0, transfers: 0 };
  const steps: StepResult[] = [];
  for (const access of accesses) {
    const { core, op, v } = access;
    const line = lineOf(v, padded);
    const row = st[line];
    const mine = row[core];
    const others = row.map((s, i) => ({ s, i })).filter(({ i }) => i !== core);
    const owner = others.find(({ s }) => s === "M" || s === "E");
    let event: Event;
    let supplier: number | null = null;
    let invalidated: number[] = [];
    if (op === "read") {
      if (mine !== "I") {
        event = "hit";
        totals.hits++;
      } else {
        totals.misses++;
        if (owner) {
          // the owner supplies the line (writing it back if dirty) and both end Shared
          event = "miss-from-cache";
          supplier = owner.i;
          totals.transfers++;
          row[owner.i] = "S";
          row[core] = "S";
        } else if (others.some(({ s }) => s === "S")) {
          event = "miss-memory";
          row[core] = "S";
        } else {
          event = "miss-memory";
          row[core] = "E";
        }
      }
    } else {
      if (mine === "M") {
        event = "hit";
        totals.hits++;
      } else if (mine === "E") {
        event = "silent-upgrade";
        totals.hits++;
        row[core] = "M";
      } else {
        invalidated = others.filter(({ s }) => s !== "I").map(({ i }) => i);
        if (mine === "S") {
          event = "upgrade";
          totals.hits++;
        } else {
          event = "rfo";
          totals.misses++;
          if (owner) {
            supplier = owner.i;
            totals.transfers++;
          }
        }
        for (const i of invalidated) row[i] = "I";
        totals.invalidations += invalidated.length;
        row[core] = "M";
      }
    }
    steps.push({ access, line, event, invalidated, supplier, states: st.map((r) => [...r]), text: describe(access, line, event, invalidated, supplier, lines) });
  }
  return { steps, totals };
}

function describe(a: Access, line: number, event: Event, inv: number[], supplier: number | null, lines: number): string {
  const L = lines > 1 ? `line ${line}` : "the line";
  const invText = inv.length ? `; invalidates core ${inv.join(" and core ")}` : "";
  switch (event) {
    case "hit":
      return `Hit: core ${a.core} already holds ${L} in a state that allows a ${a.op}.`;
    case "silent-upgrade":
      return `Core ${a.core} holds ${L} Exclusive, so it writes without telling anyone (E → M).`;
    case "miss-memory":
      return `Miss: core ${a.core} fetches ${L} from memory.`;
    case "miss-from-cache":
      return `Miss: core ${supplier} has ${L} and supplies it; both copies become Shared.`;
    case "upgrade":
      return `Core ${a.core} holds ${L} Shared and must invalidate the other copies before writing${invText}.`;
    case "rfo":
      return `Miss: core ${a.core} sends a read-for-ownership for ${L}${supplier !== null ? `, core ${supplier} supplies it` : ""}${invText}.`;
  }
}

/** n rounds of: core 0 accesses a, core 1 accesses b. */
export function alternate(n: number, op: "read" | "write" = "write"): Access[] {
  const out: Access[] = [];
  for (let i = 0; i < n; i++) out.push({ core: 0, op, v: "a" }, { core: 1, op, v: "b" });
  return out;
}
