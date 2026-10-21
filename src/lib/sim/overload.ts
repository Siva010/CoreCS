// A server under a traffic spike, for the Overload & Retries lab: a FIFO queue in
// front of `workers` workers, clients that time out and retry, and the defenses
// from the Overloaded Server lesson (a bounded queue that sheds load, a retry
// budget, and dropping requests whose client already gave up). Requests move in
// small cohorts (one per arrival tick), so a run is cheap. Pure functions,
// checkable with tsx.

export interface OverloadConfig {
  workers: number;
  serviceMs: number; // mean work per request
  baseRate: number; // new requests per second, outside the spike
  spikeRate: number; // new requests per second during the spike
  spikeStart: number; // s
  spikeEnd: number; // s
  duration: number; // s
  timeoutMs: number; // the client gives up after this long
  maxAttempts: number; // 1 = no retries
  backoffMs: number; // wait before a retry
  retryBudget: number | null; // retries allowed per first attempt (0.1 = 10%), null = unlimited
  queueLimit: number | null; // requests allowed to wait, null = unbounded
  dropExpired: boolean; // skip queued requests whose client has already given up
}

export interface Second {
  t: number; // start of this second
  fresh: number; // first attempts arriving
  retries: number; // retries arriving
  ok: number; // completed while the client was still waiting
  wasted: number; // completed after the client gave up
  rejected: number; // refused at once because the queue was full
  dropped: number; // removed from the queue unserved (client gone)
  queue: number; // requests waiting at the end of the second
  waitMs: number; // mean time the requests served in this second had waited (0 if none were served)
}

export interface OverloadResult {
  seconds: Second[];
  capacity: number; // requests per second the workers can complete
  totals: { fresh: number; retries: number; ok: number; wasted: number; rejected: number; failed: number };
  successRate: number; // ok / fresh
  recoveredAt: number | null; // first second after the spike from which goodput stays at ≥ 95% of the base rate
}

interface Cohort {
  count: number;
  arrivedAt: number;
  attempt: number;
  givenUp: boolean;
}

const DT = 0.05; // s per tick

export function simulateOverload(cfg: OverloadConfig): OverloadResult {
  const capacity = (cfg.workers * 1000) / cfg.serviceMs;
  const timeout = cfg.timeoutMs / 1000;
  const backoff = cfg.backoffMs / 1000;
  const queue: Cohort[] = [];
  const pending: { at: number; count: number; attempt: number }[] = []; // retries waiting for their backoff
  let tokens = 0;
  const tokenCap = cfg.retryBudget === null ? 0 : Math.max(10, cfg.retryBudget * cfg.baseRate * 10);
  const seconds: Second[] = [];
  const totals = { fresh: 0, retries: 0, ok: 0, wasted: 0, rejected: 0, failed: 0 };
  let cur: Second | null = null;
  let queued = 0;
  let servedAge = 0; // request-seconds waited by what was served in the current second
  let served = 0;

  // A client whose attempt failed (timed out or was refused) may try again.
  const retryOrFail = (t: number, count: number, attempt: number) => {
    if (count <= 0) return;
    let allowed = attempt < cfg.maxAttempts ? count : 0;
    if (allowed > 0 && cfg.retryBudget !== null) {
      allowed = Math.min(allowed, tokens);
      tokens -= allowed;
    }
    if (allowed > 0) pending.push({ at: t + backoff, count: allowed, attempt: attempt + 1 });
    totals.failed += count - allowed;
  };

  const ticks = Math.round(cfg.duration / DT);
  for (let i = 0; i < ticks; i++) {
    const t = i * DT;
    const sec = Math.floor(t + 1e-9);
    if (!cur || cur.t !== sec) {
      cur = { t: sec, fresh: 0, retries: 0, ok: 0, wasted: 0, rejected: 0, dropped: 0, queue: 0, waitMs: 0 };
      seconds.push(cur);
      servedAge = 0;
      served = 0;
    }
    // 1. arrivals: new requests, plus retries whose backoff has passed
    const rate = t >= cfg.spikeStart && t < cfg.spikeEnd ? cfg.spikeRate : cfg.baseRate;
    const fresh = rate * DT;
    if (cfg.retryBudget !== null) tokens = Math.min(tokenCap, tokens + fresh * cfg.retryBudget);
    const arriving: { count: number; attempt: number }[] = [{ count: fresh, attempt: 1 }];
    for (let k = pending.length - 1; k >= 0; k--)
      if (pending[k].at <= t + 1e-9) {
        arriving.push({ count: pending[k].count, attempt: pending[k].attempt });
        cur.retries += pending[k].count;
        totals.retries += pending[k].count;
        pending.splice(k, 1);
      }
    cur.fresh += fresh;
    totals.fresh += fresh;
    // 2. admission: a bounded queue refuses what doesn't fit
    for (const a of arriving) {
      let admit = a.count;
      if (cfg.queueLimit !== null) admit = Math.max(0, Math.min(a.count, cfg.queueLimit - queued));
      const refused = a.count - admit;
      if (refused > 0) {
        cur.rejected += refused;
        totals.rejected += refused;
        retryOrFail(t, refused, a.attempt);
      }
      if (admit > 0) {
        queue.push({ count: admit, arrivedAt: t, attempt: a.attempt, givenUp: false });
        queued += admit;
      }
    }
    // 3. clients whose wait passed the timeout give up (and maybe retry)
    for (let k = 0; k < queue.length; k++) {
      const c = queue[k];
      if (c.givenUp || t - c.arrivedAt < timeout) continue;
      c.givenUp = true;
      retryOrFail(t, c.count, c.attempt);
      if (cfg.dropExpired) {
        cur.dropped += c.count;
        queued -= c.count;
        c.count = 0;
      }
    }
    // 4. the workers serve the head of the queue
    let budget = capacity * DT;
    while (budget > 1e-9 && queue.length) {
      const c = queue[0];
      const k = Math.min(c.count, budget);
      servedAge += k * (t - c.arrivedAt);
      served += k;
      if (c.givenUp) {
        cur.wasted += k;
        totals.wasted += k;
      } else {
        cur.ok += k;
        totals.ok += k;
      }
      c.count -= k;
      queued -= k;
      budget -= k;
      if (c.count <= 1e-9) queue.shift();
    }
    while (queue.length && queue[0].count <= 1e-9) queue.shift();
    cur.queue = Math.max(0, queued);
    cur.waitMs = served > 1e-9 ? (servedAge / served) * 1000 : 0;
  }
  // in-flight work at the end is neither a success nor a failure; leave it out of the rate
  let recoveredAt: number | null = null;
  for (let s = Math.ceil(cfg.spikeEnd); s < seconds.length; s++) {
    if (seconds.slice(s).every((x) => x.ok >= 0.95 * cfg.baseRate)) {
      recoveredAt = s;
      break;
    }
  }
  return { seconds, capacity, totals, successRate: totals.fresh ? totals.ok / totals.fresh : 1, recoveredAt };
}

export const BASE_CONFIG: OverloadConfig = {
  workers: 10,
  serviceMs: 20,
  baseRate: 400,
  spikeRate: 800,
  spikeStart: 10,
  spikeEnd: 20,
  duration: 90,
  timeoutMs: 1000,
  maxAttempts: 3,
  backoffMs: 200,
  retryBudget: null,
  queueLimit: null,
  dropExpired: false,
};
