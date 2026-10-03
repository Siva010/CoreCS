"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { BookmarkCheck, CalendarClock, Play, TrendingDown, History } from "lucide-react";
import { useManifest } from "@/components/providers/Providers";
import { useHydrated, useProgress } from "@/lib/progress/store";
import { suggestedRevisions, weakTopics } from "@/lib/progress/mastery";
import { formatDue } from "@/lib/progress/srs";
import { cn, SUBJECT_STYLE, timeAgo } from "@/lib/utils";
import type { SubjectId } from "@/lib/content/types";

function Card({ title, icon: Icon, children, right }: { title: string; icon: typeof History; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Icon className="h-4 w-4 text-accent" /> {title}
        </h2>
        {right}
      </div>
      {children}
    </div>
  );
}

export function RevisionDashboard() {
  const manifest = useManifest();
  const hydrated = useHydrated((s) => s.hydrated);
  const state = useProgress();
  const [subject, setSubject] = useState<SubjectId>("os");
  const now = Date.now();

  const due = useMemo(() => (hydrated ? Object.entries(state.questions).filter(([, q]) => q.srs.due <= now) : []), [hydrated, state.questions, now]);
  const upcoming = useMemo(
    () =>
      hydrated
        ? Object.values(state.questions)
            .filter((q) => q.srs.due > now)
            .sort((a, b) => a.srs.due - b.srs.due)
            .slice(0, 1)
        : [],
    [hydrated, state.questions, now],
  );
  const suggestions = hydrated ? suggestedRevisions(manifest, state, now) : [];
  const weak = hydrated ? weakTopics(manifest, state, now) : [];
  const bookmarks = hydrated ? state.bookmarks.filter((b) => b.startsWith("lesson:")).map((b) => manifest.lessons.find((l) => l.id === b.slice(7))).filter(Boolean) : [];
  const lessons = manifest.lessons.filter((l) => l.subject === subject);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Spaced-repetition queue" icon={CalendarClock}>
        <div className="flex items-end gap-3">
          <div className="font-mono text-4xl font-semibold text-fg">{due.length}</div>
          <div className="pb-1 text-[13px] text-muted">
            questions due now
            {upcoming[0] && <div className="text-subtle">next one {formatDue(upcoming[0].srs.due, now)}</div>}
          </div>
        </div>
        <Link
          href="/interview?mode=due"
          className={cn("mt-4 inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold", due.length ? "bg-accent text-accent-fg" : "pointer-events-none border border-border text-subtle")}
        >
          <Play className="h-4 w-4" /> Start review
        </Link>
        <p className="mt-3 text-[12.5px] text-subtle">Questions enter the queue when you grade them in a lesson or drill.</p>
      </Card>

      <Card title="Weak topics" icon={TrendingDown}>
        {weak.length ? (
          <ul className="space-y-2">
            {weak.map((w) => (
              <li key={w.lesson.id} className="flex items-center justify-between gap-3 text-[14px]">
                <Link href={`${w.lesson.href}?mode=15`} className="text-fg hover:text-accent">
                  {w.lesson.title}
                </Link>
                <span className="shrink-0 text-[12px] text-warn">{w.reason}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13.5px] text-subtle">No weak topics detected yet. They appear when your self-graded answers for a concept average below 60% or you forget answers repeatedly.</p>
        )}
      </Card>

      <Card title="Due for a refresher" icon={History}>
        {suggestions.length ? (
          <ul className="space-y-2">
            {suggestions.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 text-[14px]">
                <span className="text-fg">{l.title}</span>
                <span className="flex shrink-0 gap-1">
                  {(["5", "15", "30"] as const).map((m) => (
                    <Link key={m} href={`${l.href}?mode=${m}`} className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[11.5px] text-muted hover:text-accent">
                      {m}m
                    </Link>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13.5px] text-subtle">Lessons you completed more than two weeks ago (and haven&apos;t revised since) show up here.</p>
        )}
      </Card>

      <Card title="Bookmarked concepts" icon={BookmarkCheck}>
        {bookmarks.length ? (
          <ul className="space-y-1.5">
            {bookmarks.map((l) => (
              <li key={l!.id}>
                <Link href={l!.href} className="text-[14px] text-fg hover:text-accent">
                  {l!.title}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13.5px] text-subtle">Bookmark lessons with the Bookmark button to collect them here.</p>
        )}
      </Card>

      <div className="rounded-2xl border border-border bg-surface p-5 lg:col-span-2">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-fg">Time-boxed revision by lesson</h2>
          <div className="flex flex-wrap gap-1.5">
            {manifest.subjects.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSubject(s.id)}
                className={cn("rounded-full border px-3 py-1 text-[12.5px] font-medium", subject === s.id ? cn(SUBJECT_STYLE[s.id].border, SUBJECT_STYLE[s.id].bg, SUBJECT_STYLE[s.id].text) : "border-border text-muted")}
              >
                {s.short}
              </button>
            ))}
          </div>
        </div>
        <div className="max-h-[480px] overflow-y-auto thin-scroll">
          <table className="w-full text-[13.5px]">
            <tbody className="divide-y divide-border">
              {lessons.map((l) => {
                const p = hydrated ? state.lessons[l.id] : undefined;
                return (
                  <tr key={l.id}>
                    <td className="py-2 pr-3 font-mono text-[11.5px] text-subtle">L{l.level}</td>
                    <td className="py-2 pr-3">
                      <Link href={l.href} className="text-fg hover:text-accent">
                        {l.title}
                      </Link>
                      {p?.lastRevisedAt && <span className="ml-2 text-[11.5px] text-subtle">revised {timeAgo(p.lastRevisedAt)}</span>}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {(["5", "15", "30"] as const).map((m) => (
                        <Link key={m} href={`${l.href}?mode=${m}`} className="ml-1 rounded-md border border-border px-1.5 py-0.5 font-mono text-[11.5px] text-muted hover:text-accent">
                          {m}m
                        </Link>
                      ))}
                      <Link href={l.href} className="ml-1 rounded-md border border-border px-1.5 py-0.5 text-[11.5px] text-muted hover:text-accent">
                        deep
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
