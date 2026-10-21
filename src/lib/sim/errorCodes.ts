// Error detection and correction for the Error Detection lab: parity, CRC by
// XOR long division (with the steps), Hamming codes for any number of data
// bits, and the Internet checksum. Pure functions, checkable with tsx.

export const isBits = (s: string) => /^[01]+$/.test(s);

export function parityBit(bits: string, even = true): "0" | "1" {
  const ones = [...bits].filter((b) => b === "1").length;
  return (ones % 2 === 0) === even ? "0" : "1";
}

export interface CrcStep {
  pos: number; // index in the dividend where the generator is aligned
  before: string; // the working bits before this XOR
  after: string; // after XOR-ing the generator in
}

/** XOR long division of `bits` by `gen`; returns every step and the remainder (last gen.length − 1 bits). */
export function crcDivide(bits: string, gen: string): { steps: CrcStep[]; remainder: string } {
  const g = [...gen].map(Number);
  const w = [...bits].map(Number);
  const steps: CrcStep[] = [];
  for (let i = 0; i + g.length <= w.length; i++) {
    if (w[i] !== 1) continue;
    const before = w.join("");
    for (let j = 0; j < g.length; j++) w[i + j] ^= g[j];
    steps.push({ pos: i, before, after: w.join("") });
  }
  return { steps, remainder: w.slice(w.length - (g.length - 1)).join("") };
}

/** The CRC to append to `data`: the remainder of data + r zeros. */
export const crcOf = (data: string, gen: string) => crcDivide(data + "0".repeat(gen.length - 1), gen).remainder;

const isPow2 = (n: number) => (n & (n - 1)) === 0;

/** Check bits needed for m data bits: smallest r with 2^r ≥ m + r + 1. */
export function checkBitsFor(m: number): number {
  let r = 0;
  while (2 ** r < m + r + 1) r++;
  return r;
}

export interface HammingCode {
  code: string; // positions 1..n, left to right
  checkPositions: number[];
  coverage: Record<number, number[]>; // check position → positions it covers
}

/** Hamming code with even parity: check bits at positions 1, 2, 4, …; data bits fill the rest in order. */
export function hammingEncode(data: string): HammingCode {
  const m = data.length;
  const r = checkBitsFor(m);
  const n = m + r;
  const bits: number[] = new Array(n + 1).fill(0);
  let k = 0;
  for (let pos = 1; pos <= n; pos++) if (!isPow2(pos)) bits[pos] = Number(data[k++]);
  const checkPositions: number[] = [];
  const coverage: Record<number, number[]> = {};
  for (let p = 1; p <= n; p <<= 1) {
    checkPositions.push(p);
    coverage[p] = [];
    let sum = 0;
    for (let pos = 1; pos <= n; pos++) {
      if (pos & p) {
        coverage[p].push(pos);
        if (pos !== p) sum ^= bits[pos];
      }
    }
    bits[p] = sum;
  }
  return { code: bits.slice(1).join(""), checkPositions, coverage };
}

/** Recheck each parity group; the failing check positions add up to the flipped bit's position (0 = no error). */
export function hammingSyndrome(code: string): { syndrome: number; failing: number[] } {
  const n = code.length;
  const bits = [0, ...[...code].map(Number)];
  const failing: number[] = [];
  for (let p = 1; p <= n; p <<= 1) {
    let sum = 0;
    for (let pos = 1; pos <= n; pos++) if (pos & p) sum ^= bits[pos];
    if (sum) failing.push(p);
  }
  return { syndrome: failing.reduce((a, b) => a + b, 0), failing };
}

/** Data bits back out of a Hamming codeword. */
export const hammingData = (code: string) => [...code].filter((_, i) => !isPow2(i + 1)).join("");

export interface ChecksumStep {
  word: number;
  sum: number; // running one's-complement sum after this word
  carried: boolean; // whether an end-around carry happened
}

/** 16-bit one's-complement sum of the words, with each step; the checksum is its complement. */
export function internetChecksum(words: number[]): { steps: ChecksumStep[]; sum: number; checksum: number } {
  let sum = 0;
  const steps: ChecksumStep[] = [];
  for (const w of words) {
    sum += w;
    const carried = sum > 0xffff;
    sum = (sum & 0xffff) + (sum >>> 16);
    steps.push({ word: w, sum, carried });
  }
  return { steps, sum, checksum: ~sum & 0xffff };
}

export const flip = (bits: string, i: number) => bits.slice(0, i) + (bits[i] === "1" ? "0" : "1") + bits.slice(i + 1);
export const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");
