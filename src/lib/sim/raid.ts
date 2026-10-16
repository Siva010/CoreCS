// RAID layouts with real parity values: stripe maps for RAID 0/1/5/6/10, XOR
// parity (P), Reed–Solomon Q over GF(2^8) as in Linux md, which failures an
// array survives, how a lost block is rebuilt, and the small-write cost.
// Pure functions, shared by the RAID lab and checkable with tsx.

export type RaidLevel = "0" | "1" | "5" | "6" | "10";

export type CellKind = "data" | "p" | "q" | "mirror";

export interface Cell {
  kind: CellKind;
  block: number; // data block number (for P/Q: the stripe number)
  value: number; // one byte stands in for the whole block
}

export interface Layout {
  level: RaidLevel;
  disks: number;
  rows: Cell[][]; // rows[stripe][disk]
}

export const MIN_DISKS: Record<RaidLevel, number> = { "0": 2, "1": 2, "5": 3, "6": 4, "10": 4 };

/** Data disks' worth of capacity. */
export function dataDisks(level: RaidLevel, n: number) {
  return { "0": n, "1": 1, "5": n - 1, "6": n - 2, "10": n / 2 }[level];
}

/** Disk I/Os for one small random write (read-modify-write for parity levels). */
export function writePenalty(level: RaidLevel, n: number) {
  return { "0": 1, "1": n, "5": 4, "6": 6, "10": 2 }[level];
}

/** Starting byte for data block b: arbitrary but fixed, so examples are repeatable. */
export const initialValue = (b: number) => ((b * 73 + 41) ^ 0x5a) & 0xff;

// GF(2^8) with the polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d), generator 2: the field Linux RAID 6 uses.
export function gfMul(a: number, b: number) {
  let r = 0;
  while (b) {
    if (b & 1) r ^= a;
    a <<= 1;
    if (a & 0x100) a ^= 0x11d;
    b >>= 1;
  }
  return r;
}
export function gfPow2(i: number) {
  let r = 1;
  for (let k = 0; k < i; k++) r = gfMul(r, 2);
  return r;
}

export const xorAll = (xs: number[]) => xs.reduce((a, b) => a ^ b, 0);
/** Q = g^0·D0 ⊕ g^1·D1 ⊕ … over the data blocks of one stripe, in stripe order. */
export const qOf = (xs: number[]) => xs.reduce((q, d, i) => q ^ gfMul(gfPow2(i), d), 0);

/**
 * Builds the stripe map. RAID 5 uses the left-symmetric layout (Linux md's default): parity
 * moves one disk left each stripe and the data continues on the disk after it. RAID 6 puts Q
 * right after P. `values` overrides the byte stored in a data block.
 */
export function layout(level: RaidLevel, n: number, stripes: number, values: Record<number, number> = {}): Layout {
  const val = (b: number) => values[b] ?? initialValue(b);
  const rows: Cell[][] = [];
  let next = 0;
  for (let s = 0; s < stripes; s++) {
    const row: Cell[] = new Array(n);
    if (level === "0") {
      for (let d = 0; d < n; d++, next++) row[d] = { kind: "data", block: next, value: val(next) };
    } else if (level === "1") {
      for (let d = 0; d < n; d++) row[d] = { kind: d === 0 ? "data" : "mirror", block: next, value: val(next) };
      next++;
    } else if (level === "10") {
      for (let pair = 0; pair < n / 2; pair++, next++) {
        row[2 * pair] = { kind: "data", block: next, value: val(next) };
        row[2 * pair + 1] = { kind: "mirror", block: next, value: val(next) };
      }
    } else {
      const parity = n - 1 - (s % n);
      const extra = level === "6" ? 2 : 1;
      const data: number[] = [];
      for (let k = 0; k < n - extra; k++, next++) {
        const d = (parity + extra + k) % n;
        row[d] = { kind: "data", block: next, value: val(next) };
        data.push(val(next));
      }
      row[parity] = { kind: "p", block: s, value: xorAll(data) };
      if (level === "6") row[(parity + 1) % n] = { kind: "q", block: s, value: qOf(data) };
    }
    rows.push(row);
  }
  return { level, disks: n, rows };
}

