"use client";
import { useState } from "react";
import { crcDivide, crcOf, flip, hammingData, hammingEncode, hammingSyndrome, hex4, internetChecksum, isBits, parityBit } from "@/lib/sim/errorCodes";
import { Btn, Explain, Field, Panel, Segmented, Stat, inputCls } from "../ui";
import { cn } from "@/lib/utils";

type Tab = "crc" | "hamming" | "checksum";

const GENERATORS = [
  { value: "10011", label: "x⁴ + x + 1 (10011)" },
  { value: "1011", label: "x³ + x + 1 (1011)" },
  { value: "100000111", label: "CRC-8 (100000111)" },
];

/** Hide the zeros already divided out, as in long division by hand, but always keep the last r bits. */
function blankLeading(bits: string, r: number) {
  let i = 0;
  while (i < bits.length - r && bits[i] === "0") i++;
  return " ".repeat(i) + bits.slice(i);
}

function Bits({ bits, highlight, onFlip, flipped }: { bits: string; highlight?: Set<number>; onFlip?: (i: number) => void; flipped?: Set<number> }) {
  return (
    <div className="flex flex-wrap gap-0.5 font-mono text-[13px]">
      {[...bits].map((b, i) => (
        <button
          key={i}
          type="button"
          disabled={!onFlip}
          onClick={() => onFlip?.(i)}
          className={cn(
            "h-7 w-6 rounded border text-center",
            flipped?.has(i) ? "border-bad bg-bad/15 text-bad" : highlight?.has(i) ? "border-accent bg-accent/10 text-fg" : "border-border bg-surface-2 text-fg",
            onFlip && "hover:border-warn",
          )}
          title={onFlip ? `bit ${i + 1}: click to flip` : undefined}
        >
          {b}
        </button>
      ))}
    </div>
  );
}

function CrcTab() {
  const [data, setData] = useState("1101011011");
  const [gen, setGen] = useState("10011");
  const [flipped, setFlipped] = useState<Set<number>>(new Set());
  const ok = isBits(data) && isBits(gen) && gen.startsWith("1") && gen.length >= 2 && data.length <= 24;
  if (!ok)
    return (
      <div className="space-y-3">
        <Inputs data={data} setData={setData} gen={gen} setGen={setGen} reset={() => setFlipped(new Set())} />
        <Explain tone="warn">Enter bits only (0 and 1); the generator must start with 1 and the data be at most 24 bits.</Explain>
      </div>
    );
  const r = gen.length - 1;
  const crc = crcOf(data, gen);
  const sent = data + crc;
  const { steps } = crcDivide(data + "0".repeat(r), gen);
  let received = sent;
  for (const i of flipped) received = flip(received, i);
  const check = crcDivide(received, gen).remainder;
  const detected = /1/.test(check);
  return (
    <div className="space-y-4">
      <Inputs data={data} setData={setData} gen={gen} setGen={setGen} reset={() => setFlipped(new Set())} />
      <Panel title={`Sender: divide ${data} + ${r} zeros by ${gen}`}>
        <div className="overflow-x-auto thin-scroll">
          <pre className="font-mono text-[12.5px] leading-relaxed text-fg">
            {`${data}${"0".repeat(r)}   ← data with ${r} zeros appended\n`}
            {steps.map((s, k) => `${" ".repeat(s.pos)}${gen}${" ".repeat(Math.max(0, data.length + r - s.pos - gen.length))}   XOR at bit ${s.pos + 1}\n${blankLeading(s.after, r)}${k === steps.length - 1 ? `   ← last ${r} bits are the remainder` : ""}\n`).join("")}
          </pre>
        </div>
        <p className="mt-2 text-[13px] text-muted">
          Remainder <b className="font-mono text-fg">{crc}</b>, so the frame sent is <span className="font-mono text-fg">{data}</span>
          <span className="font-mono font-semibold text-accent">{crc}</span>.
        </p>
      </Panel>
      <Panel title="Receiver: click bits to damage them in transit" right={<Btn variant="ghost" onClick={() => setFlipped(new Set())}>Clear errors</Btn>}>
        <Bits
          bits={received}
          highlight={new Set(Array.from({ length: r }, (_, k) => data.length + k))}
          flipped={flipped}
          onFlip={(i) =>
            setFlipped((f) => {
              const g = new Set(f);
              if (g.has(i)) g.delete(i);
              else g.add(i);
              return g;
            })
          }
        />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Stat label="Receiver's remainder" value={check} />
          <Stat label="Verdict" value={detected ? "drop" : "accept"} sub={flipped.size ? `${flipped.size} bit${flipped.size === 1 ? "" : "s"} flipped` : "no errors"} />
        </div>
        <div className="mt-3">
          {flipped.size > 0 && !detected ? (
            <Explain tone="bad">This error pattern is itself a multiple of the generator, so the CRC can't see it. Strong generators make such patterns very unlikely for real noise.</Explain>
          ) : (
            <Explain tone={detected ? "good" : "neutral"}>
              {detected
                ? "A non-zero remainder: the frame is damaged and is dropped. Ethernet leaves the resend to TCP."
                : "The whole frame is an exact multiple of the generator, so the remainder is 0."}
            </Explain>
          )}
        </div>
      </Panel>
    </div>
  );
}

