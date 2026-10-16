// File allocation: the Unix inode's multi-level block pointers, and the four
// classic ways to lay a file out on disk (contiguous, linked, FAT, indexed).
// Pure functions, shared by the File Allocation lab and checkable with tsx.

export interface Geometry {
  blockSize: number; // bytes
  ptrSize: number; // bytes per block address
  direct: number; // direct pointers in the inode
  single: number; // single-indirect pointers
  double: number; // double-indirect pointers
  triple: number; // triple-indirect pointers
}

export type LevelName = "direct" | "single" | "double" | "triple";

export interface Level {
  name: LevelName;
  pointers: number; // how many inode pointers of this kind
  blocks: number; // data blocks reachable through them
  firstBlock: number; // first logical block number they cover
  reads: number; // disk reads to reach a data block this way (inode in memory)
}

/** Block addresses that fit in one index block. */
export const perBlock = (g: Geometry) => Math.floor(g.blockSize / g.ptrSize);

export function levels(g: Geometry): Level[] {
  const p = perBlock(g);
  const spec: [LevelName, number, number, number][] = [
    ["direct", g.direct, 1, 1],
    ["single", g.single, p, 2],
    ["double", g.double, p * p, 3],
    ["triple", g.triple, p * p * p, 4],
  ];
  let first = 0;
  return spec.map(([name, pointers, each, reads]) => {
    const lv = { name, pointers, blocks: pointers * each, firstBlock: first, reads };
    first += lv.blocks;
    return lv;
  });
}

export const maxBlocks = (g: Geometry) => levels(g).reduce((n, l) => n + l.blocks, 0);
export const maxFileSize = (g: Geometry) => maxBlocks(g) * g.blockSize;

export interface Location {
  lbn: number; // logical block number inside the file
  within: number; // byte offset inside that block
  level: LevelName;
  pointer: number; // which inode pointer of that kind (0-based)
  path: number[]; // entry used in each index block, top level first
  reads: number; // index blocks + the data block (inode already in memory)
}

/** Where byte `offset` of a file lives, or null if it is past the largest possible file. */
export function locate(g: Geometry, offset: number): Location | null {
  if (!Number.isFinite(offset) || offset < 0) return null;
  const p = perBlock(g);
  const lbn = Math.floor(offset / g.blockSize);
  const within = offset % g.blockSize;
  for (const lv of levels(g)) {
    if (lv.pointers === 0 || lbn >= lv.firstBlock + lv.blocks) continue;
    const rel = lbn - lv.firstBlock;
    const each = lv.blocks / lv.pointers; // data blocks under one pointer
    const pointer = Math.floor(rel / each);
    const r = rel % each;
    const path = lv.name === "direct" ? [] : lv.name === "single" ? [r] : lv.name === "double" ? [Math.floor(r / p), r % p] : [Math.floor(r / (p * p)), Math.floor(r / p) % p, r % p];
    return { lbn, within, level: lv.name, pointer, path, reads: lv.reads };
  }
  return null;
}

export interface IndexCount {
  dataBlocks: number;
  indexBlocks: number;
  fits: boolean;
}

/** Data blocks and index (indirect) blocks a file of `size` bytes needs. */
export function indexBlocks(g: Geometry, size: number): IndexCount {
  const p = perBlock(g);
  const dataBlocks = Math.ceil(Math.max(0, size) / g.blockSize);
  let rest = Math.max(0, dataBlocks - g.direct);
  let idx = 0;
  for (let i = 0; i < g.single && rest > 0; i++) {
    const m = Math.min(rest, p);
    idx += 1;
    rest -= m;
  }
  for (let i = 0; i < g.double && rest > 0; i++) {
    const m = Math.min(rest, p * p);
    idx += 1 + Math.ceil(m / p);
    rest -= m;
  }
  for (let i = 0; i < g.triple && rest > 0; i++) {
    const m = Math.min(rest, p * p * p);
    idx += 1 + Math.ceil(m / (p * p)) + Math.ceil(m / p);
    rest -= m;
  }
  return { dataBlocks, indexBlocks: idx, fits: rest === 0 };
}

