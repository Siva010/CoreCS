"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import MiniSearch from "minisearch";
import { Activity, BookOpen, CornerDownLeft, FlaskConical, Layers, MessagesSquare, Search, Siren, TriangleAlert } from "lucide-react";
import { useUi } from "@/components/providers/Providers";
import { cn, SUBJECT_STYLE } from "@/lib/utils";
import type { SubjectId } from "@/lib/content/types";

interface Doc {
  id: string;
  type: string;
  title: string;
  text: string;
  href: string;
  subject: string;
  context: string;
}

const TYPE_ICON: Record<string, typeof BookOpen> = {
  lesson: BookOpen,
  question: MessagesSquare,
  lab: FlaskConical,
  viz: Activity,
  case: Siren,
  walkthrough: Layers,
  trap: TriangleAlert,
};

const TYPE_BOOST: Record<string, number> = { lesson: 1.6, walkthrough: 1.3, lab: 1.2, viz: 1.2, case: 1.1, trap: 1.1, question: 0.9 };

let cached: Promise<MiniSearch<Doc>> | null = null;

function loadIndex() {
  cached ??= fetch("/search-index.json")
    .then((r) => r.json() as Promise<Doc[]>)
    .then((docs) => {
      const ms = new MiniSearch<Doc>({
        fields: ["title", "text", "context"],
        storeFields: ["type", "title", "href", "subject", "context"],
        searchOptions: { boost: { title: 3, context: 0.5 }, prefix: true, fuzzy: 0.15, combineWith: "AND" },
      });
      ms.addAll(docs);
      return ms;
    });
  return cached;
}

export function CommandPalette() {
  const { searchOpen, setSearchOpen } = useUi();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [index, setIndex] = useState<MiniSearch<Doc> | null>(null);
  const [error, setError] = useState(false);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!searchOpen) return;
    loadIndex().then(setIndex, () => setError(true));
    setTimeout(() => inputRef.current?.focus(), 10);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSearchOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen, setSearchOpen]);

  const results = useMemo(() => {
    if (!index || q.trim().length < 2) return [];
    let r = index.search(q.trim());
    if (r.length < 3) r = index.search(q.trim(), { combineWith: "OR" });
    return r
      .map((x) => ({ ...x, score: x.score * (TYPE_BOOST[x.type as string] ?? 1) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 30) as unknown as (Doc & { score: number })[];
  }, [index, q]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!searchOpen) return null;

  const go = (href: string) => {
    setSearchOpen(false);
    setQ("");
    router.push(href);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[10vh]" role="dialog" aria-modal="true" aria-label="Search">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setSearchOpen(false)} />
      <div className="relative w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="h-4 w-4 text-subtle" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter" && results[sel]) {
                go(results[sel].href);
              }
            }}
            placeholder="Search lessons, interview questions, labs, case studies…"
            className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-subtle"
            aria-label="Search query"
          />
          <kbd className="rounded border border-border px-1.5 font-mono text-[10px] text-subtle">Esc</kbd>
        </div>
        <ul ref={listRef} className="max-h-[60vh] overflow-y-auto p-2 thin-scroll" role="listbox">
          {error && <li className="p-4 text-sm text-bad">Could not load the search index.</li>}
          {!index && !error && <li className="p-4 text-sm text-subtle">Loading index…</li>}
          {index && q.trim().length < 2 && (
            <li className="p-4 text-sm text-subtle">
              Try <span className="text-fg">“TIME_WAIT”</span>, <span className="text-fg">“page fault”</span>, <span className="text-fg">“write skew”</span> or{" "}
              <span className="text-fg">“covering index”</span>.
            </li>
          )}
          {index && q.trim().length >= 2 && !results.length && <li className="p-4 text-sm text-subtle">No results for “{q}”.</li>}
          {results.map((r, i) => {
            const Icon = TYPE_ICON[r.type] ?? BookOpen;
            const style = SUBJECT_STYLE[(r.subject as SubjectId) ?? "x"] ?? SUBJECT_STYLE.x;
            return (
              <li key={r.id} data-idx={i} role="option" aria-selected={i === sel}>
                <button
                  type="button"
                  onMouseEnter={() => setSel(i)}
                  onClick={() => go(r.href)}
                  className={cn("flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left", i === sel ? "bg-surface-2" : "")}
                >
                  <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", style.text)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">{r.title}</span>
                    <span className="block truncate text-xs text-subtle">{r.context}</span>
                  </span>
                  {i === sel && <CornerDownLeft className="mt-1 h-3.5 w-3.5 text-subtle" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
