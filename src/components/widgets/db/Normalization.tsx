"use client";
import { useMemo, useState } from "react";
import { Explain, Field, Panel, inputCls } from "../ui";
import { cn } from "@/lib/utils";

interface FD {
  lhs: string[];
  rhs: string[];
}

export const PRESETS = [
  {
    label: "Enrollment (partial dependency)",
    attrs: "student_id, course_id, student_name, course_title, instructor, grade",
    fds: "student_id -> student_name\ncourse_id -> course_title, instructor\nstudent_id, course_id -> grade",
  },
  { label: "Transitive dependency", attrs: "A, B, C, D", fds: "A -> B\nA -> C\nC -> D" },
  { label: "3NF but not BCNF (Teaching)", attrs: "student, subject, teacher", fds: "teacher -> subject\nstudent, subject -> teacher" },
  { label: "Several candidate keys", attrs: "A, B, C, D", fds: "A, B -> C\nC -> D\nD -> A" },
];

export function parseAttrs(s: string) {
  return [...new Set(s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean))];
}

function parseSide(s: string, attrs: string[]) {
  const parts = s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
  // Allow "AB" shorthand when every attribute is a single character.
  if (parts.length === 1 && !attrs.includes(parts[0]) && attrs.every((a) => a.length === 1)) return parts[0].split("").filter((c) => attrs.includes(c));
  return parts;
}

export function parseFds(text: string, attrs: string[]): { fds: FD[]; errors: string[] } {
  const fds: FD[] = [];
  const errors: string[] = [];
  for (const line of text.split(/[\n;]/).map((l) => l.trim()).filter(Boolean)) {
    const m = line.split(/->|→/);
    if (m.length !== 2) {
      errors.push(`Can't read "${line}" — use the form A, B -> C`);
      continue;
    }
    const lhs = parseSide(m[0], attrs);
    const rhs = parseSide(m[1], attrs);
    const unknown = [...lhs, ...rhs].filter((a) => !attrs.includes(a));
    if (unknown.length) {
      errors.push(`"${line}" uses unknown attribute(s): ${unknown.join(", ")}`);
      continue;
    }
    if (!lhs.length || !rhs.length) continue;
    fds.push({ lhs, rhs });
  }
  return { fds, errors };
}

export function closure(x: string[], fds: FD[]) {
  const set = new Set(x);
  let grew = true;
  while (grew) {
    grew = false;
    for (const fd of fds) {
      if (fd.lhs.every((a) => set.has(a)) && fd.rhs.some((a) => !set.has(a))) {
        for (const a of fd.rhs) set.add(a);
        grew = true;
      }
    }
  }
  return [...set];
}

const isSuper = (x: string[], attrs: string[], fds: FD[]) => closure(x, fds).length === attrs.length;
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const subsets = <T,>(arr: T[], size: number): T[][] => (size === 0 ? [[]] : arr.flatMap((v, i) => subsets(arr.slice(i + 1), size - 1).map((s) => [v, ...s])));

export function candidateKeys(attrs: string[], fds: FD[]) {
  const onRight = new Set(fds.flatMap((f) => f.rhs));
  const onLeft = new Set(fds.flatMap((f) => f.lhs));
  const must = attrs.filter((a) => !onRight.has(a)); // nothing determines these
  const never = attrs.filter((a) => onRight.has(a) && !onLeft.has(a)); // appear only on the right
  const middle = attrs.filter((a) => !must.includes(a) && !never.includes(a));
  const keys: string[][] = [];
  if (isSuper(must, attrs, fds)) return [must.sort()];
  for (let size = 1; size <= Math.min(middle.length, 4); size++) {
    for (const extra of subsets(middle, size)) {
      const cand = [...must, ...extra];
      if (!isSuper(cand, attrs, fds)) continue;
      if (keys.some((k) => k.every((a) => cand.includes(a)))) continue; // not minimal
      keys.push(cand.sort());
    }
    if (keys.length && size >= 2) break; // minimal keys found at the smallest sizes
  }
  return keys.length ? keys : [attrs.slice().sort()];
}

interface Analysis {
  keys: string[][];
  prime: string[];
  violations2: { fd: FD; why: string }[];
  violations3: { fd: FD; why: string }[];
  violationsB: { fd: FD; why: string }[];
  form: "BCNF" | "3NF" | "2NF" | "1NF";
}

