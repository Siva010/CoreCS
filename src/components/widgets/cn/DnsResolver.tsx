"use client";
import { useState } from "react";
import { Clock, RotateCcw } from "lucide-react";
import { Btn, Explain, Field, inputCls, Panel, Stat } from "../ui";
import { cn } from "@/lib/utils";

// A tiny simulated DNS universe.
type Rec = { type: "A" | "CNAME" | "NS"; value: string; ttl: number };

const TLD_TTL = 172800;
const ZONES: Record<string, { server: string; records: Record<string, Rec[]> }> = {
  "example.com": {
    server: "a.iana-servers.net",
    records: {
      "example.com": [{ type: "A", value: "93.184.215.14", ttl: 300 }],
      "www.example.com": [{ type: "A", value: "93.184.215.14", ttl: 300 }],
      "api.example.com": [{ type: "A", value: "93.184.215.30", ttl: 60 }],
    },
  },
  "shop.com": {
    server: "ns1.shop-dns.net",
    records: {
      "www.shop.com": [{ type: "CNAME", value: "shop.edgecdn.net", ttl: 3600 }],
      "shop.com": [{ type: "A", value: "198.51.100.10", ttl: 600 }],
    },
  },
  "edgecdn.net": {
    server: "ns1.edgecdn.net",
    records: {
      "shop.edgecdn.net": [
        { type: "A", value: "203.0.113.21", ttl: 20 },
        { type: "A", value: "203.0.113.22", ttl: 20 },
      ],
    },
  },
  "academy.org": {
    server: "ns1.academy.org",
    records: { "learn.academy.org": [{ type: "A", value: "192.0.2.80", ttl: 1800 }] },
  },
};
const TLDS: Record<string, string> = { com: "a.gtld-servers.net", net: "a.gtld-servers.net", org: "a0.org.afilias-nst.info" };
const LATENCY: Record<string, number> = { root: 25, tld: 35, auth: 45 };

interface CacheEntry {
  key: string; // name|type
  name: string;
  type: string;
  values: string[];
  expires: number;
  negative?: boolean;
}

interface Step {
  who: string;
  text: string;
  ms: number;
  tone?: "good" | "warn" | "bad";
}

