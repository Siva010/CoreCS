"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Clock, Layers } from "lucide-react";
import { useHydrated, useProgress } from "@/lib/progress/store";
import { DEPTHS, REVISION_MODES, type Depth, type RevisionMode } from "@/lib/content/types";
import { cn, DEPTH_META } from "@/lib/utils";

const ModeContext = createContext<{ mode: RevisionMode; maxDepth: Depth }>({ mode: "deep", maxDepth: "senior" });
export const useLessonMode = () => useContext(ModeContext);

const MODE_RANK: Record<RevisionMode, number> = { "5": 0, "15": 1, "30": 2, deep: 3 };

export function sectionVisible(min: RevisionMode, mode: RevisionMode) {
  return MODE_RANK[min] <= MODE_RANK[mode];
}

export function LessonShell({ lessonId, children }: { lessonId: string; children: ReactNode }) {
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

  return (
    <ModeContext.Provider value={{ mode, maxDepth }}>
      <div data-mode={mode} data-maxdepth={maxDepth}>
        <div className="no-print sticky top-14 z-30 -mx-4 mb-8 border-b border-border bg-bg/90 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-subtle" />
              <span className="hidden text-[12px] font-medium text-subtle sm:inline">Revision mode</span>
              <div role="radiogroup" aria-label="Revision mode" className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5">
                {REVISION_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={mode === m.id}
                    title={m.blurb}
                    onClick={() => chooseMode(m.id)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors",
                      mode === m.id ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Layers className="h-3.5 w-3.5 text-subtle" />
              <span className="hidden text-[12px] font-medium text-subtle sm:inline">Show depth up to</span>
              <div role="radiogroup" aria-label="Maximum depth" className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5">
                {DEPTHS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={maxDepth === d}
                    title={DEPTH_META[d].blurb}
                    onClick={() => chooseDepth(d)}
                    className={cn(
                      "flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] font-medium transition-colors",
                      maxDepth === d ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
                    )}
                  >
                    <span aria-hidden className="text-[8px]">{DEPTH_META[d].emoji}</span>
                    {DEPTH_META[d].short}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {mode !== "deep" && (
            <p className="mt-1.5 text-[12px] text-subtle">{REVISION_MODES.find((m) => m.id === mode)?.blurb} Switch to Deep Dive for the full lesson.</p>
          )}
        </div>
        {children}
      </div>
    </ModeContext.Provider>
  );
}
