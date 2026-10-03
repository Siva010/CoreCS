"use client";
import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { addressKind, intToIp, ipClass, parseCidr, subnetInfo, toBinary } from "@/lib/sim/ip";
import { Btn, Explain, Field, inputCls, NumberInput, Panel, Segmented, Stat } from "../ui";
import { cn } from "@/lib/utils";

function Bits({ n, prefix }: { n: number; prefix: number }) {
  const b = toBinary(n);
  return (
    <span className="font-mono text-[12px] tracking-tight">
      {[0, 8, 16, 24].map((o, k) => (
        <span key={o}>
          {b
            .slice(o, o + 8)
            .split("")
            .map((ch, i) => (
              <span key={i} className={o + i < prefix ? "text-d-core" : "text-ok"}>
                {ch}
              </span>
            ))}
          {k < 3 && <span className="text-subtle">.</span>}
        </span>
      ))}
    </span>
  );
}

function Calculator() {
  const [text, setText] = useState("192.168.10.37/26");
  const [splitBits, setSplitBits] = useState(2);
  const parsed = parseCidr(text);
  const info = parsed ? subnetInfo(parsed.ip, parsed.prefix) : null;
  const subnets = useMemo(() => {
    if (!parsed || !info) return [];
    const newPrefix = Math.min(32, parsed.prefix + splitBits);
    const count = 2 ** (newPrefix - parsed.prefix);
    const size = 2 ** (32 - newPrefix);
    return Array.from({ length: Math.min(count, 64) }, (_, i) => subnetInfo(info.network + i * size, newPrefix)).map((s) => ({ ...s, prefix: newPrefix }));
  }, [parsed?.ip, parsed?.prefix, splitBits]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <Field label="IPv4 address / prefix">
        <input className={cn(inputCls, "w-60 text-[15px]")} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      {!parsed || !info ? (
        <Explain tone="bad">Enter an address in CIDR form, e.g. 10.1.37.200/21.</Explain>
      ) : (
        <>
          <Panel title="Binary view (blue = network bits, green = host bits)">
            <div className="grid grid-cols-[110px_1fr_auto] items-center gap-x-4 gap-y-1.5 text-[13px]">
              <span className="text-subtle">Address</span>
              <Bits n={parsed.ip} prefix={parsed.prefix} />
              <span className="font-mono">{intToIp(parsed.ip)}</span>
              <span className="text-subtle">Mask /{parsed.prefix}</span>
              <Bits n={info.mask} prefix={parsed.prefix} />
              <span className="font-mono">{intToIp(info.mask)}</span>
              <span className="text-subtle">Network (AND)</span>
              <Bits n={info.network} prefix={parsed.prefix} />
              <span className="font-mono font-semibold">{intToIp(info.network)}</span>
              <span className="text-subtle">Broadcast</span>
              <Bits n={info.broadcast} prefix={parsed.prefix} />
              <span className="font-mono font-semibold">{intToIp(info.broadcast)}</span>
            </div>
          </Panel>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Network" value={`${intToIp(info.network)}/${parsed.prefix}`} />
            <Stat label="Broadcast" value={intToIp(info.broadcast)} />
            <Stat label="Host range" value={<span className="text-[13px]">{intToIp(info.first)} – {intToIp(info.last)}</span>} />
            <Stat label="Usable hosts" value={info.usable.toLocaleString()} sub={`${info.total.toLocaleString()} addresses`} />
            <Stat label="Mask" value={intToIp(info.mask)} />
            <Stat label="Wildcard" value={intToIp(info.wildcard)} sub="used in ACLs" />
            <Stat label="Kind" value={<span className="text-[13px]">{addressKind(parsed.ip)}</span>} />
            <Stat label="Class" value={<span className="text-[13px]">{ipClass(parsed.ip)}</span>} sub="obsolete, but still asked" />
          </div>
          <Panel
            title="Split into equal subnets"
            right={
              <label className="flex items-center gap-2 text-[12px] text-muted">
                borrow bits
                <NumberInput value={splitBits} min={0} max={Math.min(8, 32 - parsed.prefix)} onChange={(v) => setSplitBits(Math.max(0, Math.min(8, 32 - parsed.prefix, v)))} className="w-16" />
              </label>
            }
          >
            <p className="mb-2 text-[12.5px] text-muted">
              Borrowing {splitBits} bit{splitBits === 1 ? "" : "s"} → {2 ** splitBits} subnets of /{parsed.prefix + splitBits} ({(2 ** (32 - parsed.prefix - splitBits)).toLocaleString()} addresses each).
            </p>
            <div className="max-h-64 overflow-auto thin-scroll">
              <table className="w-full font-mono text-[12.5px]">
                <thead className="text-left text-[11px] text-subtle">
                  <tr>
                    <th className="pb-1">#</th>
                    <th className="pb-1">Subnet</th>
                    <th className="pb-1">Hosts</th>
                    <th className="pb-1">Broadcast</th>
                  </tr>
                </thead>
                <tbody>
                  {subnets.map((s, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-1 text-subtle">{i}</td>
                      <td>
                        {intToIp(s.network)}/{s.prefix}
                      </td>
                      <td>
                        {intToIp(s.first)} – {intToIp(s.last)}
                      </td>
                      <td>{intToIp(s.broadcast)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function randomQuestion() {
  const prefixes = [19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const firstOctet = [10, 172, 192][Math.floor(Math.random() * 3)];
  const second = firstOctet === 10 ? Math.floor(Math.random() * 256) : firstOctet === 172 ? 16 + Math.floor(Math.random() * 16) : 168;
  const ip = ((firstOctet << 24) | (second << 16) | (Math.floor(Math.random() * 256) << 8) | Math.floor(Math.random() * 256)) >>> 0;
  return { ip, prefix };
}

function Trainer() {
  const [q, setQ] = useState(randomQuestion);
  const [ans, setAns] = useState({ network: "", broadcast: "", hosts: "" });
  const [checked, setChecked] = useState(false);
  const [score, setScore] = useState({ right: 0, total: 0 });
  const info = subnetInfo(q.ip, q.prefix);
  const ok = {
    network: ans.network.trim() === intToIp(info.network),
    broadcast: ans.broadcast.trim() === intToIp(info.broadcast),
    hosts: Number(ans.hosts.replace(/,/g, "")) === info.usable,
  };
  const all = ok.network && ok.broadcast && ok.hosts;
  const octet = q.prefix >= 24 ? 4 : q.prefix >= 16 ? 3 : 2;
  const maskVal = (info.mask >>> ((4 - octet) * 8)) & 255;

  return (
    <div className="space-y-4">
      <Panel title="Practice" right={<span className="font-mono text-[12px] text-subtle">score {score.right}/{score.total}</span>}>
        <p className="text-[15px]">
          Given <span className="font-mono font-semibold text-accent">{intToIp(q.ip)}/{q.prefix}</span>, find:
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {(["network", "broadcast", "hosts"] as const).map((k) => (
            <Field key={k} label={k === "hosts" ? "Usable hosts" : `${k[0].toUpperCase()}${k.slice(1)} address`}>
              <input
                className={cn(inputCls, checked && (ok[k] ? "border-ok" : "border-bad"))}
                value={ans[k]}
                onChange={(e) => setAns({ ...ans, [k]: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && !checked && (setChecked(true), setScore((s) => ({ right: s.right + (all ? 1 : 0), total: s.total + 1 })))}
              />
            </Field>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Btn
            variant="primary"
            disabled={checked}
            onClick={() => {
              setChecked(true);
              setScore((s) => ({ right: s.right + (all ? 1 : 0), total: s.total + 1 }));
            }}
          >
            Check
          </Btn>
          <Btn
            onClick={() => {
              setQ(randomQuestion());
              setAns({ network: "", broadcast: "", hosts: "" });
              setChecked(false);
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" /> New question
          </Btn>
        </div>
        {checked && (
          <div className="mt-3">
            <Explain tone={all ? "good" : "bad"}>
              {all ? "All correct. " : "Not quite. "}
              Interesting octet: #{octet}, mask value {maskVal} → block size {256 - maskVal}. Network {intToIp(info.network)}, broadcast{" "}
              {intToIp(info.broadcast)}, usable hosts 2^{32 - q.prefix} − 2 = {info.usable.toLocaleString()}.
            </Explain>
          </div>
        )}
      </Panel>
    </div>
  );
}

export default function SubnetCalculator() {
  const [mode, setMode] = useState<"calc" | "train">("calc");
  return (
    <div className="space-y-4">
      <Segmented value={mode} onChange={setMode} options={[{ value: "calc", label: "Calculator" }, { value: "train", label: "Practice mode" }]} />
      {mode === "calc" ? <Calculator /> : <Trainer />}
    </div>
  );
}
