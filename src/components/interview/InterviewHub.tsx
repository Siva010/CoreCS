"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Layers3, ListFilter, Mic, Play, Search } from "lucide-react";
import { useManifest } from "@/components/providers/Providers";
import { useHydrated, useProgress } from "@/lib/progress/store";
import { QUESTION_LEVEL_LABELS, QUESTION_TYPE_LABELS, type QuestionData, type QuestionLevel, type QuestionType, type SubjectId } from "@/lib/content/types";
import { loadQuestions, shuffle } from "@/lib/progress/questionData";
import { cn, SUBJECT_STYLE } from "@/lib/utils";
import { DrillSession } from "./DrillSession";
import { LEVEL_STYLE } from "@/components/lesson/QuestionCard";

export interface QIndexItem {
  id: string;
  lessonId: string;
  subject: SubjectId;
  level: number;
  qLevel: QuestionLevel;
  type: QuestionType;
  prompt: string;
}

type Mode = "drill" | "mock" | "due" | "browse";

function Chip({ on, onClick, children, className }: { on: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors",
        on ? "border-fg bg-fg text-bg" : "border-border bg-surface text-muted hover:text-fg",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function InterviewHub({ index }: { index: QIndexItem[] }) {
  const manifest = useManifest();
  const hydrated = useHydrated((s) => s.hydrated);
  const qProgress = useProgress((s) => s.questions);
  const [mode, setMode] = useState<Mode>("drill");
  const [subject, setSubject] = useState<SubjectId | "all">("all");
  const [levels, setLevels] = useState<number[]>([]); // curriculum levels within subject
  const [lessonId, setLessonId] = useState<string>("");
  const [qLevels, setQLevels] = useState<QuestionLevel[]>([1, 2, 3, 4]);
  const [types, setTypes] = useState<QuestionType[]>([]);
  const [order, setOrder] = useState<"shuffle" | "curriculum">("shuffle");
  const [limit, setLimit] = useState<number>(10);
  const [unseenOnly, setUnseenOnly] = useState(false);
  const [text, setText] = useState("");
  const [session, setSession] = useState<{ title: string; questions: QuestionData[]; source: "drill" | "mock" | "review"; timed: boolean } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const s = p.get("subject") as SubjectId | null;
    if (s && ["os", "cn", "db", "x"].includes(s)) setSubject(s);
    const l = p.get("lesson");
    if (l) {
      const les = manifest.lessons.find((x) => x.id === l);
      if (les) {
        setSubject(les.subject);
        setLessonId(l);
      }
    }
    const m = p.get("mode") as Mode | null;
    if (m && ["drill", "mock", "due", "browse"].includes(m)) setMode(m);
  }, [manifest]);

  const subj = subject === "all" ? null : manifest.subjects.find((s) => s.id === subject)!;
  const lessonsInScope = manifest.lessons.filter((l) => (subject === "all" || l.subject === subject) && (!levels.length || levels.includes(l.level)));

  const filtered = useMemo(() => {
    const lessonSet = new Set(lessonId ? [lessonId] : lessonsInScope.map((l) => l.id));
    const t = text.trim().toLowerCase();
    return index.filter(
      (q) =>
        lessonSet.has(q.lessonId) &&
        qLevels.includes(q.qLevel) &&
        (!types.length || types.includes(q.type)) &&
        (!unseenOnly || !qProgress[q.id]?.attempts.length) &&
        (!t || q.prompt.toLowerCase().includes(t)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, subject, levels, lessonId, qLevels, types, unseenOnly, text, qProgress]);

  const due = useMemo(() => {
    if (!hydrated) return [];
    const now = Date.now();
    return index.filter((q) => qProgress[q.id] && qProgress[q.id].srs.due <= now);
  }, [hydrated, index, qProgress]);

  const presentTypes = [...new Set(index.filter((q) => subject === "all" || q.subject === subject).map((q) => q.type))];

  async function start(kind: "drill" | "mock" | "due") {
    setLoading(true);
    try {
      let pick: QIndexItem[];
      let title: string;
      if (kind === "due") {
        pick = shuffle(due).slice(0, 30);
        title = "Spaced-repetition review";
      } else if (kind === "mock") {
        const pool = shuffle(filtered);
        const plan: [QuestionLevel, number][] = [[1, 2], [2, 2], [3, 2], [4, 1]];
        pick = plan.flatMap(([lv, n]) => pool.filter((q) => q.qLevel === lv).slice(0, n));
        const scopeName = lessonId ? manifest.lessons.find((l) => l.id === lessonId)?.title : subj ? subj.title : "Mixed subjects";
        title = `Mock interview · ${scopeName}`;
      } else {
        const base = order === "shuffle" ? shuffle(filtered) : filtered;
        pick = limit ? base.slice(0, limit) : base;
        title = lessonId ? `Drill · ${manifest.lessons.find((l) => l.id === lessonId)?.title}` : subj ? `Drill · ${subj.title}` : "Drill · All subjects";
      }
      const subjects = [...new Set(pick.map((q) => q.subject))];
      const data = await loadQuestions(subjects);
      const byId = new Map(data.map((q) => [q.id, q]));
      const questions = pick.map((q) => byId.get(q.id)).filter((q): q is QuestionData => !!q);
      setSession({ title, questions, source: kind === "due" ? "review" : kind, timed: kind === "mock" });
      window.scrollTo({ top: 0 });
    } finally {
      setLoading(false);
    }
  }

  if (session) return <DrillSession {...session} onExit={() => setSession(null)} />;

  const lessonTitle = (id: string) => manifest.lessons.find((l) => l.id === id);

  return (
    <div>
      <div className="mb-6 grid gap-2 sm:grid-cols-4">
        {(
          [
            ["drill", "Drill a topic", ListFilter, "Pick scope, levels and question types."],
            ["mock", "Mock interview", Mic, "Escalates Basic → Senior Touch with a speaking timer."],
            ["due", "Due for review", CalendarClock, `${hydrated ? due.length : 0} questions scheduled now.`],
            ["browse", "Browse the bank", Search, `${index.length} questions across all subjects.`],
          ] as const
        ).map(([id, label, Icon, blurb]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            className={cn(
              "rounded-xl border p-3 text-left transition-colors",
              mode === id ? "border-accent bg-accent/5" : "border-border bg-surface hover:border-border-strong",
            )}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-fg">
              <Icon className="h-4 w-4 text-accent" /> {label}
            </div>
            <div className="mt-0.5 text-[12.5px] text-muted">{blurb}</div>
          </button>
        ))}
      </div>

      {mode === "due" ? (
        <div className="rounded-2xl border border-border bg-surface p-6">
          <h2 className="text-lg font-semibold">Spaced-repetition review</h2>
          <p className="mt-1 text-[14px] text-muted">
            Every question you grade is scheduled: <em>Again</em> returns in 10 minutes, <em>Good</em> in 1 → 3 → ~8 days and growing. Reviewing just before you would
            forget is the most efficient way to keep 500+ answers fresh.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              disabled={!due.length || loading}
              onClick={() => start("due")}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg disabled:opacity-40"
            >
              <Play className="h-4 w-4" /> Review {Math.min(due.length, 30)} due question{due.length === 1 ? "" : "s"}
            </button>
            {!due.length && <span className="text-sm text-subtle">Nothing due. Grade questions in lessons or drills to build your queue.</span>}
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-5 rounded-2xl border border-border bg-surface p-4 lg:sticky lg:top-20 lg:self-start">
            <div>
              <div className="mb-2 text-[11px] font-semibold tracking-wider text-subtle uppercase">Subject</div>
              <div className="flex flex-wrap gap-1.5">
                <Chip on={subject === "all"} onClick={() => { setSubject("all"); setLevels([]); setLessonId(""); }}>All</Chip>
                {manifest.subjects.map((s) => (
                  <Chip key={s.id} on={subject === s.id} onClick={() => { setSubject(s.id); setLevels([]); setLessonId(""); }}>
                    <span className={cn("mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle", SUBJECT_STYLE[s.id].dot)} />
                    {s.short}
                  </Chip>
                ))}
              </div>
            </div>
            {subj && (
              <div>
                <div className="mb-2 text-[11px] font-semibold tracking-wider text-subtle uppercase">Topics (levels)</div>
                <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto thin-scroll">
                  {subj.levels
                    .filter((lv) => manifest.lessons.some((l) => l.subject === subj.id && l.level === lv.n))
                    .map((lv) => (
                      <Chip
                        key={lv.n}
                        on={levels.includes(lv.n)}
                        onClick={() => {
                          setLessonId("");
                          setLevels((ls) => (ls.includes(lv.n) ? ls.filter((x) => x !== lv.n) : [...ls, lv.n]));
                        }}
                        className="text-[11.5px]"
                      >
                        L{lv.n} {lv.title}
                      </Chip>
                    ))}
                </div>
              </div>
            )}
            {subj && (
              <div>
                <div className="mb-2 text-[11px] font-semibold tracking-wider text-subtle uppercase">Single concept</div>
                <select
                  value={lessonId}
                  onChange={(e) => setLessonId(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-[13px] outline-none focus:border-accent"
                >
                  <option value="">Any concept in scope</option>
                  {lessonsInScope.map((l) => (
                    <option key={l.id} value={l.id}>
                      L{l.level} · {l.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <div className="mb-2 text-[11px] font-semibold tracking-wider text-subtle uppercase">Question level</div>
              <div className="flex flex-wrap gap-1.5">
                {([1, 2, 3, 4] as QuestionLevel[]).map((l) => (
                  <Chip key={l} on={qLevels.includes(l)} onClick={() => setQLevels((xs) => (xs.includes(l) ? xs.filter((x) => x !== l) : [...xs, l].sort()))}>
                    L{l} {QUESTION_LEVEL_LABELS[l]}
                  </Chip>
                ))}
              </div>
            </div>
            {mode !== "mock" && (
              <div>
                <div className="mb-2 text-[11px] font-semibold tracking-wider text-subtle uppercase">Question type</div>
                <div className="flex flex-wrap gap-1.5">
                  {presentTypes.map((t) => (
                    <Chip key={t} on={types.includes(t)} onClick={() => setTypes((xs) => (xs.includes(t) ? xs.filter((x) => x !== t) : [...xs, t]))} className="text-[11.5px]">
                      {QUESTION_TYPE_LABELS[t]}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
            <label className="flex items-center gap-2 text-[13px] text-muted">
              <input type="checkbox" checked={unseenOnly} onChange={(e) => setUnseenOnly(e.target.checked)} className="accent-[var(--accent)]" />
              Only questions I haven&apos;t answered
            </label>
          </div>

          <div className="min-w-0">
            {mode === "browse" ? (
              <div>
                <div className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-surface px-3">
                  <Search className="h-4 w-4 text-subtle" />
                  <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter question text…" className="h-10 flex-1 bg-transparent text-sm outline-none" />
                  <span className="font-mono text-[12px] text-subtle">{filtered.length}</span>
                </div>
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                  {filtered.slice(0, 400).map((q) => {
                    const l = lessonTitle(q.lessonId);
                    const p = hydrated ? qProgress[q.id] : undefined;
                    return (
                      <li key={q.id}>
                        <Link href={`${l?.href}#${q.id}`} className="flex items-start gap-3 px-4 py-2.5 hover:bg-surface-2/60">
                          <span className={cn("mt-0.5 shrink-0 rounded-full border px-1.5 font-mono text-[10.5px] font-semibold", LEVEL_STYLE[q.qLevel])}>L{q.qLevel}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[14px] text-fg">{q.prompt}</span>
                            <span className="block text-[12px] text-subtle">
                              {l?.title} · {QUESTION_TYPE_LABELS[q.type]}
                              {p ? ` · answered ${p.attempts.length}×` : ""}
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                {filtered.length > 400 && <p className="mt-2 text-[12px] text-subtle">Showing first 400 — narrow the filters.</p>}
              </div>
            ) : (
              <div className="rounded-2xl border border-border bg-surface p-6">
                <div className="flex items-center gap-2">
                  <Layers3 className="h-5 w-5 text-accent" />
                  <h2 className="text-lg font-semibold">{mode === "mock" ? "Mock interview" : "Topic drill"}</h2>
                </div>
                <p className="mt-2 text-[14px] text-muted">
                  {mode === "mock"
                    ? "Seven questions that escalate like a real interview: two Basic, two Intermediate, two Advanced and one Senior-Touch question. A timer shows suggested speaking time. Answer out loud, reveal, and grade yourself honestly."
                    : "Questions are shown one at a time. Say your answer out loud (or write it) before revealing the model answer, then grade yourself. Grades schedule each question for spaced review and feed your mastery estimates."}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-4 text-[13px] text-muted">
                  <span>
                    <span className="font-mono text-lg font-semibold text-fg">{filtered.length}</span> questions match
                  </span>
                  {mode === "drill" && (
                    <>
                      <label className="flex items-center gap-2">
                        Order
                        <select value={order} onChange={(e) => setOrder(e.target.value as "shuffle" | "curriculum")} className="h-8 rounded-lg border border-border bg-surface px-2">
                          <option value="shuffle">Shuffled</option>
                          <option value="curriculum">Curriculum order</option>
                        </select>
                      </label>
                      <label className="flex items-center gap-2">
                        Length
                        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="h-8 rounded-lg border border-border bg-surface px-2">
                          <option value={5}>5</option>
                          <option value={10}>10</option>
                          <option value={20}>20</option>
                          <option value={0}>All</option>
                        </select>
                      </label>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  disabled={!filtered.length || loading}
                  onClick={() => start(mode === "mock" ? "mock" : "drill")}
                  className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg disabled:opacity-40"
                >
                  <Play className="h-4 w-4" /> {loading ? "Loading…" : mode === "mock" ? "Start mock interview" : "Start drill"}
                </button>
                <div className="mt-6 grid gap-2 sm:grid-cols-2">
                  {([1, 2, 3, 4] as QuestionLevel[]).map((l) => (
                    <div key={l} className="rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-[12.5px]">
                      <span className={cn("mr-2 rounded-full border px-1.5 font-mono text-[10.5px] font-semibold", LEVEL_STYLE[l])}>L{l}</span>
                      <span className="text-muted">{filtered.filter((q) => q.qLevel === l).length} {QUESTION_LEVEL_LABELS[l]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
