// Lists every glossary mark in OS lessons with the sentence around it, for review.
import { getAllLessons, renderLesson } from "../src/lib/content/loader";

type Node = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: Node[] };
const text = (n: Node): string => (n.type === "text" ? n.value ?? "" : (n.children ?? []).map(text).join(""));

const subject = process.argv[2] ?? "os";
let total = 0;
for (const l of getAllLessons().filter((x) => x.subject === subject)) {
  const r = await renderLesson(l.id);
  if (!r) continue;
  const hits: string[] = [];
  const walk = (n: Node, para: Node | null) => {
    const p = n.type === "element" && ["p", "li", "td"].includes(n.tagName ?? "") ? n : para;
    if (n.type === "element" && n.tagName === "x-term") {
      const ctx = p ? text(p) : "";
      const word = text(n);
      const i = ctx.indexOf(word);
      hits.push(`  ${String(n.properties?.term).padEnd(22)} …${ctx.slice(Math.max(0, i - 50), i + word.length + 40).replace(/\s+/g, " ")}…`);
    }
    for (const c of n.children ?? []) walk(c, p);
  };
  for (const s of r.sections) walk(s.hast as Node, null);
  if (r.intro) walk(r.intro as Node, null);
  total += hits.length;
  console.log(`${l.id} (${hits.length})\n${hits.join("\n")}`);
}
console.log("total marks", total);
