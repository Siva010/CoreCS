"use client";
import { useEffect, useState } from "react";
import { SECTION_MIN_MODE, type SectionKey } from "@/lib/content/types";
import { cn } from "@/lib/utils";
import { sectionVisible, useLessonMode } from "./LessonShell";

export function LessonToc({ sections }: { sections: { key: SectionKey; title: string }[] }) {
  const { mode } = useLessonMode();
  const visible = sections.filter((s) => sectionVisible(SECTION_MIN_MODE[s.key], mode));
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const els = visible.map((s) => document.getElementById(s.key)).filter((e): e is HTMLElement => !!e);
    const obs = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: "-120px 0px -65% 0px" },
    );
    els.forEach((e) => obs.observe(e));
    return () => obs.disconnect();
  }, [visible.map((s) => s.key).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <nav aria-label="On this page" className="text-xs">
      <p className="eyebrow mb-3">On this page</p>
      <ul className="space-y-0.5 border-l border-border">
        {visible.map((s) => (
          <li key={s.key}>
            <a
              href={`#${s.key}`}
              className={cn(
                "-ml-px block border-l py-1 pl-3 transition-colors",
                active === s.key ? "border-current font-medium text-accent" : "border-transparent text-subtle hover:text-muted",
              )}
            >
              {s.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
