// Stop-and-wait, Go-Back-N and Selective Repeat on one link, for the ARQ lab.
// Time is measured in frame transmission times: sending a frame takes 1 unit,
// the signal takes `a` units each way, ACKs are tiny. A frame listed in
// `lostFirst` loses its first transmission only. Pure functions, checkable with tsx.

export type ArqProtocol = "stop-and-wait" | "go-back-n" | "selective-repeat";

export interface Transmission {
  frame: number;
  start: number; // time the sender starts transmitting it
  attempt: number; // 1 = first transmission
  lost: boolean;
  delivered: boolean; // accepted by the receiver (false if lost or discarded out of order)
  ackAt: number | null; // when its ACK reaches the sender (null if no ACK for it)
}

export interface ArqResult {
  transmissions: Transmission[];
  totalTime: number; // when the last frame is acknowledged
  utilization: number; // useful frames ÷ total time
  log: string[];
}

export function simulateArq(protocol: ArqProtocol, frames: number, window: number, a: number, lostFirst: Set<number>): ArqResult {
  const W = protocol === "stop-and-wait" ? 1 : Math.max(1, window);
  const rtt = 1 + 2 * a; // from starting to send a frame until its ACK returns
  const timeout = rtt + 1; // a little more than the round trip
  const tx: Transmission[] = [];
  const log: string[] = [];
  const attempts = new Map<number, number>();
  const acked = new Set<number>(); // frames acknowledged at the sender
  const received = new Set<number>(); // frames the receiver holds (SR) / delivered in order
  let expected = 0; // GBN / S&W receiver: next in-order frame
  let base = 0; // oldest unacknowledged frame
  let next = 0; // next new frame to send
  let t = 0;
  const timers = new Map<number, number>(); // frame → when its timer fires (GBN uses only base's)
  const pendingAcks: { at: number; upTo?: number; frame?: number }[] = [];
  const queue: number[] = []; // frames waiting to be (re)sent, in order

  const send = (frame: number) => {
    const attempt = (attempts.get(frame) ?? 0) + 1;
    attempts.set(frame, attempt);
    const lost = attempt === 1 && lostFirst.has(frame);
    const rec: Transmission = { frame, start: t, attempt, lost, delivered: false, ackAt: null };
    tx.push(rec);
    if (lost) {
      log.push(`t=${fmt(t)}: send ${frame}${attempt > 1 ? " (again)" : ""}, lost`);
    } else if (protocol === "selective-repeat") {
      rec.delivered = !received.has(frame);
      received.add(frame);
      rec.ackAt = t + rtt;
      pendingAcks.push({ at: t + rtt, frame });
      log.push(`t=${fmt(t)}: send ${frame}${attempt > 1 ? " (again)" : ""}, ${rec.delivered ? "buffered or delivered" : "duplicate"}, ACK ${frame} back at ${fmt(t + rtt)}`);
    } else {
      // in-order receiver: accepts only the expected frame, ACKs cumulatively
      if (frame === expected) {
        rec.delivered = true;
        expected++;
      }
      rec.ackAt = t + rtt;
      pendingAcks.push({ at: t + rtt, upTo: expected });
      log.push(
        `t=${fmt(t)}: send ${frame}${attempt > 1 ? " (again)" : ""}, ${rec.delivered ? `accepted, ACK ${expected}` : `out of order, discarded, ACK ${expected} again`} back at ${fmt(t + rtt)}`,
      );
    }
    timers.set(frame, t + timeout);
    t += 1;
  };

  for (let guard = 0; guard < 10_000 && base < frames; guard++) {
    // deliver ACKs that have arrived by now
    pendingAcks.sort((x, y) => x.at - y.at);
    while (pendingAcks.length && pendingAcks[0].at <= t + 1e-9) {
      const ack = pendingAcks.shift()!;
      if (ack.frame !== undefined) {
        acked.add(ack.frame);
        timers.delete(ack.frame);
      }
      if (ack.upTo !== undefined)
        for (let f = 0; f < ack.upTo; f++) {
          acked.add(f);
          timers.delete(f);
        }
      while (acked.has(base)) {
        timers.delete(base);
        base++;
      }
    }
    if (base >= frames) break;
    // timeouts
    if (protocol === "selective-repeat") {
      for (let f = base; f < Math.min(base + W, next); f++) {
        if (!acked.has(f) && (timers.get(f) ?? Infinity) <= t + 1e-9 && !queue.includes(f)) {
          log.push(`t=${fmt(t)}: timer for ${f} expires, resend only ${f}`);
          timers.delete(f);
          queue.push(f);
        }
      }
    } else if ((timers.get(base) ?? Infinity) <= t + 1e-9 && !queue.length) {
      const span = Array.from({ length: next - base }, (_, k) => base + k);
      log.push(`t=${fmt(t)}: timer for ${base} expires, ${protocol === "go-back-n" ? `resend ${span.join(", ")}` : `resend ${base}`}`);
      for (const f of span) timers.delete(f);
      queue.push(...span);
    }
    // send something if allowed
    if (queue.length) {
      send(queue.shift()!);
    } else if (next < frames && next < base + W) {
      send(next++);
    } else {
      // idle until the next event
      const future = [...(pendingAcks.length ? [pendingAcks[0].at] : []), ...[...timers.values()]].filter((x) => x > t + 1e-9);
      if (!future.length) break;
      t = Math.min(...future);
    }
  }
  const totalTime = Math.max(...tx.map((x) => x.ackAt ?? 0), t);
  return { transmissions: tx, totalTime, utilization: frames / totalTime, log };
}

/** Utilization with no losses: W / (1 + 2a), capped at 1. */
export const idealUtilization = (W: number, a: number) => Math.min(1, W / (1 + 2 * a));

/** Largest safe sender window with k-bit sequence numbers. */
export const maxWindow = (protocol: ArqProtocol, k: number) => (protocol === "stop-and-wait" ? 1 : protocol === "go-back-n" ? 2 ** k - 1 : 2 ** (k - 1));

const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2));