/** Does the array still hold all its data with these disks failed? */
export function survives(level: RaidLevel, n: number, failed: Set<number>): boolean {
  const f = failed.size;
  if (level === "0") return f === 0;
  if (level === "1") return f < n;
  if (level === "5") return f <= 1;
  if (level === "6") return f <= 2;
  for (let pair = 0; pair < n / 2; pair++) if (failed.has(2 * pair) && failed.has(2 * pair + 1)) return false;
  return true;
}

export const hex = (v: number) => "0x" + v.toString(16).toUpperCase().padStart(2, "0");

export interface Recovery {
  disk: number;
  cell: Cell;
  value: number | null; // null: lost for good
  how: string;
}

/** How each block on a failed disk in one stripe is rebuilt (or why it can't be). */
export function recoverStripe(lay: Layout, s: number, failed: Set<number>): Recovery[] {
  const row = lay.rows[s];
  const lostDisks = [...failed].filter((d) => d < lay.disks).sort((a, b) => a - b);
  const ok = survives(lay.level, lay.disks, failed);
  const name = (c: Cell) => (c.kind === "p" ? `P${c.block}` : c.kind === "q" ? `Q${c.block}` : `D${c.block}`);
  return lostDisks.map((d) => {
    const cell = row[d];
    if (!ok) return { disk: d, cell, value: null, how: "Lost: too many disks failed for this level." };
    if (lay.level === "1" || lay.level === "10") {
      const copy = row.findIndex((c, i) => i !== d && !failed.has(i) && c.block === cell.block);
      return { disk: d, cell, value: cell.value, how: `Read the mirror copy on disk ${copy}.` };
    }
    if (lay.level === "5") {
      const others = row.map((c, i) => ({ c, i })).filter(({ i }) => i !== d);
      const v = xorAll(others.map(({ c }) => c.value));
      return {
        disk: d,
        cell,
        value: v,
        how: `${name(cell)} = ${others.map(({ c }) => name(c)).join(" ⊕ ")} = ${others.map(({ c }) => hex(c.value)).join(" ⊕ ")} = ${hex(v)}`,
      };
    }
    // RAID 6: solve for the missing blocks from the surviving data, P and Q
    const v = solveRaid6(row, failed)[d];
    return { disk: d, cell, value: v, how: `${name(cell)} = ${hex(v)}: ${raid6How(row, failed, d)}` };
  });
}

function raid6How(row: Cell[], failed: Set<number>, d: number): string {
  const lost = row.filter((_, i) => failed.has(i));
  const lostData = lost.filter((c) => c.kind === "data").length;
  const cell = row[d];
  if (cell.kind === "p" && lostData === 0) return "Recompute P from the data (XOR).";
  if (cell.kind === "q" && lostData === 0) return "Recompute Q from the data (Galois-field sum).";
  if (cell.kind === "data" && lostData === 1 && !lost.some((c) => c.kind === "p")) return "Rebuild from P with XOR, exactly as in RAID 5.";
  if (cell.kind === "data" && lostData === 1) return "P is gone too, so rebuild from Q (one Galois-field equation, one unknown).";
  if (cell.kind === "data") return "Two data blocks lost: solve the P and Q equations together (two equations, two unknowns).";
  return `Recompute ${cell.kind === "p" ? "P" : "Q"} once the lost data is rebuilt.`;
}

