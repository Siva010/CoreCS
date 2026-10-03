"use client";
import { useState } from "react";
import { intToIp, ipToInt, longestPrefixMatch } from "@/lib/sim/ip";
import { Btn, Explain, Field, inputCls, NumberInput, Panel, Segmented, Select } from "../ui";
import { cn } from "@/lib/utils";

type Dev = "hostA" | "R1" | "R2" | "R3";

interface Route {
  cidr: string;
  value: { via: string | null; dev: Dev | null; iface: string; note?: string };
}

const TABLES: Record<"hostA" | "R1" | "R2" | "R3", Route[]> = {
  hostA: [
    { cidr: "192.168.1.0/24", value: { via: null, dev: null, iface: "wlan0", note: "connected (on-link)" } },
    { cidr: "0.0.0.0/0", value: { via: "192.168.1.1", dev: "R1", iface: "wlan0", note: "default gateway" } },
  ],
  R1: [
    { cidr: "192.168.1.0/24", value: { via: null, dev: null, iface: "lan", note: "connected" } },
    { cidr: "198.51.100.0/24", value: { via: null, dev: null, iface: "wan", note: "connected" } },
    { cidr: "0.0.0.0/0", value: { via: "198.51.100.1", dev: "R2", iface: "wan", note: "ISP" } },
  ],
  R2: [
    { cidr: "198.51.100.0/24", value: { via: null, dev: null, iface: "cust", note: "connected (customers)" } },
    { cidr: "10.0.0.0/30", value: { via: null, dev: null, iface: "core", note: "connected (link to R3)" } },
    { cidr: "93.184.0.0/16", value: { via: "10.0.0.2", dev: "R3", iface: "core", note: "learned via BGP" } },
    { cidr: "203.0.113.0/24", value: { via: "10.0.0.2", dev: "R3", iface: "core" } },
  ],
  R3: [
    { cidr: "10.0.0.0/30", value: { via: null, dev: null, iface: "core", note: "connected" } },
    { cidr: "93.184.215.0/24", value: { via: null, dev: null, iface: "dc", note: "connected (data center)" } },
    { cidr: "203.0.113.0/24", value: { via: null, dev: null, iface: "lab", note: "connected" } },
    { cidr: "0.0.0.0/0", value: { via: "10.0.0.1", dev: "R2", iface: "core" } },
  ],
};

const HOSTS: Record<string, { name: string; up: boolean }> = {
  "93.184.215.14": { name: "web server", up: true },
  "192.168.1.50": { name: "printer (same LAN)", up: true },
  "203.0.113.99": { name: "decommissioned host", up: false },
};

interface Hop {
  dev: string;
  lines: string[];
  tone?: "good" | "bad" | "warn";
}

function simulate(dst: string, ttl0: number): Hop[] {
  const d = ipToInt(dst);
  if (d === null) return [{ dev: "input", lines: ["Invalid IPv4 address."], tone: "bad" }];
  const hops: Hop[] = [];
  let src = "192.168.1.20";
  let srcPort = 51514;
  let ttl = ttl0;
  let at: Dev = "hostA";
  for (let guard = 0; guard < 8; guard++) {
    const table: Route[] = TABLES[at as keyof typeof TABLES];
    const lines: string[] = [];
    if (at !== "hostA") {
      ttl -= 1;
      lines.push(`Received frame, stripped Ethernet header. TTL ${ttl + 1} → ${ttl}.`);
      if (ttl <= 0) {
        lines.push(`TTL expired → drop and send ICMP Time Exceeded back to ${src === "198.51.100.7" ? "198.51.100.7 (then NAT → host A)" : src}. (This is how traceroute discovers hop ${hops.length}.)`);
        hops.push({ dev: at, lines, tone: "warn" });
        return hops;
      }
    } else {
      lines.push(`Host A builds IP packet ${src} → ${dst}, TTL ${ttl}, TCP ${srcPort} → 443.`);
    }
    const match = longestPrefixMatch<Route["value"]>(d, table);
    if (!match) {
      lines.push(`No route to ${dst} (and no default route) → drop, ICMP Destination Unreachable (network unreachable).`);
      hops.push({ dev: at, lines, tone: "bad" });
      return hops;
    }
    lines.push(`Longest-prefix match: ${match.cidr} (${match.value.note ?? "route"}) → ${match.value.via ? `next hop ${match.value.via}` : "destination is on-link"} via ${match.value.iface}.`);
    if (at === "R1" && match.value.iface === "wan") {
      lines.push(`NAT: source ${src}:${srcPort} → 198.51.100.7:40001 (conntrack entry created; IP and TCP checksums updated).`);
      src = "198.51.100.7";
      srcPort = 40001;
    }
    if (!match.value.via) {
      const host = HOSTS[dst];
      lines.push(`ARP for ${dst} on ${match.value.iface}…`);
      if (!host || !host.up) {
        lines.push(`No ARP reply → packet dropped; ICMP Destination Unreachable (host unreachable) after ARP timeout.`);
        hops.push({ dev: at, lines, tone: "bad" });
        return hops;
      }
      lines.push(`ARP reply → frame to ${host.name}'s MAC. Delivered.`);
      hops.push({ dev: at, lines });
      hops.push({ dev: host.name, lines: [`Received ${src}:${srcPort} → ${dst}:443 with TTL ${ttl}. It sees the ${src === "198.51.100.7" ? "NAT'ed public" : "private"} source address.`], tone: "good" });
      return hops;
    }
    lines.push(`ARP resolves next hop ${match.value.via} → new Ethernet frame to that router's MAC.`);
    hops.push({ dev: at, lines });
    at = match.value.dev!;
  }
  hops.push({ dev: "loop guard", lines: ["Stopped (possible routing loop)."], tone: "bad" });
  return hops;
}