export default function DnsResolver() {
  const [name, setName] = useState("www.example.com");
  const [clock, setClock] = useState(0);
  const [cache, setCache] = useState<CacheEntry[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [queries, setQueries] = useState(0);

  const live = cache.filter((e) => e.expires > clock);

  function resolve() {
    const q = name.trim().toLowerCase().replace(/\.$/, "");
    const out: Step[] = [{ who: "Stub resolver", text: `Recursive query to the resolver: A? ${q}`, ms: 2 }];
    let cur = q;
    let nextCache = cache.filter((e) => e.expires > clock);
    const put = (e: Omit<CacheEntry, "key">) => {
      nextCache = [...nextCache.filter((x) => x.key !== `${e.name}|${e.type}`), { ...e, key: `${e.name}|${e.type}` }];
    };
    let hops = 0;
    let final: string[] | null = null;
    let nx = false;
    for (let guard = 0; guard < 6 && !final && !nx; guard++) {
      const cached = nextCache.find((e) => e.name === cur && (e.type === "A" || e.type === "CNAME"));
      if (cached) {
        if (cached.negative) {
          out.push({ who: "Resolver cache", text: `Negative cache hit: ${cur} → NXDOMAIN (expires in ${cached.expires - clock} s)`, ms: 0, tone: "warn" });
          nx = true;
          break;
        }
        out.push({ who: "Resolver cache", text: `Cache hit: ${cur} ${cached.type} ${cached.values.join(", ")} (TTL left ${cached.expires - clock} s)`, ms: 0, tone: "good" });
        if (cached.type === "CNAME") {
          cur = cached.values[0];
          continue;
        }
        final = cached.values;
        break;
      }
      const labels = cur.split(".");
      const tld = labels[labels.length - 1];
      const zoneName = labels.slice(-2).join(".");
      // Delegation for the TLD cached?
      const tldNs = nextCache.find((e) => e.name === tld && e.type === "NS");
      if (!tldNs) {
        out.push({ who: "Root server", text: `A? ${cur} → referral: "${tld}." is served by ${TLDS[tld] ?? "(no such TLD)"}`, ms: LATENCY.root });
        hops++;
        if (!TLDS[tld]) {
          out.push({ who: "Root server", text: `NXDOMAIN — no TLD ".${tld}"`, ms: 0, tone: "bad" });
          put({ name: cur, type: "A", values: [], expires: clock + 900, negative: true });
          nx = true;
          break;
        }
        put({ name: tld, type: "NS", values: [TLDS[tld]], expires: clock + TLD_TTL });
      } else {
        out.push({ who: "Resolver cache", text: `Delegation for ".${tld}" cached (${tldNs.values[0]}) — root not needed`, ms: 0, tone: "good" });
      }
      const zone = ZONES[zoneName];
      const zoneNs = nextCache.find((e) => e.name === zoneName && e.type === "NS");
      if (!zoneNs) {
        out.push({
          who: `.${tld} TLD server`,
          text: zone ? `A? ${cur} → referral: ${zoneName} is served by ${zone.server} (+ glue)` : `NXDOMAIN — ${zoneName} is not registered`,
          ms: LATENCY.tld,
          tone: zone ? undefined : "bad",
        });
        hops++;
        if (!zone) {
          put({ name: cur, type: "A", values: [], expires: clock + 900, negative: true });
          nx = true;
          break;
        }
        put({ name: zoneName, type: "NS", values: [zone.server], expires: clock + TLD_TTL });
      } else {
        out.push({ who: "Resolver cache", text: `Delegation for ${zoneName} cached (${zoneNs.values[0]})`, ms: 0, tone: "good" });
      }
      const recs = zone!.records[cur];
      hops++;
      if (!recs) {
        out.push({ who: zone!.server, text: `NXDOMAIN — ${cur} does not exist (negative answer cached per SOA, here 300 s)`, ms: LATENCY.auth, tone: "bad" });
        put({ name: cur, type: "A", values: [], expires: clock + 300, negative: true });
        nx = true;
        break;
      }
      const cname = recs.find((r) => r.type === "CNAME");
      if (cname) {
        out.push({ who: zone!.server, text: `${cur} CNAME ${cname.value} (TTL ${cname.ttl}) → resolver must now resolve ${cname.value}`, ms: LATENCY.auth, tone: "warn" });
        put({ name: cur, type: "CNAME", values: [cname.value], expires: clock + cname.ttl });
        cur = cname.value;
        continue;
      }
      const ttl = Math.min(...recs.map((r) => r.ttl));
      out.push({ who: zone!.server, text: `Authoritative answer: ${cur} A ${recs.map((r) => r.value).join(", ")} (TTL ${ttl})`, ms: LATENCY.auth, tone: "good" });
      put({ name: cur, type: "A", values: recs.map((r) => r.value), expires: clock + ttl });
      final = recs.map((r) => r.value);
    }
    const total = out.reduce((s, x) => s + x.ms, 0);
    out.push({
      who: "Resolver → stub",
      text: final ? `Answer: ${final.join(", ")} (resolved with ${hops} upstream quer${hops === 1 ? "y" : "ies"}, ~${total} ms)` : `Answer: NXDOMAIN (~${total} ms)`,
      ms: 0,
      tone: final ? "good" : "bad",
    });
    setSteps(out);
    setAnswer(final ? final.join(", ") : "NXDOMAIN");
    setCache(nextCache);
    setQueries((n) => n + hops);
  }

  const totalMs = steps.reduce((s, x) => s + x.ms, 0);
  const presets = ["www.example.com", "api.example.com", "www.shop.com", "learn.academy.org", "typo.example.com", "nope.invalid"];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Name to resolve">
          <input className={cn(inputCls, "w-64")} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && resolve()} />
        </Field>
        <Btn variant="primary" onClick={resolve}>
          Resolve
        </Btn>
        <Btn onClick={() => setClock((c) => c + 60)}>
          <Clock className="h-3.5 w-3.5" /> +60 s
        </Btn>
        <Btn onClick={() => setClock((c) => c + 600)}>+10 min</Btn>
        <Btn
          variant="ghost"
          onClick={() => {
            setCache([]);
            setSteps([]);
            setAnswer(null);
            setClock(0);
            setQueries(0);
          }}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Cold cache
        </Btn>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button key={p} type="button" onClick={() => setName(p)} className="rounded-full border border-border px-2.5 py-0.5 font-mono text-[12px] text-muted hover:text-fg">
            {p}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <Panel title="Resolution trace">
          {steps.length ? (
            <ol className="space-y-1.5">
              {steps.map((s, i) => (
                <li key={i} className="grid grid-cols-[130px_1fr_50px] items-start gap-2 text-[13px]">
                  <span className="font-medium text-muted">{s.who}</span>
                  <span className={cn(s.tone === "good" && "text-ok", s.tone === "bad" && "text-bad", s.tone === "warn" && "text-warn")}>{s.text}</span>
                  <span className="text-right font-mono text-[11.5px] text-subtle">{s.ms ? `${s.ms} ms` : ""}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[13px] text-subtle">Resolve a name with a cold cache, then resolve it again — and resolve a sibling name in the same zone.</p>
          )}
        </Panel>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Clock" value={`t=${clock}s`} />
            <Stat label="Last lookup" value={steps.length ? `${totalMs} ms` : "—"} />
            <Stat label="Upstream queries" value={queries} sub="total so far" />
            <Stat label="Answer" value={<span className="text-[12px]">{answer ?? "—"}</span>} />
          </div>
          <Panel title="Resolver cache">
            {live.length ? (
              <ul className="space-y-1 font-mono text-[11.5px]">
                {live.map((e) => (
                  <li key={e.key} className="flex justify-between gap-2">
                    <span className="truncate">
                      {e.name} {e.negative ? "NXDOMAIN" : `${e.type} ${e.values.join(",")}`}
                    </span>
                    <span className="shrink-0 text-subtle">{e.expires - clock}s</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-subtle">Empty.</p>
            )}
          </Panel>
        </div>
      </div>
      <Explain>
        Latencies are illustrative (root ~25 ms, TLD ~35 ms, authoritative ~45 ms). Real resolvers almost always have the root and popular TLD delegations cached, so
        most misses cost only the authoritative query. Note how the CDN&apos;s 20-second TTL forces frequent re-resolution of <code>www.shop.com</code>&apos;s final
        address even while its CNAME stays cached for an hour.
      </Explain>
    </div>
  );
}
