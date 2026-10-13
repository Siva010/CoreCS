"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Clock, Layers } from "lucide-react";
import { useHydrated, useProgress } from "@/lib/progress/store";
import { DEPTHS, REVISION_MODES, type Depth, type RevisionMode } from "@/lib/content/types";
import { cn, DEPTH_META } from "@/lib/utils";

const ModeContext = createContext<{ mode: RevisionMode; maxDepth: Depth }>({ mode: "deep", maxDepth: "senior" });
export const useLessonMode = () => useContext(ModeContext);

const MODE_RANK: Record<RevisionMode, number> = { "5": 0, "15": 1, "30": 2, deep: 3 };
const DEPTH_RANK: Record<Depth, number> = { beginner: 0, core: 1, advanced: 2, senior: 3 };

export function sectionVisible(min: RevisionMode, mode: RevisionMode) {
  return MODE_RANK[min] <= MODE_RANK[mode];
}

/**
 * Which depth buttons this lesson should offer: the levels it actually gates,
 * plus one step below them (the "just the core lesson" option). A lesson with
 * no :::depth blocks gets no control at all, instead of four buttons that all
 * render the same page.
 */
export function depthOptions(depthBlocks: Partial<Record<Depth, number>>): Depth[] {
  const gated = DEPTHS.filter((d) => (depthBlocks[d] ?? 0) > 0);
  if (!gated.length) return [];
  const base = DEPTHS[Math.max(0, DEPTH_RANK[gated[0]] - 1)];
  return [base, ...gated];
}

export function LessonShell({ lessonId, depthBlocks = {}, children }: { lessonId: string; depthBlocks?: Partial<Record<Depth, number>>; children: ReactNode }) {
  const hydrated = useHydrated((s) => s.hydrated);
  const prefs = useProgress((s) => s.prefs);
  const setRevisionMode = useProgress((s) => s.setRevisionMode);
  const setMaxDepth = useProgress((s) => s.setMaxDepth);
  const visitLesson = useProgress((s) => s.visitLesson);
  const [mode, setMode] = useState<RevisionMode>("deep");
  const [maxDepth, setDepth] = useState<Depth>("senior");

  useEffect(() => {
    if (!hydrated) return;
    visitLesson(lessonId);
    const q = new URLSearchParams(window.location.search).get("mode") as RevisionMode | null;
    setMode(q && q in MODE_RANK ? q : prefs.revisionMode);
    setDepth(prefs.maxDepth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, lessonId]);

  const chooseMode = (m: RevisionMode) => {
    setMode(m);
    setRevisionMode(m);
    const url = new URL(window.location.href);
    if (m === "deep") url.searchParams.delete("mode");
    else url.searchParams.set("mode", m);
    window.history.replaceState(null, "", url);
  };
  const chooseDepth = (d: Depth) => {
    setDepth(d);
    setMaxDepth(d);
  };

  const options = depthOptions(depthBlocks);
  // The stored preference is global; on this page it lands on the deepest option it covers.
  const effective = options.length ? ([...options].reverse().find((d) => DEPTH_RANK[d] <= DEPTH_RANK[maxDepth]) ?? options[0]) : maxDepth;
  const hidden = options.filter((d) => DEPTH_RANK[d] > DEPTH_RANK[effective]).reduce((n, d) => n + (depthBlocks[d] ?? 0), 0);

  return (
    <ModeContext.Provider value={{ mode, maxDepth }}>
      <div data-mode={mode} data-maxdepth={maxDepth}>
        <div className="no-print sticky top-14 z-30 -mx-4 mb-8 border-b border-border bg-bg/90 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-center gap-2">
              <Clock className="size-3.5 text-subtle" />
              <span className="eyebrow hidden sm:inline">Revision</span>
              <div role="radiogroup" aria-label="Revision mode" className="inline-flex gap-0.5 rounded-lg border border-border bg-surface p-1">
                {REVISION_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={mode === m.id}
                    title={m.blurb}
                    onClick={() => chooseMode(m.id)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                      mode === m.id ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            {options.length > 1 && (
              <div className="flex items-center gap-2">
                <Layers className="size-3.5 text-subtle" />
                <span className="eyebrow hidden sm:inline">Depth</span>
                <div role="radiogroup" aria-label="Maximum depth" className="inline-flex gap-0.5 rounded-lg border border-border bg-surface p-1">
                  {options.map((d, i) => {
                    const count = depthBlocks[d] ?? 0;
                    return (
                      <button
                        key={d}
                        type="button"
                        role="radio"
                        aria-checked={effective === d}
                        title={i === 0 ? "Just the core lesson — hide the deep-dive sections" : `Reveals ${count} deep-dive section${count === 1 ? "" : "s"}. ${DEPTH_META[d].blurb}`}
                        onClick={() => chooseDepth(d)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                          effective === d ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                        )}
                      >
                        {i > 0 && <span aria-hidden className={cn("size-1.5 rounded-full bg-current", DEPTH_META[d].text)} />}
                        {i === 0 ? "Lesson" : DEPTH_META[d].short}
                        {i > 0 && <span className="text-2xs text-subtle tabular-nums">+{count}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          {mode !== "deep" && (
            <p className="mt-1.5 text-xs text-subtle">{REVISION_MODES.find((m) => m.id === mode)?.blurb} Switch to Deep Dive for the full lesson.</p>
          )}
          {hidden > 0 && (
            <p className="mt-1.5 text-xs text-subtle">
              {hidden} deep-dive section{hidden === 1 ? "" : "s"} hidden — the mechanism detail interviewers probe in follow-ups. Raise the depth to read {hidden === 1 ? "it" : "them"}.
            </p>
          )}
        </div>
        {children}
      </div>
    </ModeContext.Provider>
  );
}
