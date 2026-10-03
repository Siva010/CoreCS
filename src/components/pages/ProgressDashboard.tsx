"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Download, History, Trash2, Upload } from "lucide-react";
import { useManifest } from "@/components/providers/Providers";
import { useHydrated, useProgress, type ProgressData } from "@/lib/progress/store";
import { areaLessons, groupMastery, LABEL_STYLE, weakTopics } from "@/lib/progress/mastery";
import { bar, cn, SUBJECT_STYLE, timeAgo } from "@/lib/utils";
import { RoadmapReadiness } from "./RoadmapReadiness";
import { MeterBar } from "@/components/progress/ProgressBits";

export function ProgressDashboard() {
  const manifest = useManifest();
  const hydrated = useHydrated((s) => s.hydrated);
  const state = useProgress();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  if (!hydrated) return <div className="h-96 animate-pulse rounded-2xl bg-surface-2" />;

  const subjects = manifest.subjects;
  const totalDone = manifest.lessons.filter((l) => state.lessons[l.id]?.completedAt).length;
  const graded = Object.values(state.questions).filter((q) => q.attempts.length).length;
  const now = Date.now();
  const due = Object.values(state.questions).filter((q) => q.srs.due <= now).length;
  const weak = weakTopics(manifest, state, now);

  // Text rendition like a terminal report — handy to copy into notes.
  const report = subjects
    .filter((s) => s.id !== "x")
    .map((s) => {
      const m = groupMastery(manifest.lessons.filter((l) => l.subject === s.id), state, now);
      const areas = s.areas.map((a) => `${a.title}: ${groupMastery(areaLessons(manifest, s.id, a), state, now).label}`).join("\n");
      return `${s.short}\n${bar(m.score / 100)}  ${m.score}%\n${areas}`;
    })
    .join("\n\n");

  const exportData = () => {
    const data: ProgressData = {
      version: 1,
      lessons: state.lessons,
      questions: state.questions,
      practice: state.practice,
      bookmarks: state.bookmarks,
      history: state.history,
      prefs: state.prefs,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cs-academy-progress-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Lessons completed", `${totalDone}/${manifest.lessons.length}`],
          ["Questions graded", graded],
          ["Due for review", due],
          ["Bookmarks", state.bookmarks.length],
        ].map(([k, v]) => (
          <div key={k as string} className="rounded-xl border border-border bg-surface p-4">
            <div className="text-[12px] text-subtle">{k}</div>
            <div className="font-mono text-2xl font-semibold">{v}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {subjects.map((s) => {
          const lessons = manifest.lessons.filter((l) => l.subject === s.id);
          const m = groupMastery(lessons, state, now);
          return (
            <div key={s.id} className="rounded-2xl border border-border bg-surface p-5">
              <div className="flex items-baseline justify-between">
                <Link href={`/${s.path}`} className={cn("font-semibold hover:underline", SUBJECT_STYLE[s.id].text)}>
                  {s.title}
                </Link>
                <span className="font-mono text-lg font-semibold">{m.score}%</span>
              </div>
              <MeterBar value={m.score} className="mt-2" colorClass={SUBJECT_STYLE[s.id].dot} />
              <div className="mt-1 text-[12px] text-subtle">
                {m.completed}/{m.total} lessons · {m.attempted} graded answers{m.perf !== null ? ` · answer quality ${Math.round(m.perf * 100)}%` : ""}
              </div>
              <ul className="mt-4 space-y-2">
                {s.areas.map((a) => {
                  const am = groupMastery(areaLessons(manifest, s.id, a), state, now);
                  return (
                    <li key={a.id}>
                      <div className="flex items-center justify-between text-[13.5px]">
                        <span className="text-fg">{a.title}</span>
                        <span className={cn("font-medium", LABEL_STYLE[am.label])}>{am.label}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <MeterBar value={am.coverage * 100} className="h-1.5" colorClass="bg-border-strong" />
                        <span className="w-12 shrink-0 text-right font-mono text-[11px] text-subtle">
                          {am.completed}/{am.total}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="mb-2 text-sm font-semibold text-fg">How mastery is estimated</h2>
          <ul className="list-disc space-y-1 pl-5 text-[13.5px] text-muted">
            <li>
              <strong className="text-fg">Score</strong> = 45% lessons completed + 55% answer quality, where answer quality is scaled by how many of the area&apos;s questions
              you have actually attempted. Reading alone cannot exceed 45%.
            </li>
            <li>
              <strong className="text-fg">Strong</strong>: answer quality ≥ 80% and ≥ 60% of the area&apos;s lessons completed. <strong className="text-fg">Intermediate</strong>:
              decent answers or partial coverage. <strong className="text-fg">Needs revision</strong>: answers below 60%, many overdue reviews, or no activity for 30 days.{" "}
              <strong className="text-fg">Learning</strong>: fewer than 3 graded answers — not enough evidence yet.
            </li>
            <li>Grades are self-assessed. Be strict with yourself — the estimate is only as honest as your grading.</li>
          </ul>
          <pre className="mt-4 overflow-x-auto rounded-lg border border-border bg-surface-2 p-3 font-mono text-[12px] leading-relaxed text-fg">{report}</pre>
        </div>
        <div className="space-y-5">
          {manifest.roadmaps.map((r) => (
            <div key={r.id}>
              <div className="mb-1 text-[12px] font-semibold text-muted">
                <Link href={`/path/${r.id}`} className="hover:text-fg">
                  {r.title}
                </Link>
              </div>
              <RoadmapReadiness roadmapId={r.id} compact />
            </div>
          ))}
          <div className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="mb-2 text-sm font-semibold text-fg">Weak topics</h2>
            {weak.length ? (
              <ul className="space-y-1.5">
                {weak.map((w) => (
                  <li key={w.lesson.id} className="flex justify-between gap-3 text-[13.5px]">
                    <Link href={`${w.lesson.href}?mode=15`} className="text-fg hover:text-accent">
                      {w.lesson.title}
                    </Link>
                    <span className="text-[12px] text-warn">{w.reason}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-subtle">None detected yet.</p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
          <History className="h-4 w-4 text-accent" /> Practice history
        </h2>
        {state.history.length ? (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto thin-scroll">
            {state.history.slice(0, 100).map((h, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2 text-[13.5px]">
                <span className="min-w-0">
                  <span className="mr-2 rounded-full border border-border px-1.5 py-0.5 text-[11px] text-subtle">
                    {h.kind === "lesson-complete" ? "completed" : h.kind}
                  </span>
                  {h.href ? (
                    <Link href={h.href} className="text-fg hover:text-accent">
                      {h.title}
                    </Link>
                  ) : (
                    <span className="text-fg">{h.title}</span>
                  )}
                  {h.detail && <span className="ml-2 text-subtle">{h.detail}</span>}
                  {h.total ? (
                    <span className="ml-2 font-mono text-[12px] text-subtle">
                      {h.right}/{h.total} good
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[12px] text-subtle">{timeAgo(h.t, now)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13.5px] text-subtle">Nothing yet. Complete a lesson or run a drill in Interview Mode.</p>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-1 text-sm font-semibold text-fg">Your data</h2>
        <p className="mb-3 text-[13px] text-muted">Progress is stored only in this browser (localStorage). Export it to move between devices.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={exportData} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-surface-2">
            <Download className="h-4 w-4" /> Export JSON
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-surface-2">
            <Upload className="h-4 w-4" /> Import JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const data = JSON.parse(await f.text()) as ProgressData;
                if (data.version !== 1 || typeof data.lessons !== "object") throw new Error("Unrecognized file");
                state.importData(data);
                setMsg("Progress imported.");
              } catch (err) {
                setMsg(`Import failed: ${err instanceof Error ? err.message : "invalid file"}`);
              }
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Reset all progress, grades, bookmarks and history in this browser? This cannot be undone.")) {
                state.resetAll();
                setMsg("Progress reset.");
              }
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-bad/40 bg-bad/5 px-3 text-sm font-medium text-bad hover:bg-bad/10"
          >
            <Trash2 className="h-4 w-4" /> Reset
          </button>
        </div>
        {msg && <p className="mt-2 text-[13px] text-muted">{msg}</p>}
      </div>
    </div>
  );
}
