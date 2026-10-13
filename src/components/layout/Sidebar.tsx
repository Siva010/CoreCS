"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Circle } from "lucide-react";
import { NAV_SECTIONS } from "./nav";
import { useManifest, useUi } from "@/components/providers/Providers";
import { useHydrated, useProgress } from "@/lib/progress/store";
import { cn, SUBJECT_STYLE } from "@/lib/utils";
import type { SubjectId } from "@/lib/content/types";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function CurriculumTree({ subject }: { subject: SubjectId }) {
  const manifest = useManifest();
  const pathname = usePathname();
  const hydrated = useHydrated((s) => s.hydrated);
  const lessonsProgress = useProgress((s) => s.lessons);
  const subj = manifest.subjects.find((s) => s.id === subject)!;
  const lessons = manifest.lessons.filter((l) => l.subject === subject);
  const currentLevel = lessons.find((l) => l.href === pathname)?.level;
  const [open, setOpen] = useState<Set<number>>(() => new Set(currentLevel !== undefined ? [currentLevel] : []));

  useEffect(() => {
    if (currentLevel !== undefined) setOpen((o) => (o.has(currentLevel) ? o : new Set([...o, currentLevel])));
  }, [currentLevel]);

  return (
    <ul className="mt-1 mb-2 ml-3 space-y-px border-l border-border pl-2">
      {subj.levels.map((lvl) => {
        const items = lessons.filter((l) => l.level === lvl.n);
        if (!items.length) return null;
        const isOpen = open.has(lvl.n);
        const done = hydrated ? items.filter((l) => lessonsProgress[l.id]?.completedAt).length : 0;
        return (
          <li key={lvl.n}>
            <button
              type="button"
              onClick={() => setOpen((o) => {
                const n = new Set(o);
                if (n.has(lvl.n)) n.delete(lvl.n);
                else n.add(lvl.n);
                return n;
              })}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs leading-snug text-muted transition-colors hover:bg-surface-2 hover:text-fg"
            >
              <ChevronRight className={cn("size-3 shrink-0 text-subtle transition-transform", isOpen && "rotate-90")} />
              <span className="font-mono text-2xs text-subtle tabular-nums">{String(lvl.n).padStart(2, "0")}</span>
              <span className="truncate">{lvl.title}</span>
              <span className="ml-auto shrink-0 text-2xs text-subtle tabular-nums">
                {done}/{items.length}
              </span>
            </button>
            {isOpen && (
              <ul className="mb-1 ml-4">
                {items.map((l) => {
                  const active = pathname === l.href;
                  const completed = hydrated && !!lessonsProgress[l.id]?.completedAt;
                  return (
                    <li key={l.id}>
                      <Link
                        href={l.href}
                        className={cn(
                          "flex items-start gap-1.5 rounded-md px-1.5 py-1.5 text-xs leading-snug transition-colors",
                          active ? "bg-surface-2 font-medium text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                        )}
                      >
                        {completed ? (
                          <Check className="mt-0.5 size-3 shrink-0 text-ok" aria-label="completed" />
                        ) : (
                          <Circle className="mt-0.5 size-3 shrink-0 text-border-strong" aria-hidden />
                        )}
                        <span>{l.title}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function SidebarNav() {
  const pathname = usePathname();
  const manifest = useManifest();
  const hydrated = useHydrated((s) => s.hydrated);
  const questions = useProgress((s) => s.questions);
  const { setNavOpen } = useUi();
  const dueCount = useMemo(() => {
    if (!hydrated) return 0;
    const now = Date.now();
    return Object.values(questions).filter((q) => q.srs.due <= now).length;
  }, [hydrated, questions]);

  const activeSubject = useMemo(() => {
    const lesson = manifest.lessons.find((l) => l.href === pathname);
    if (lesson) return lesson.subject;
    for (const s of manifest.subjects) if (isActive(pathname, `/${s.path}`)) return s.id;
    return undefined;
  }, [manifest, pathname]);

  return (
    <nav aria-label="Main" className="space-y-4 text-sm" onClick={(e) => {
      if ((e.target as HTMLElement).closest("a")) setNavOpen(false);
    }}>
      {NAV_SECTIONS.map((sec, i) => (
        <div key={i}>
          {sec.title && <p className="eyebrow px-2 pb-1.5">{sec.title}</p>}
          <ul className="space-y-px">
            {sec.items.map((item) => {
              const active =
                item.track === "sql"
                  ? pathname === "/databases/sql"
                  : item.subject
                    ? activeSubject === item.subject && pathname !== "/databases/sql"
                    : isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
                      active ? "bg-surface-2 font-medium text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                    )}
                  >
                    <Icon className={cn("size-4 shrink-0", item.subject ? SUBJECT_STYLE[item.subject].text : active ? "text-fg" : "text-subtle group-hover:text-fg")} />
                    <span className="truncate">{item.label}</span>
                    {item.href === "/revision" && dueCount > 0 && (
                      <span className="ml-auto rounded bg-accent px-1.5 py-0.5 text-2xs leading-none font-medium tabular-nums text-accent-fg">{dueCount}</span>
                    )}
                  </Link>
                  {item.subject && !item.track && activeSubject === item.subject && <CurriculumTree subject={item.subject} />}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar() {
  return (
    <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-72 shrink-0 overflow-y-auto border-r border-border px-3 pt-4 pb-6 thin-scroll lg:block">
      <SidebarNav />
    </aside>
  );
}
