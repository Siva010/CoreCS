"use client";
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Btn, Explain, Field, NumberInput, Panel, Segmented, Stat } from "../ui";
import { cn } from "@/lib/utils";

type Directive = "none" | "no-cache" | "no-store" | "private";
type CacheKind = "browser" | "cdn";

interface Entry {
  version: number;
  storedAt: number;
}

interface Row {
  t: number;
  outcome: "HIT" | "STALE HIT" | "304" | "200" | "200 (not stored)";
  detail: string;
  bytes: number;
  ms: number;
  staleContent: boolean;
}

const SIZE = 48_000;
const RTT = 80;

export default function HttpCache() {
  const [maxAge, setMaxAge] = useState(60);
  const [directive, setDirective] = useState<Directive>("none");
  const [etag, setEtag] = useState(true);
  const [swr, setSwr] = useState(0);
  const [kind, setKind] = useState<CacheKind>("browser");
  const [clock, setClock] = useState(0);
  const [origin, setOrigin] = useState(1);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

  const headers = [
    directive === "no-store" ? "Cache-Control: no-store" : directive === "no-cache" ? `Cache-Control: no-cache` : `Cache-Control: ${directive === "private" ? "private, " : "public, "}max-age=${maxAge}${swr ? `, stale-while-revalidate=${swr}` : ""}`,
    etag ? `ETag: "v${origin}"` : "(no validator)",
  ];

  function request() {
    const age = entry ? clock - entry.storedAt : null;
    const storable = directive !== "no-store" && !(directive === "private" && kind === "cdn");
    let row: Row;
    let next: Entry | null = entry;
    if (!storable) {
      row = { t: clock, outcome: "200 (not stored)", detail: directive === "no-store" ? "no-store: nothing may be cached; full fetch every time." : "private: shared caches (CDNs) must not store user-specific responses.", bytes: SIZE, ms: RTT + 40, staleContent: false };
      next = null;
    } else if (entry && age !== null && directive !== "no-cache" && age < maxAge) {
      const stale = entry.version !== origin;
      row = { t: clock, outcome: "HIT", detail: `Fresh (age ${age}s < max-age ${maxAge}s): served locally, no network.${stale ? " ⚠ The origin already has a newer version — freshness means accepting staleness." : ""}`, bytes: 0, ms: 0, staleContent: stale };
    } else if (entry && age !== null && swr > 0 && directive !== "no-cache" && age < maxAge + swr) {
      const stale = entry.version !== origin;
      row = { t: clock, outcome: "STALE HIT", detail: `Stale (age ${age}s) but within stale-while-revalidate (${swr}s): served immediately, refreshed in the background.`, bytes: 0, ms: 0, staleContent: stale };
      next = { version: origin, storedAt: clock };
    } else if (entry && etag) {
      if (entry.version === origin) {
        row = { t: clock, outcome: "304", detail: `${directive === "no-cache" ? "no-cache → must revalidate every use." : `Stale (age ${age}s ≥ ${maxAge}s).`} Conditional GET with If-None-Match: "v${entry.version}" → 304 Not Modified, body reused.`, bytes: 300, ms: RTT, staleContent: false };
        next = { version: origin, storedAt: clock };
      } else {
        row = { t: clock, outcome: "200", detail: `Revalidated: ETag "v${entry.version}" no longer matches ("v${origin}") → 200 with the new body.`, bytes: SIZE, ms: RTT + 40, staleContent: false };
        next = { version: origin, storedAt: clock };
      }
    } else {
      row = { t: clock, outcome: "200", detail: entry ? `Stale and no validator → full fetch (can't ask "has it changed?").` : "Nothing stored → full fetch; response stored.", bytes: SIZE, ms: RTT + 40, staleContent: false };
      next = { version: origin, storedAt: clock };
    }
    setEntry(next);
    setRows((r) => [row, ...r].slice(0, 40));
  }

  const reset = () => {
    setClock(0);
    setOrigin(1);
    setEntry(null);
    setRows([]);
  };
  const bytes = rows.reduce((s, r) => s + r.bytes, 0);
  const saved = rows.length * SIZE - bytes;

  return (
    <div className="space-y-4">
      <Panel title="Origin response headers">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Directive">
            <Segmented
              size="sm"
              value={directive}
              onChange={setDirective}
              options={[
                { value: "none", label: "max-age" },
                { value: "no-cache", label: "no-cache" },
                { value: "no-store", label: "no-store" },
                { value: "private", label: "private" },
              ]}
            />
          </Field>
          <Field label="max-age (s)">
            <NumberInput value={maxAge} min={0} max={86400} onChange={(v) => setMaxAge(Math.max(0, v))} />
          </Field>
          <Field label="stale-while-revalidate (s)">
            <NumberInput value={swr} min={0} max={3600} onChange={(v) => setSwr(Math.max(0, v))} />
          </Field>
          <label className="flex items-center gap-2 pb-1.5 text-[13px] text-muted">
            <input type="checkbox" checked={etag} onChange={(e) => setEtag(e.target.checked)} /> send ETag
          </label>
          <Field label="Cache">
            <Segmented size="sm" value={kind} onChange={setKind} options={[{ value: "browser", label: "browser (private)" }, { value: "cdn", label: "CDN (shared)" }]} />
          </Field>
        </div>
        <pre className="mt-3 rounded-lg border border-border bg-surface-2 p-2 font-mono text-[12px]">{headers.join("\n")}</pre>
      </Panel>

      <div className="flex flex-wrap items-center gap-2">
        <Btn variant="primary" onClick={request}>
          Request /app.css at t={clock}s
        </Btn>
        <Btn onClick={() => setClock((c) => c + 10)}>+10 s</Btn>
        <Btn onClick={() => setClock((c) => c + 30)}>+30 s</Btn>
        <Btn onClick={() => setClock((c) => c + 120)}>+2 min</Btn>
        <Btn onClick={() => setOrigin((v) => v + 1)}>Deploy new version at origin (v{origin + 1})</Btn>
        <Btn variant="ghost" onClick={reset}>
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </Btn>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Origin version" value={`v${origin}`} />
        <Stat label="Cached copy" value={entry ? `v${entry.version}, age ${clock - entry.storedAt}s` : "none"} />
        <Stat label="Bytes transferred" value={`${(bytes / 1000).toFixed(1)} KB`} />
        <Stat label="Bytes saved by cache" value={`${(saved / 1000).toFixed(1)} KB`} />
      </div>

      <Panel title="Requests (newest first)">
        {rows.length ? (
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-[11px] text-subtle uppercase">
              <tr>
                <th className="pb-1">t</th>
                <th>Result</th>
                <th>Why</th>
                <th className="text-right">Bytes</th>
                <th className="text-right">Latency</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={cn("border-t border-border align-top", r.staleContent && "bg-warn/5")}>
                  <td className="py-1.5 font-mono">{r.t}s</td>
                  <td className={cn("font-mono font-semibold", r.outcome.includes("HIT") ? "text-ok" : r.outcome === "304" ? "text-d-core" : "text-warn")}>{r.outcome}</td>
                  <td className="pr-2 text-muted">{r.detail}</td>
                  <td className="text-right font-mono">{r.bytes}</td>
                  <td className="text-right font-mono">{r.ms} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-[13px] text-subtle">Make a request, advance the clock, request again. Then deploy a new version and see who notices when.</p>
        )}
      </Panel>
      <Explain>Model: {SIZE / 1000} KB resource, {RTT} ms round trip to the origin. A 304 still costs a round trip — it only saves the body.</Explain>
    </div>
  );
}