function Inputs({ data, setData, gen, setGen, reset }: { data: string; setData: (s: string) => void; gen: string; setGen: (s: string) => void; reset: () => void }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Data bits">
        <input
          className={cn(inputCls, "w-56")}
          value={data}
          onChange={(e) => {
            setData(e.target.value.trim());
            reset();
          }}
          spellCheck={false}
          aria-label="Data bits"
        />
      </Field>
      <Field label="Generator">
        <Segmented
          size="sm"
          value={gen}
          onChange={(v) => {
            setGen(v);
            reset();
          }}
          options={GENERATORS}
        />
      </Field>
    </div>
  );
}

function HammingTab() {
  const [data, setData] = useState("1011");
  const [flipped, setFlipped] = useState<Set<number>>(new Set());
  const ok = isBits(data) && data.length >= 1 && data.length <= 11;
  if (!ok)
    return (
      <div className="space-y-3">
        <Field label="Data bits (1–11)">
          <input className={cn(inputCls, "w-40")} value={data} onChange={(e) => setData(e.target.value.trim())} spellCheck={false} aria-label="Data bits" />
        </Field>
        <Explain tone="warn">Enter 1 to 11 bits.</Explain>
      </div>
    );
  const enc = hammingEncode(data);
  let received = enc.code;
  for (const i of flipped) received = flip(received, i);
  const { syndrome, failing } = hammingSyndrome(received);
  const corrected = syndrome && syndrome <= received.length ? flip(received, syndrome - 1) : received;
  const fixedData = hammingData(corrected);
  const wrong = fixedData !== data;
  const toggle = (i: number) =>
    setFlipped((f) => {
      const g = new Set(f);
      if (g.has(i)) g.delete(i);
      else g.add(i);
      return g;
    });
  return (
    <div className="space-y-4">
      <Field label="Data bits (1–11)">
        <input
          className={cn(inputCls, "w-40")}
          value={data}
          onChange={(e) => {
            setData(e.target.value.trim());
            setFlipped(new Set());
          }}
          spellCheck={false}
          aria-label="Data bits"
        />
      </Field>
      <Panel
        title={`Codeword: ${data.length} data bits + ${enc.checkPositions.length} check bits`}
        right={
          <Btn variant="ghost" onClick={() => setFlipped(new Set())}>
            Clear errors
          </Btn>
        }
      >
        <div className="flex flex-wrap gap-0.5 font-mono text-[12px]">
          {[...received].map((b, i) => {
            const pos = i + 1;
            const isCheck = enc.checkPositions.includes(pos);
            return (
              <button
                key={i}
                type="button"
                onClick={() => toggle(i)}
                className={cn("flex w-8 flex-col items-center rounded border py-0.5", flipped.has(i) ? "border-bad bg-bad/15" : isCheck ? "border-warn bg-warn/10" : "border-border bg-surface-2")}
                title="click to flip this bit in transit"
              >
                <span className="text-[10px] text-subtle">{pos}</span>
                <span className="text-[13px] font-semibold text-fg">{b}</span>
                <span className="text-[9px] text-subtle">{isCheck ? `p${pos}` : "d"}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[12.5px] text-muted">Amber cells are check bits (positions 1, 2, 4, 8…). Click any bit to flip it in transit.</p>
      </Panel>
      <Panel title="What each check bit covers">
        <ul className="space-y-1 font-mono text-[12.5px]">
          {enc.checkPositions.map((p) => (
            <li key={p} className={cn("rounded px-2 py-0.5", failing.includes(p) ? "bg-bad/10 text-bad" : "text-muted")}>
              p{p} covers {enc.coverage[p].join(", ")} {failing.includes(p) ? "→ fails" : "→ passes"}
            </li>
          ))}
        </ul>
      </Panel>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Syndrome" value={syndrome} sub={syndrome ? `sum of failing checks: ${failing.join(" + ")}` : "all checks pass"} />
        <Stat label="Corrected data" value={fixedData} sub={wrong ? `sent ${data}: wrong` : "matches what was sent"} />
        <Stat label="Overhead" value={`${enc.checkPositions.length} / ${enc.code.length} bits`} sub="2^r ≥ m + r + 1" />
      </div>
      <Explain tone={wrong ? "bad" : syndrome ? "good" : "neutral"}>
        {flipped.size >= 2
          ? `${flipped.size} bits flipped. The syndrome is ${syndrome}, ${syndrome ? `so the receiver "corrects" bit ${syndrome}` : "so the receiver sees no error"}${wrong ? " and delivers the wrong data" : ""}. A Hamming code corrects one error, not two; an extra overall parity bit (SECDED) would at least detect the second.`
          : syndrome
            ? `The failing checks add up to ${syndrome}: bit ${syndrome} flipped, and the receiver flips it back. Now flip a second bit.`
            : "No check fails, so the receiver accepts the data as it is. Click a bit to damage it."}
      </Explain>
    </div>
  );
}

function ChecksumTab() {
  const [text, setText] = useState("4500 0073 0000 4000 4011 0000 c0a8 0001 c0a8 00c7");
  const [bits, setBits] = useState("1011001");
  const words = text
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((w) => parseInt(w, 16));
  const valid = words.length > 0 && words.length <= 24 && words.every((w) => Number.isInteger(w) && w >= 0 && w <= 0xffff);
  const res = valid ? internetChecksum(words) : null;
  return (
    <div className="space-y-4">
      <Panel title="Internet checksum (IPv4, TCP, UDP)">
        <Field label="16-bit words in hex (checksum field as 0000)">
          <input className={cn(inputCls, "w-full max-w-xl")} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="Hex words" />
        </Field>
        {res ? (
          <>
            <div className="mt-3 overflow-x-auto thin-scroll">
              <table className="min-w-[320px] font-mono text-[12.5px]">
                <thead>
                  <tr className="text-left text-[11px] tracking-wide text-subtle uppercase">
                    <th className="py-1 pr-4 font-medium">Add word</th>
                    <th className="py-1 pr-4 font-medium">Running sum</th>
                    <th className="py-1 font-medium">Carry folded in?</th>
                  </tr>
                </thead>
                <tbody>
                  {res.steps.map((s, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-0.5 pr-4">{hex4(s.word)}</td>
                      <td className="py-0.5 pr-4">{hex4(s.sum)}</td>
                      <td className="py-0.5">{s.carried ? "yes, +1" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Stat label="One's-complement sum" value={hex4(res.sum)} />
              <Stat label="Checksum (inverted)" value={hex4(res.checksum)} sub="written into the header" />
            </div>
          </>
        ) : (
          <div className="mt-2">
            <Explain tone="warn">Enter up to 24 hex words of at most 4 digits.</Explain>
          </div>
        )}
      </Panel>
      <Panel title="Parity bit">
        <Field label="Data bits">
          <input className={cn(inputCls, "w-48")} value={bits} onChange={(e) => setBits(e.target.value.trim())} spellCheck={false} aria-label="Parity data bits" />
        </Field>
        {isBits(bits) && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Stat label="Even parity bit" value={parityBit(bits, true)} sub={`${[...bits].filter((b) => b === "1").length} ones`} />
            <Stat label="Odd parity bit" value={parityBit(bits, false)} />
          </div>
        )}
      </Panel>
    </div>
  );
}

export default function ErrorDetection() {
  const [tab, setTab] = useState<Tab>("crc");
  return (
    <div className="space-y-4">
      <Segmented
        ariaLabel="View"
        value={tab}
        onChange={setTab}
        options={[
          { value: "crc", label: "CRC" },
          { value: "hamming", label: "Hamming code" },
          { value: "checksum", label: "Checksum & parity" },
        ]}
      />
      {tab === "crc" ? <CrcTab /> : tab === "hamming" ? <HammingTab /> : <ChecksumTab />}
    </div>
  );
}
