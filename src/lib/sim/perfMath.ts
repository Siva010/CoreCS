// Speedup and queueing formulas used by the Speedup & Queueing lab:
// Amdahl, Gustafson, the Universal Scalability Law, Little's law, and the
// M/M/1 and M/M/c (Erlang C) queues. Pure functions, checkable with tsx.

/** Amdahl: fixed problem size, fraction p parallelizable, n processors. */
export const amdahl = (p: number, n: number) => 1 / (1 - p + p / n);

/** Gustafson: scaled speedup when the parallel work grows with n. */
export const gustafson = (p: number, n: number) => n - (1 - p) * (n - 1);

/** Universal Scalability Law: relative throughput with contention alpha and coherence beta. */
export const usl = (alpha: number, beta: number, n: number) => n / (1 + alpha * (n - 1) + beta * n * (n - 1));

/** Where USL throughput peaks (Infinity when beta = 0). */
export const uslPeak = (alpha: number, beta: number) => (beta > 0 ? Math.sqrt((1 - alpha) / beta) : Infinity);

export interface QueueResult {
  stable: boolean;
  rho: number; // utilization per server
  offered: number; // A = λS, busy servers on average (Erlangs)
  waitProb: number; // probability an arrival has to queue
  wq: number; // mean time in queue (same unit as s)
  w: number; // mean time in system
  lq: number; // mean number waiting
  l: number; // mean number in system
}

/**
 * M/M/c queue: Poisson arrivals at rate lambda, exponential service with mean s,
 * c identical servers. With c = 1 this is M/M/1: W = S / (1 − ρ).
 */
export function mmc(lambda: number, s: number, c: number): QueueResult {
  const offered = lambda * s;
  const rho = offered / c;
  if (rho >= 1) return { stable: false, rho, offered, waitProb: 1, wq: Infinity, w: Infinity, lq: Infinity, l: Infinity };
  // Erlang C, computed with a running term to avoid huge factorials
  let term = 1; // A^k / k!
  let sum = 1; // Σ_{k<c} A^k / k!
  for (let k = 1; k < c; k++) {
    term *= offered / k;
    sum += term;
  }
  const last = (term * offered) / c; // A^c / c!
  const tail = last / (1 - rho);
  const waitProb = tail / (sum + tail);
  const wq = (waitProb * s) / (c - offered);
  const w = wq + s;
  return { stable: true, rho, offered, waitProb, wq, w, lq: lambda * wq, l: lambda * w };
}
