// Memory-hierarchy arithmetic for the Memory Hierarchy lab: average access
// time through cache levels, effective access time with a TLB, and TLB reach.
// Pure functions, checkable with tsx.

export interface Level {
  name: string;
  time: number; // ns to access this level
  hitRate: number; // local hit rate: of the accesses that reach this level, the fraction that hit (0–1)
}

/**
 * Average access time through the levels, with main memory last (it always hits):
 * T = t1 + m1 × (t2 + m2 × (… + memory)).
 */
export function amat(levels: Level[], memory: number): number {
  let t = memory;
  for (let i = levels.length - 1; i >= 0; i--) t = levels[i].time + (1 - levels[i].hitRate) * t;
  return t;
}

/** Fraction of all accesses that end up at each level (and at memory, last). */
export function reachShares(levels: Level[]): number[] {
  const out: number[] = [];
  let reaching = 1;
  for (const l of levels) {
    out.push(reaching * l.hitRate);
    reaching *= 1 - l.hitRate;
  }
  out.push(reaching);
  return out;
}

/**
 * Effective access time with a TLB, as in the TLB lesson:
 * EAT = h × (t + m) + (1 − h) × (t + k·m + m), k = page-table levels walked on a miss.
 */
export const eat = (h: number, t: number, m: number, k: number) => h * (t + m) + (1 - h) * (t + k * m + m);

/** Memory one TLB can map at once. */
export const tlbReach = (entries: number, pageSize: number) => entries * pageSize;

/**
 * Rough TLB miss rate for uniformly random accesses over a working set,
 * assuming the TLB always holds `entries` of its pages.
 */
export function randomMissRate(entries: number, pageSize: number, workingSet: number): number {
  const pages = Math.ceil(workingSet / pageSize);
  return pages <= entries ? 0 : 1 - entries / pages;
}

/** Bytes of last-level page-table entries (8 bytes each) to map a region. */
export const pteBytes = (region: number, pageSize: number) => Math.ceil(region / pageSize) * 8;
