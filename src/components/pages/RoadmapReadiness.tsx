"use client";
import Link from "next/link";
import { useManifest } from "@/components/providers/Providers";
import { useHydrated, useProgress } from "@/lib/progress/store";
import { roadmapReadiness, LABEL_STYLE } from "@/lib/progress/mastery";
import { MeterBar } from "@/components/progress/ProgressBits";
import { cn } from "@/lib/utils";

export function RoadmapReadiness({ roadmapId, compact }: { roadmapId: string; compact?: boolean }) {
  const manifest = useManifest();
  const hydrated = useHydrated((s) => s.hydrated);
  const state = useProgress();
  const rm = manifest.roadmaps.find((r) => r.id === roadmapId);
  if (!rm) return null;
  const r = roadmapReadiness(manifest, state, rm.lessons);
  const score = hydrated ? r.score : 0;

  if (compact) {
    return (
      <div>
        <div className="mb-1 flex justify-between text-[12px] text-subtle">
          <span>Interview readiness</span>
          <span className="font-mono">{score}%</span>
        </div>
        <MeterBar value={score} />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <div className="text-[12px] font-semibold tracking-wider text-subtle uppercase">Interview readiness for this roadmap</div>
        <div className="font-mono text-xl font-semibold">{score}%</div>
      </div>
      <MeterBar value={score} className="mt-2" />
      <div className="mt-2 text-[13px] text-muted">
        {hydrated ? r.completed : 0}/{r.total} lessons completed · {hydrated ? r.attempted : 0} answers graded · status:{" "}
        <span className={cn("font-medium", LABEL_STYLE[hydrated ? r.label : "Not started"])}>{hydrated ? r.label : "Not started"}</span>
      </div>
      <p className="mt-3 text-[12.5px] text-subtle">
        Readiness blends completed lessons with the quality of your self-graded answers. It measures preparation for the <em>conceptual</em> part of interviews — not
        experience.
      </p>
      {hydrated && r.gaps.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-[12px] font-semibold tracking-wider text-subtle uppercase">Biggest gaps ({r.gaps.length})</div>
          <ul className="max-h-72 space-y-1 overflow-y-auto pr-1 text-[13.5px] thin-scroll">
            {r.gaps.slice(0, 25).map((g) => (
              <li key={g.lesson.id} className="flex justify-between gap-3">
                <Link href={g.lesson.href} className="text-fg hover:text-accent">
                  {g.lesson.title}
                </Link>
                <span className="shrink-0 text-[12px] text-subtle">{g.why}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
