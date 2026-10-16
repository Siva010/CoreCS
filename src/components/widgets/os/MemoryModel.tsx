"use client";
import { useState } from "react";
import { TESTS, opText, outcomes, shown, type Mode } from "@/lib/sim/litmus";
import { Explain, Panel, Segmented } from "../ui";
import { cn } from "@/lib/utils";

const MODE_LABEL: Record<Mode, string> = { plain: "plain", final: "final field", "release-acquire": "release / acquire", volatile: "volatile" };

export default function MemoryModel() {
  const [testId, setTestId] = useState(TESTS[0].id);
  const t = TESTS.find((x) => x.id === testId)!;
  const [modeByTest, setModeByTest] = useState<Record<string, Mode>>({});
  const mode = modeByTest[t.id] ?? "plain";
  const [code1, code2] = t.code[mode]!;
  const verdict = t.verdict[mode]!;
  const outs = outcomes(t);
  const label = (r: Record<string, number>) => t.regs.map((g) => `${g} = ${shown(t, g, r)}`).join(", ");

  return (
    <div className="space-y-4">
      <Segmented ariaLabel="Litmus test" value={testId} onChange={setTestId} options={TESTS.map((x) => ({ value: x.id, label: x.name }))} />
      <Explain>{t.intro}</Explain>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-medium text-muted">Shared variables are</span>
        <Segmented
          ariaLabel="Access mode"
          size="sm"
          value={mode}
          onChange={(m) => setModeByTest((s) => ({ ...s, [t.id]: m }))}
          options={t.modes.map((m) => ({ value: m, label: MODE_LABEL[m] }))}
        />
      </div>

      <Panel title="The program" right={<span className="text-[11px] text-subtle">all fields start at 0 (null)</span>}>
        <pre className="mb-3 overflow-x-auto rounded-md bg-surface-2 px-3 py-2 font-mono text-[12.5px] leading-relaxed text-fg thin-scroll">{t.decl[mode]}</pre>
        <div className="grid gap-2 sm:grid-cols-2">
          {[code1, code2].map((c, i) => (
            <div key={i}>
              <div className="mb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">Thread {i + 1}</div>
              <pre className="overflow-x-auto rounded-md border border-border px-3 py-2 font-mono text-[12.5px] leading-relaxed text-fg thin-scroll">{c}</pre>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Every outcome">
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full min-w-[520px] text-[13px]">
            <thead>
              <tr className="text-left text-[11px] tracking-wide text-subtle uppercase">
                <th className="py-1 pr-3 font-medium">Outcome</th>
                <th className="py-1 pr-3 font-medium">Interleavings that produce it</th>
                <th className="py-1 font-medium">Allowed in Java?</th>
              </tr>
            </thead>
            <tbody>
              {outs.map((o) => (
                <tr key={label(o.result)} className={cn("border-t border-border align-top", o.relaxed && (verdict.allowed ? "bg-bad/10" : "bg-ok/10"))}>
                  <td className="py-1.5 pr-3 font-mono whitespace-nowrap">{label(o.result)}</td>
                  <td className="py-1.5 pr-3 font-mono text-[12px] text-muted">
                    {o.relaxed ? (
                      <span className="font-sans text-fg">none: no interleaving of the four steps gives this</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {o.runs.map((run, i) => (
                          <li key={i}>
                            {run.order.map(({ thread, op }, k) => (
                              <span key={k}>
                                {k > 0 && <span className="text-subtle"> → </span>}
                                <span className={thread === 0 ? "text-accent" : "text-warn"}>{opText(op)}</span>
                              </span>
                            ))}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="py-1.5 font-medium">
                    {o.relaxed ? <span className={verdict.allowed ? "text-bad" : "text-ok"}>{verdict.allowed ? "Yes" : "No"}</span> : <span className="text-ok">Yes</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[12px] text-subtle">
          <span className="text-accent">Thread 1</span> and <span className="text-warn">thread 2</span> steps. Reading the threads as interleaved one step at a time (sequential consistency) only ever gives the
          outcomes above the highlighted row.
        </p>
      </Panel>

      <Explain tone={verdict.allowed ? "bad" : "good"}>
        <b>
          {label(t.relaxed)} with {mode === "final" ? "a final field" : `${MODE_LABEL[mode]} accesses`}: {verdict.allowed ? "allowed." : "forbidden."}
        </b>{" "}
        {verdict.why}
      </Explain>

      {mode === "plain" && (
        <Panel title="Where plain accesses show it in hardware">
          <ul className="space-y-1 text-[13px]">
            <li>
              <b>x86:</b> {t.hardware.x86}
            </li>
            <li>
              <b>ARM:</b> {t.hardware.arm}
            </li>
          </ul>
          <p className="mt-2 text-[12.5px] text-muted">The JMM is what counts: the JIT compiler may reorder plain accesses on any CPU, so code that is only correct on x86 is still broken Java.</p>
        </Panel>
      )}
      <p className="text-[12.5px] text-subtle">
        These are the classic litmus tests that OpenJDK&apos;s jcstress harness runs millions of times on real hardware. Declaring a field final, volatile or reading it through a VarHandle changes which
        outcomes the JVM must rule out, and so which fences the JIT emits.
      </p>
    </div>
  );
}
