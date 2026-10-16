// Marks the first plain-text use of each glossary term in a lesson, so the
// renderer can show its definition on hover (see content/glossary.ts).
import type { Parent, RootContent, Text } from "mdast";
import { toString } from "mdast-util-to-string";
import { GLOSSARY, type GlossaryEntry } from "@content/glossary";

interface Matcher {
  entry: GlossaryEntry;
  res: RegExp[];
  names: string[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isAcronym = (s: string) => /^[A-Z0-9+]+$/.test(s.replace(/\s/g, ""));

const MATCHERS: Matcher[] = GLOSSARY.map((entry) => {
  const names = [entry.term, ...(entry.aliases ?? [])];
  // Acronyms match exactly ("CAP", not "caps"); words ignore case. A neighbouring
  // letter, digit or hyphen means it's part of a different word.
  const res = names.map((n) => new RegExp(`(?<![\\w-])${escape(n)}(?:e?s)?(?![\\w-])`, isAcronym(n) ? "" : "i"));
  return { entry, names, res };
});

function firstHit(m: Matcher, text: string): { index: number; text: string } | null {
  let best: { index: number; text: string } | null = null;
  for (const re of m.res) {
    const hit = re.exec(text);
    if (hit && (!best || hit.index < best.index || (hit.index === best.index && hit[0].length > best.text.length))) best = { index: hit.index, text: hit[0] };
  }
  return best;
}

// Never look inside these: code, links, headings, and bold text (bold usually *is* the definition).
const SKIP = new Set(["code", "inlineCode", "link", "linkReference", "heading", "strong", "html", "definition", "image"]);

function excluded(entry: GlossaryEntry, lessonId: string) {
  if (entry.lesson === lessonId) return true;
  if (entry.only && !entry.only.includes(lessonId)) return true;
  return (entry.exclude ?? []).some((x) => (x.endsWith("-") ? lessonId.startsWith(x) : lessonId === x));
}

/** Terms the lesson explains itself, in bold. */
function boldTerms(nodes: RootContent[]): Set<string> {
  const out = new Set<string>();
  const walk = (n: RootContent) => {
    if (n.type === "strong") out.add(toString(n).trim().toLowerCase());
    if ("children" in n) for (const c of (n as Parent).children) walk(c as RootContent);
  };
  nodes.forEach(walk);
  return out;
}

export interface TermNodeData {
  term: string;
  def: string;
  href?: string;
}

/**
 * Returns copies of the given node lists (in reading order) with the first
 * plain-text occurrence of each applicable glossary term wrapped in an
 * `x-term` element carrying its definition.
 */
export function applyGlossary(
  lists: RootContent[][],
  lessonId: string,
  hrefFor: (lessonId: string) => string | undefined,
  applies: (entry: GlossaryEntry) => boolean = () => true,
): RootContent[][] {
  const bold = boldTerms(lists.flat());
  const pending = MATCHERS.filter(
    (m) => applies(m.entry) && !excluded(m.entry, lessonId) && !m.names.some((n) => bold.has(n.toLowerCase()) || bold.has(`${n.toLowerCase()}s`)),
  );
  if (!pending.length) return lists;

  const termNode = (m: Matcher, text: string): RootContent =>
    ({
      type: "glossaryTerm",
      data: { hName: "x-term", hProperties: { term: m.entry.term, def: m.entry.def, href: hrefFor(m.entry.lesson) ?? "" } satisfies TermNodeData },
      children: [{ type: "text", value: text }],
    }) as unknown as RootContent;

  // Split one text node around the earliest remaining term (longest wins on ties), repeatedly.
  const splitText = (node: Text): RootContent[] => {
    const out: RootContent[] = [];
    let rest = node.value;
    for (;;) {
      let best: { m: Matcher; index: number; text: string } | null = null;
      for (const m of pending) {
        const hit = firstHit(m, rest);
        if (hit && (!best || hit.index < best.index || (hit.index === best.index && hit.text.length > best.text.length))) best = { m, ...hit };
      }
      if (!best) break;
      if (best.index > 0) out.push({ type: "text", value: rest.slice(0, best.index) });
      out.push(termNode(best.m, best.text));
      pending.splice(pending.indexOf(best.m), 1);
      rest = rest.slice(best.index + best.text.length);
      if (!pending.length) break;
    }
    if (rest) out.push({ type: "text", value: rest });
    return out;
  };

  const walk = (n: RootContent): RootContent => {
    if (!pending.length || SKIP.has(n.type) || !("children" in n)) return n;
    const parent = n as Parent;
    const children: RootContent[] = [];
    for (const c of parent.children as RootContent[]) {
      if (c.type === "text" && pending.length) children.push(...splitText(c));
      else children.push(walk(c));
    }
    return { ...parent, children } as RootContent;
  };

  return lists.map((nodes) => nodes.map((n) => walk(structuredClone(n))));
}