export function analyze(attrs: string[], fds: FD[]): Analysis {
  const keys = candidateKeys(attrs, fds);
  const prime = [...new Set(keys.flat())];
  const nontrivial = fds.flatMap((fd) => fd.rhs.filter((a) => !fd.lhs.includes(a)).map((a) => ({ lhs: fd.lhs, rhs: [a] })));
  const violationsB: { fd: FD; why: string }[] = [];
  const violations3: { fd: FD; why: string }[] = [];
  const violations2: { fd: FD; why: string }[] = [];
  for (const fd of nontrivial) {
    const superKey = isSuper(fd.lhs, attrs, fds);
    const rhsPrime = prime.includes(fd.rhs[0]);
    if (!superKey) {
      violationsB.push({ fd, why: `${fd.lhs.join(",")} is not a super key` });
      if (!rhsPrime) {
        violations3.push({ fd, why: `${fd.lhs.join(",")} is not a super key and ${fd.rhs[0]} is not prime (transitive dependency)` });
        const partial = keys.some((k) => fd.lhs.every((a) => k.includes(a)) && fd.lhs.length < k.length);
        if (partial) violations2.push({ fd, why: `${fd.rhs[0]} depends on ${fd.lhs.join(",")}, a proper subset of the candidate key ${keys.find((k) => fd.lhs.every((a) => k.includes(a)))!.join(",")} (partial dependency)` });
      }
    }
  }
  const form = violations2.length ? "1NF" : violations3.length ? "2NF" : violationsB.length ? "3NF" : "BCNF";
  return { keys, prime, violations2, violations3, violationsB, form };
}

/** Classic BCNF decomposition: split on a violating FD until every relation is in BCNF. */
export function bcnfDecompose(attrs: string[], fds: FD[]) {
  const out: { attrs: string[]; because?: string }[] = [];
  const work: string[][] = [attrs];
  let guard = 0;
  while (work.length && guard++ < 20) {
    const R = work.pop()!;
    const localFds = fds.filter((fd) => [...fd.lhs, ...fd.rhs].every((a) => R.includes(a)));
    const violating = localFds.find((fd) => {
      const extra = fd.rhs.filter((a) => !fd.lhs.includes(a));
      return extra.length > 0 && closure(fd.lhs, localFds).length < R.length;
    });
    if (!violating || R.length <= 2) {
      out.push({ attrs: R.slice().sort() });
      continue;
    }
    const x = closure(violating.lhs, localFds).filter((a) => R.includes(a));
    const rest = [...violating.lhs, ...R.filter((a) => !x.includes(a))];
    out.push({ attrs: x.slice().sort(), because: `${violating.lhs.join(",")} → ${violating.rhs.join(",")} violated BCNF here` });
    work.push([...new Set(rest)]);
  }
  return out;
}

/** A dependency is preserved if its RHS is reachable using only per-relation closures. */
export function preserved(fd: FD, pieces: string[][], fds: FD[]) {
  let z = [...fd.lhs];
  let grew = true;
  while (grew) {
    grew = false;
    for (const R of pieces) {
      const inR = z.filter((a) => R.includes(a));
      const add = closure(inR, fds).filter((a) => R.includes(a) && !z.includes(a));
      if (add.length) {
        z = [...z, ...add];
        grew = true;
      }
    }
  }
  return fd.rhs.every((a) => z.includes(a));
}