/** "4 KB", "4 MB", "1.5 GB": binary units, as in the lesson's tables. */
export function fmtBytes(n: number): string {
  const units = ["bytes", "KB", "MB", "GB", "TB", "PB", "EB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const s = i === 0 ? String(v) : v >= 100 || Number.isInteger(v) ? String(Math.round(v * 10) / 10) : v.toFixed(2).replace(/\.?0+$/, "");
  return `${s} ${units[i]}`;
}

/** Parses "50000", "5M", "1.5 GB", "4k" (binary units). Returns NaN if it can't. */
export function parseBytes(text: string): number {
  const m = text.trim().match(/^(\d+(?:\.\d+)?)\s*([kmgtp]?)(?:i?b)?$/i);
  if (!m) return NaN;
  const pow = { "": 0, k: 1, m: 2, g: 3, t: 4, p: 5 }[m[2].toLowerCase() as "" | "k" | "m" | "g" | "t" | "p"];
  return Math.floor(Number(m[1]) * 1024 ** pow);
}

// ── Allocation methods on a small disk ──────────────────────────────────────

export type Method = "contiguous" | "linked" | "fat" | "indexed";

export const DISK_BLOCKS = 32;

/** Other files already on the disk; every other block is free. Free space is fragmented on purpose. */
export const USED: Record<number, string> = {
  0: "meta",
  1: "meta",
  5: "A",
  6: "A",
  9: "B",
  10: "B",
  15: "C",
  16: "C",
  18: "D",
  19: "D",
  23: "E",
  24: "E",
  25: "E",
  28: "F",
  29: "F",
  31: "G",
};

export const FREE = Array.from({ length: DISK_BLOCKS }, (_, b) => b).filter((b) => !(b in USED));

export interface Allocation {
  ok: boolean;
  blocks: number[]; // the file's data blocks, in file order
  index?: number; // indexed allocation: the index block
  reason?: string;
}

export function allocate(method: Method, n: number): Allocation {
  if (method === "contiguous") {
    // first fit: the first run of n consecutive free blocks
    for (let start = 0; start + n <= DISK_BLOCKS; start++) {
      let fits = true;
      for (let b = start; b < start + n; b++) if (b in USED) fits = false;
      if (fits) return { ok: true, blocks: Array.from({ length: n }, (_, i) => start + i) };
    }
    return { ok: false, blocks: [], reason: `No run of ${n} consecutive free blocks, although ${FREE.length} blocks are free: external fragmentation.` };
  }
  if (method === "indexed") {
    if (n + 1 > FREE.length) return { ok: false, blocks: [], reason: "Not enough free blocks for the data plus the index block." };
    return { ok: true, index: FREE[0], blocks: FREE.slice(1, n + 1) };
  }
  if (n > FREE.length) return { ok: false, blocks: [], reason: "Not enough free blocks." };
  return { ok: true, blocks: FREE.slice(0, n) };
}

export interface ReadCost {
  diskReads: number[]; // disk blocks read, in order
  memorySteps: number; // FAT entries followed in memory
}

/** Disk reads to read block k of the file. The directory entry is already in memory. */
export function readBlock(method: Method, a: Allocation, k: number, cached: boolean): ReadCost {
  if (!a.ok || k < 0 || k >= a.blocks.length) return { diskReads: [], memorySteps: 0 };
  switch (method) {
    case "contiguous":
      return { diskReads: [a.blocks[k]], memorySteps: 0 };
    case "linked":
      // the address of block k is stored inside block k-1: walk the chain from the start
      return { diskReads: a.blocks.slice(0, k + 1), memorySteps: 0 };
    case "fat":
      // the chain lives in the table; with the table cached, walking it costs no disk reads
      return { diskReads: cached ? [a.blocks[k]] : [0, a.blocks[k]], memorySteps: k };
    case "indexed":
      return { diskReads: cached ? [a.blocks[k]] : [a.index!, a.blocks[k]], memorySteps: 0 };
  }
}
