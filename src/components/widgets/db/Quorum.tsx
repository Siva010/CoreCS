"use client";
import { useMemo, useState } from "react";
import { Explain, Field, NumberInput, Panel, Stat } from "../ui";
import { cn } from "@/lib/utils";

export default function Quorum() {
  const [n, setN] = useState(3);
  const [w, setW] = useState(2);
  const [r, setR] = useState(2);
  const [writeStart, setWriteStart] = useState(0);
  const [readStart, setReadStart] = useState(1);
  const [down, setDown] = useState<number[]>([]);

  const W = Math.min(w, n);
  const R = Math.min(r, n);
  const writeSet = useMemo(() => Array.from({ length: W }, (_, i) => (writeStart + i) % n), [W, writeStart, n]);
  const readSet = useMemo(() => Array.from({ length: R }, (_, i) => (readStart + i) % n), [R, readStart, n]);
  const overlap = writeSet.filter((x) => readSet.includes(x));
  const guaranteed = W + R > n;
  const aliveCount = n - down.filter((d) => d < n).length;
  const canWrite = aliveCount >= W;
  const canRead = aliveCount >= R;

  const toggleDown = (i: number) => setDown((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="N (replicas)">
          <NumberInput value={n} min={1} max={7} onChange={(v) => { const x = Math.max(1, Math.min(7, v)); setN(x); setW(Math.min(w, x)); setR(Math.min(r, x)); }} />
        </Field>
        <Field label="W (acks per write)">
          <NumberInput value={W} min={1} max={n} onChange={(v) => setW(Math.max(1, Math.min(n, v)))} />
        </Field>
        <Field label="R (replicas read)">
          <NumberInput value={R} min={1} max={n} onChange={(v) => setR(Math.max(1, Math.min(n, v)))} />
        </Field>
        <Field label="Which replicas answer the write">
          <NumberInput value={writeStart} min={0} max={n - 1} onChange={(v) => setWriteStart(((v % n) + n) % n)} />
        </Field>
        <Field label="…and the read">
          <NumberInput value={readStart} min={0} max={n - 1} onChange={(v) => setReadStart(((v % n) + n) % n)} />
        </Field>
      </div>

      <Panel title="Replicas (click one to take it down)">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: n }, (_, i) => {
            const inW = writeSet.includes(i);
            const inR = readSet.includes(i);
            const isDown = down.includes(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => toggleDown(i)}
                className={cn(
                  "w-28 rounded-lg border px-2 py-2 text-left text-[12px]",
                  isDown ? "border-bad/50 bg-bad/10 text-bad" : inW && inR ? "border-ok bg-ok/15" : inW ? "border-accent bg-accent/10" : inR ? "border-warn bg-warn/10" : "border-border bg-surface",
                )}
              >
                <div className="font-mono font-semibold">replica {i + 1}</div>
                <div className="text-[11.5px]">
                  {isDown ? "down" : inW && inR ? "wrote + read" : inW ? "has the new value" : inR ? "read from" : "idle"}
                </div>
                <div className="mt-1 font-mono text-[11px] text-subtle">{isDown ? "—" : inW ? "v2 (new)" : "v1 (old)"}</div>
              </button>
            );
          })}
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="W + R" value={`${W} + ${R} = ${W + R}`} sub={`N = ${n}`} />
        <Stat label="Overlap guaranteed?" value={guaranteed ? "yes" : "no"} sub={guaranteed ? "W + R > N" : "W + R ≤ N — a read can miss the write"} />
        <Stat label="Failures tolerated" value={`write ${n - W}, read ${n - R}`} />
        <Stat label="This read sees" value={overlap.length ? "the new value" : "the old value"} sub={overlap.length ? `overlap: replica ${overlap.map((i) => i + 1).join(", ")}` : "no replica in common"} />
      </div>

      {(!canWrite || !canRead) && (
        <Explain tone="bad">
          With {down.length} replica(s) down, {!canWrite && `writes fail (only ${aliveCount} replicas are reachable, W = ${W})`}
          {!canWrite && !canRead && " and "}
          {!canRead && `reads fail (R = ${R})`}. Lower W or R to stay available — and accept weaker guarantees.
        </Explain>
      )}

      <Explain tone={guaranteed ? "good" : "warn"}>
        {guaranteed
          ? `Every set of ${W} replicas and every set of ${R} replicas out of ${n} share at least one replica, so a read always reaches one that acknowledged the latest successful write. Move the read window around: the overlap never disappears.`
          : `W + R = ${W + R} ≤ N = ${n}: slide the read window to replicas that never received the write and it returns stale data — exactly the configuration that makes "eventual consistency" visible.`}
      </Explain>

      <Panel title="Why W + R > N still isn't linearizability">
        <ul className="space-y-1.5 text-[13px] text-muted">
          <li>• A write that reached only some replicas and then failed may be seen by one read and not the next.</li>
          <li>• Concurrent writes are resolved by timestamps (last-write-wins): with clock skew the newer write can lose.</li>
          <li>• <strong>Sloppy quorums</strong> accept writes on replicas outside the key&apos;s N designated nodes, so a strict-quorum read may miss them.</li>
          <li>• Without read repair before returning, two sequential reads can go new → old.</li>
          <li>• Common settings: N = 3 with W = R = 2 (balanced), W = 1 (fast writes, stale reads), R = 1 (fast reads), or LOCAL_QUORUM per datacenter.</li>
        </ul>
      </Panel>
    </div>
  );
}