export default function Routing() {
  const [dst, setDst] = useState("93.184.215.14");
  const [ttl, setTtl] = useState(64);
  const [mode, setMode] = useState<"send" | "trace">("send");
  const [hops, setHops] = useState<Hop[] | null>(null);
  const [trace, setTrace] = useState<string[] | null>(null);
  const [view, setView] = useState<keyof typeof TABLES>("R2");

  const run = () => {
    if (mode === "send") {
      setHops(simulate(dst, ttl));
      setTrace(null);
    } else {
      const lines: string[] = [];
      for (let t = 1; t <= 6; t++) {
        const h = simulate(dst, t);
        const last = h[h.length - 1];
        if (last.tone === "warn") lines.push(`TTL=${t}: ICMP Time Exceeded from ${last.dev}`);
        else if (last.tone === "good") {
          lines.push(`TTL=${t}: reached ${last.dev} ✔`);
          break;
        } else {
          lines.push(`TTL=${t}: ${last.dev} — ${last.lines[last.lines.length - 1]}`);
          break;
        }
      }
      setTrace(lines);
      setHops(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border border-border bg-surface p-3 thin-scroll">
        <div className="flex min-w-[640px] items-center justify-between gap-2 font-mono text-[11.5px]">
          {[
            ["Host A", "192.168.1.20"],
            ["R1 home router (NAT)", "192.168.1.1 | 198.51.100.7"],
            ["R2 ISP", "198.51.100.1 | 10.0.0.1"],
            ["R3 provider edge", "10.0.0.2"],
            ["Web server", "93.184.215.14"],
          ].map(([n, a], i, arr) => (
            <div key={n} className="flex items-center gap-2">
              <div className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-center">
                <div className="font-sans text-[12px] font-semibold text-fg">{n}</div>
                <div className="text-subtle">{a}</div>
              </div>
              {i < arr.length - 1 && <span className="text-subtle">⟷</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Destination IP">
          <input className={cn(inputCls, "w-44")} value={dst} onChange={(e) => setDst(e.target.value)} />
        </Field>
        <Field label="Initial TTL">
          <NumberInput value={ttl} min={1} max={255} onChange={(v) => setTtl(Math.max(1, Math.min(255, v)))} />
        </Field>
        <Segmented value={mode} onChange={setMode} options={[{ value: "send", label: "Send packet" }, { value: "trace", label: "traceroute" }]} />
        <Btn variant="primary" onClick={run}>
          Go
        </Btn>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {[
          ["93.184.215.14", "web server"],
          ["192.168.1.50", "same LAN"],
          ["203.0.113.99", "host down"],
          ["172.16.5.5", "no route"],
        ].map(([ip, l]) => (
          <button key={ip} type="button" onClick={() => setDst(ip)} className="rounded-full border border-border px-2.5 py-0.5 font-mono text-[12px] text-muted hover:text-fg">
            {ip} <span className="font-sans text-subtle">({l})</span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Panel title={mode === "send" ? "Hop by hop" : "traceroute output"}>
          {hops && (
            <ol className="space-y-3">
              {hops.map((h, i) => (
                <li key={i} className="rounded-lg border border-border bg-surface-2/50 p-2.5">
                  <div className={cn("mb-1 text-[12.5px] font-semibold", h.tone === "bad" && "text-bad", h.tone === "good" && "text-ok", h.tone === "warn" && "text-warn")}>{h.dev}</div>
                  <ul className="space-y-0.5 text-[12.5px] text-muted">
                    {h.lines.map((l, k) => (
                      <li key={k}>{l}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
          {trace && (
            <ol className="space-y-1 font-mono text-[12.5px]">
              {trace.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ol>
          )}
          {!hops && !trace && <p className="text-[13px] text-subtle">Pick a destination and press Go.</p>}
        </Panel>
        <Panel title="Routing table" right={<Select value={view} onChange={setView} options={(["hostA", "R1", "R2", "R3"] as const).map((v) => ({ value: v, label: v === "hostA" ? "Host A" : v }))} />}>
          <table className="w-full font-mono text-[12px]">
            <thead className="text-left text-[11px] text-subtle">
              <tr>
                <th className="pb-1">Prefix</th>
                <th>Next hop</th>
                <th>If</th>
              </tr>
            </thead>
            <tbody>
              {TABLES[view].map((r) => {
                const d = ipToInt(dst);
                const m = d !== null ? longestPrefixMatch(d, TABLES[view]) : null;
                return (
                  <tr key={r.cidr} className={cn("border-t border-border", m?.cidr === r.cidr && "bg-accent/10 font-semibold")}>
                    <td className="py-1">{r.cidr}</td>
                    <td>{r.value.via ?? "on-link"}</td>
                    <td>{r.value.iface}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[11.5px] text-subtle">Highlighted row = longest-prefix match for {dst || "—"}{ipToInt(dst) !== null ? ` (${intToIp(ipToInt(dst)!)})` : ""}.</p>
        </Panel>
      </div>
      <Explain>
        Every router decides independently from its own table. Note R2 has no default route: an unknown destination is dropped with ICMP &ldquo;network unreachable&rdquo;
        — an immediate error instead of a timeout.
      </Explain>
    </div>
  );
}
