"use client";
import Link from "next/link";
import { Bookmark, BookmarkCheck, Check, CircleCheck, RotateCcw, TriangleAlert } from "lucide-react";
import { useHydrated, useProgress } from "@/lib/progress/store";
import { useManifest } from "@/components/providers/Providers";
import { useLessonMode } from "./LessonShell";
import { cn } from "@/lib/utils";

export function BookmarkButton({ bkey, label = "Bookmark", className }: { bkey: string; label?: string; className?: string }) {
  const hydrated = useHydrated((s) => s.hydrated);
  const bookmarked = useProgress((s) => s.bookmarks.includes(bkey));
  const toggle = useProgress((s) => s.toggleBookmark);
  const on = hydrated && bookmarked;
  return (
    <button
      type="button"
      onClick={() => toggle(bkey)}
      aria-pressed={on}
      title={on ? "Remove bookmark" : "Bookmark"}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
        on ? "border-accent/40 bg-accent-soft text-accent" : "border-border text-muted hover:border-border-strong hover:text-fg",
        className,
      )}
    >
      {on ? <BookmarkCheck className="size-3.5" /> : <Bookmark className="size-3.5" />}
      {label && <span>{on ? "Bookmarked" : label}</span>}
    </button>
  );
}

export function CompleteButton({ id, title, href, size = "md" }: { id: string; title: string; href: string; size?: "md" | "lg" }) {
  const hydrated = useHydrated((s) => s.hydrated);
  const completedAt = useProgress((s) => s.lessons[id]?.completedAt);
  const complete = useProgress((s) => s.completeLesson);
  const uncomplete = useProgress((s) => s.uncompleteLesson);
  const done = hydrated && !!completedAt;
  return (
    <button
      type="button"
      onClick={() => (done ? uncomplete(id) : complete(id, title, href))}
      aria-pressed={done}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border font-medium transition-colors",
        size === "lg" ? "h-9 px-4 text-sm" : "h-8 px-3 text-xs",
        done ? "border-ok/40 bg-ok/10 text-ok" : "border-fg bg-fg text-bg hover:opacity-90",
      )}
    >
      {done ? <CircleCheck className="size-3.5" /> : <Check className="size-3.5" />}
      {done ? "Completed" : "Mark as complete"}
    </button>
  );
}

export function RevisedButton({ id, title, href }: { id: string; title: string; href: string }) {
  const { mode } = useLessonMode();
  const markRevised = useProgress((s) => s.markRevised);
  const hydrated = useHydrated((s) => s.hydrated);
  const last = useProgress((s) => s.lessons[id]?.lastRevisedAt);
  if (mode === "deep") return null;
  const recent = hydrated && last && Date.now() - last < 60_000;
  return (
    <button
      type="button"
      onClick={() => markRevised(id, mode, title, href)}
      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-4 text-sm font-medium text-fg hover:border-border-strong"
    >
      <RotateCcw className="size-3.5" />
      {recent ? "Revision logged" : `Log ${mode}-minute revision`}
    </button>
  );
}

export function PrereqStatus({ prerequisites }: { prerequisites: string[] }) {
  const manifest = useManifest();
  const hydrated = useHydrated((s) => s.hydrated);
  const lessons = useProgress((s) => s.lessons);
  if (!prerequisites.length) return <span className="text-xs text-subtle">None — start here.</span>;
  const items = prerequisites.map((id) => manifest.lessons.find((l) => l.id === id)).filter((l) => !!l);
  const missing = hydrated ? items.filter((l) => !lessons[l!.id]?.completedAt) : [];
  return (
    <div>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((l) => {
          const done = hydrated && !!lessons[l!.id]?.completedAt;
          return (
            <li key={l!.id}>
              <Link
                href={l!.href}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors",
                  done ? "border-ok/40 bg-ok/10 text-fg" : "border-border text-muted hover:border-border-strong hover:text-fg",
                )}
              >
                {done && <Check className="h-3 w-3 text-ok" />}
                {l!.title}
              </Link>
            </li>
          );
        })}
      </ul>
      {hydrated && missing.length > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-warn">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {missing.length === items.length
            ? "You haven't completed the prerequisites yet. This lesson assumes them — skim them first if anything feels unfamiliar."
            : `Recommended first: ${missing.map((l) => l!.title).join(", ")}.`}
        </p>
      )}
    </div>
  );
}