/** Brute-force solve of up to two lost data bytes from P and Q: tiny, and obviously correct. */
function solveRaid6(row: Cell[], failed: Set<number>): Record<number, number> {
  // in block order, the order Q's coefficients g^0, g^1, … follow
  const dataIdx = row
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.kind === "data")
    .sort((x, y) => x.c.block - y.c.block);
  const pCell = row.findIndex((c) => c.kind === "p");
  const qCell = row.findIndex((c) => c.kind === "q");
  const unknown = dataIdx.filter(({ i }) => failed.has(i)).map(({ i }) => i);
  const out: Record<number, number> = {};
  const tryValues = (vals: number[]) => {
    const data = dataIdx.map(({ c, i }) => (unknown.includes(i) ? vals[unknown.indexOf(i)] : c.value));
    const pOk = failed.has(pCell) || xorAll(data) === row[pCell].value;
    const qOk = failed.has(qCell) || qOf(data) === row[qCell].value;
    return pOk && qOk ? data : null;
  };
  let data: number[] | null = null;
  if (unknown.length === 0) data = dataIdx.map(({ c }) => c.value);
  else if (unknown.length === 1) for (let a = 0; a < 256 && !data; a++) data = tryValues([a]);
  else for (let a = 0; a < 256 && !data; a++) for (let b = 0; b < 256 && !data; b++) data = tryValues([a, b]);
  if (!data) return out;
  dataIdx.forEach(({ i }, k) => (out[i] = data![k]));
  out[pCell] = xorAll(data);
  out[qCell] = qOf(data);
  return out;
}

export interface WriteStep {
  op: "read" | "write" | "compute";
  disk?: number;
  text: string;
}

/** The I/Os for overwriting data block `block` with `next` (a small, read-modify-write update). */
export function smallWrite(lay: Layout, block: number, next: number): WriteStep[] {
  for (let s = 0; s < lay.rows.length; s++) {
    const row = lay.rows[s];
    const d = row.findIndex((c) => c.kind === "data" && c.block === block);
    if (d < 0) continue;
    const old = row[d].value;
    const L = lay.level;
    if (L === "0") return [{ op: "write", disk: d, text: `write D${block} = ${hex(next)}` }];
    if (L === "1" || L === "10") {
      return row.flatMap((c, i) => (c.block === block ? [{ op: "write" as const, disk: i, text: `write D${block} = ${hex(next)} (${c.kind === "data" ? "primary" : "mirror"})` }] : []));
    }
    const p = row.findIndex((c) => c.kind === "p");
    const delta = old ^ next;
    const newP = row[p].value ^ delta;
    const steps: WriteStep[] = [
      { op: "read", disk: d, text: `read old D${block} = ${hex(old)}` },
      { op: "read", disk: p, text: `read old P${s} = ${hex(row[p].value)}` },
    ];
    if (L === "6") {
      const q = row.findIndex((c) => c.kind === "q");
      const pos = dataOrder(lay, s).indexOf(d); // Q's coefficient for this block is g^pos
      const newQ = row[q].value ^ gfMul(gfPow2(pos), delta);
      steps.push({ op: "read", disk: q, text: `read old Q${s} = ${hex(row[q].value)}` });
      steps.push({ op: "compute", text: `P′ = ${hex(row[p].value)} ⊕ ${hex(old)} ⊕ ${hex(next)} = ${hex(newP)};  Q′ = Q ⊕ g^${pos}·(old ⊕ new) = ${hex(newQ)}` });
      steps.push({ op: "write", disk: d, text: `write D${block} = ${hex(next)}` }, { op: "write", disk: p, text: `write P${s} = ${hex(newP)}` }, { op: "write", disk: q, text: `write Q${s} = ${hex(newQ)}` });
      return steps;
    }
    steps.push({ op: "compute", text: `P′ = old P ⊕ old D ⊕ new D = ${hex(row[p].value)} ⊕ ${hex(old)} ⊕ ${hex(next)} = ${hex(newP)}` });
    steps.push({ op: "write", disk: d, text: `write D${block} = ${hex(next)}` }, { op: "write", disk: p, text: `write P${s} = ${hex(newP)}` });
    return steps;
  }
  return [];
}

/** Disks holding the stripe's data blocks, in the order Q's coefficients use. */
function dataOrder(lay: Layout, s: number): number[] {
  return lay.rows[s]
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.kind === "data")
    .sort((a, b) => a.c.block - b.c.block)
    .map(({ i }) => i);
}