export default function Normalization() {
  const [attrText, setAttrText] = useState(PRESETS[0].attrs);
  const [fdText, setFdText] = useState(PRESETS[0].fds);
  const [probe, setProbe] = useState("student_id");

  const attrs = useMemo(() => parseAttrs(attrText), [attrText]);
  const { fds, errors } = useMemo(() => parseFds(fdText, attrs), [fdText, attrs]);
  const a = useMemo(() => analyze(attrs, fds), [attrs, fds]);
  const probeSet = useMemo(() => parseSide(probe, attrs).filter((x) => attrs.includes(x)), [probe, attrs]);
  const probeClosure = useMemo(() => closure(probeSet, fds).sort(), [probeSet, fds]);
  const decomposition = useMemo(() => (a.form === "BCNF" ? [] : bcnfDecompose(attrs, fds)), [a.form, attrs, fds]);
  const lost = useMemo(() => (decomposition.length ? fds.filter((fd) => !preserved(fd, decomposition.map((d) => d.attrs), fds)) : []), [decomposition, fds]);

  const fdStr = (fd: FD) => `${fd.lhs.join(", ")} → ${fd.rhs.join(", ")}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => { setAttrText(p.attrs); setFdText(p.fds); setProbe(parseAttrs(p.attrs)[0]); }} className="rounded-full border border-border px-3 py-1 text-[12.5px] text-muted hover:text-fg">
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Attributes (comma separated)">
          <input className={cn(inputCls, "w-full")} value={attrText} onChange={(e) => setAttrText(e.target.value)} />
        </Field>
        <Field label="Functional dependencies (one per line, A, B -> C)">
          <textarea className={cn(inputCls, "h-24 w-full resize-y py-2")} value={fdText} onChange={(e) => setFdText(e.target.value)} spellCheck={false} />
        </Field>
      </div>
      {errors.length > 0 && <Explain tone="bad">{errors.join(" · ")}</Explain>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Attribute closure">
          <div className="flex flex-wrap items-end gap-2">
            <input className={cn(inputCls, "w-48")} value={probe} onChange={(e) => setProbe(e.target.value)} aria-label="Attribute set" />
            <span className="pb-1.5 font-mono text-[13px]">
              {"{"}
              {probeSet.join(", ")}
              {"}"}
              <sup>+</sup> = {"{"}
              {probeClosure.join(", ")}
              {"}"}
            </span>
          </div>
          <p className="mt-2 text-[12.5px] text-muted">
            {probeSet.length === 0
              ? "Enter one or more attributes."
              : probeClosure.length === attrs.length
                ? a.keys.some((k) => sameSet(k, probeSet))
                  ? "This is a candidate key: it determines everything and nothing can be removed."
                  : "This is a super key (it determines every attribute), but not minimal."
                : `Determines ${probeClosure.length} of ${attrs.length} attributes — not a super key.`}
          </p>
        </Panel>

        <Panel title="Keys">
          <div className="space-y-1.5 text-[13px]">
            <div>
              <span className="text-subtle">Candidate keys: </span>
              <span className="font-mono">{a.keys.map((k) => `{${k.join(", ")}}`).join("  ") || "—"}</span>
            </div>
            <div>
              <span className="text-subtle">Prime attributes: </span>
              <span className="font-mono">{a.prime.join(", ") || "—"}</span>
            </div>
            <div>
              <span className="text-subtle">Non-prime: </span>
              <span className="font-mono">{attrs.filter((x) => !a.prime.includes(x)).join(", ") || "—"}</span>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Highest normal form" right={<span className={cn("rounded-full px-2.5 py-0.5 text-[12px] font-semibold", a.form === "BCNF" ? "bg-ok/15 text-ok" : a.form === "3NF" ? "bg-accent/15 text-accent" : "bg-warn/15 text-warn")}>{a.form}</span>}>
        <ul className="space-y-2 text-[13px]">
          <li className={cn(a.violations2.length ? "text-warn" : "text-muted")}>
            <strong>2NF</strong> — {a.violations2.length ? "violated: " : "holds: no non-prime attribute depends on part of a candidate key."}
            {a.violations2.map((v, i) => (
              <span key={i} className="block font-mono text-[12px]">
                {fdStr(v.fd)} — {v.why}
              </span>
            ))}
          </li>
          <li className={cn(a.violations3.length ? "text-warn" : "text-muted")}>
            <strong>3NF</strong> — {a.violations3.length ? "violated: " : "holds: every determinant is a super key, or the dependent attribute is prime."}
            {a.violations3.map((v, i) => (
              <span key={i} className="block font-mono text-[12px]">
                {fdStr(v.fd)} — {v.why}
              </span>
            ))}
          </li>
          <li className={cn(a.violationsB.length ? "text-warn" : "text-muted")}>
            <strong>BCNF</strong> — {a.violationsB.length ? "violated: " : "holds: every non-trivial determinant is a super key."}
            {a.violationsB.map((v, i) => (
              <span key={i} className="block font-mono text-[12px]">
                {fdStr(v.fd)} — {v.why}
              </span>
            ))}
          </li>
        </ul>
      </Panel>

      {decomposition.length > 0 && (
        <Panel title="BCNF decomposition">
          <ul className="space-y-1.5 font-mono text-[13px]">
            {decomposition.map((d, i) => (
              <li key={i}>
                R{i + 1}({d.attrs.join(", ")})
                {d.because && <span className="ml-2 font-sans text-[12px] text-subtle">{d.because}</span>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12.5px] text-muted">
            The decomposition is lossless (each split keeps the determinant in both halves, and it is a key of one of them).{" "}
            {lost.length ? (
              <span className="text-warn">
                Dependency preservation is lost for: {lost.map(fdStr).join("; ")} — no single relation can enforce it any more. That is the price BCNF sometimes charges, and why 3NF is often
                preferred.
              </span>
            ) : (
              <span className="text-ok">Every functional dependency can still be checked inside one relation.</span>
            )}
          </p>
        </Panel>
      )}

      <Explain>
        Load &ldquo;Enrollment&rdquo;: the key is {"{"}student_id, course_id{"}"}, and student_name depends on only part of it — a partial dependency, so the table is only in 1NF. The
        &ldquo;3NF but not BCNF&rdquo; preset shows the opposite corner: teacher → subject is allowed by 3NF (subject is prime) but not by BCNF, and decomposing it loses a dependency.
      </Explain>
    </div>
  );
}
