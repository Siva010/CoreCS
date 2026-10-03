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
    <ul className="mt-1 mb-2 ml-3 border-l border-border pl-2">
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
              className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12.5px] text-muted hover:bg-surface-2 hover:text-fg"
            >
              <ChevronRight className={cn("h-3 w-3 shrink-0 transition-transform", isOpen && "rotate-90")} />
              <span className="font-mono text-[11px] text-subtle">L{lvl.n}</span>
              <span className="truncate">{lvl.title}</span>
              <span className="ml-auto shrink-0 font-mono text-[10.5px] text-subtle">
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
                          "flex items-start gap-1.5 rounded-md px-1.5 py-1 text-[12.5px] leading-snug",
                          active ? "bg-accent/10 font-medium text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                        )}
                      >
                        {completed ? (
                          <Check className="mt-0.5 h-3 w-3 shrink-0 text-ok" aria-label="completed" />
                        ) : (
                          <Circle className="mt-0.5 h-3 w-3 shrink-0 text-border-strong" aria-hidden />
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
    <nav aria-label="Main" className="space-y-5 text-sm" onClick={(e) => {
      if ((e.target as HTMLElement).closest("a")) setNavOpen(false);
    }}>
      {NAV_SECTIONS.map((sec, i) => (
        <div key={i}>
          {sec.title && <div className="mb-1.5 px-2 text-[11px] font-semibold tracking-wider text-subtle uppercase">{sec.title}</div>}
          <ul className="space-y-0.5">
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
                      "group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors",
                      active ? "bg-surface-2 font-medium text-fg" : "text-muted hover:bg-surface-2/70 hover:text-fg",
                    )}
                  >
                    <Icon className={cn("h-4 w-4 shrink-0", item.subject ? SUBJECT_STYLE[item.subject].text : active ? "text-accent" : "text-subtle group-hover:text-fg")} />
                    <span className="truncate">{item.label}</span>
                    {item.href === "/revision" && dueCount > 0 && (
                      <span className="ml-auto rounded-full bg-accent px-1.5 py-0.5 font-mono text-[10px] leading-none text-accent-fg">{dueCount}</span>
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
    <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 overflow-y-auto border-r border-border px-3 py-5 thin-scroll lg:block">
      <SidebarNav />
    </aside>
  );
}
