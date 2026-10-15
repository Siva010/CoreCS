"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

const CARD_WIDTH = 288;
const MARGIN = 16;

/**
 * A glossary term in lesson prose (see content/glossary.ts): dotted underline,
 * and a short plain-language definition on hover, focus or tap.
 */
export function Term({ term, def, href, children }: { term: string; def: string; href?: string; children: ReactNode }) {
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const openedAt = useRef(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (box) return;
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    // Place the card under the word, shifted just enough to stay on screen.
    const vw = document.documentElement.clientWidth;
    const width = Math.min(CARD_WIDTH, vw - 2 * MARGIN);
    const left = Math.min(Math.max(r.left, MARGIN), vw - MARGIN - width) - r.left;
    openedAt.current = Date.now();
    setBox({ left, width });
  };
  const close = () => setBox(null);
  // A short delay lets the pointer travel from the word into the card.
  const hide = () => {
    closeTimer.current = setTimeout(close, 120);
  };

  // Close on a tap or click anywhere else (not every browser moves focus to the term).
  useEffect(() => {
    if (!box) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setBox(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [box]);

  return (
    <span ref={ref} className="relative" onMouseEnter={show} onMouseLeave={hide}>
      <span
        role="button"
        tabIndex={0}
        aria-describedby={box ? id : undefined}
        aria-expanded={!!box}
        onFocus={show}
        onBlur={hide}
        // A tap focuses (opening the card) and then clicks; don't let that click close it again.
        onClick={() => (box && Date.now() - openedAt.current > 400 ? close() : show())}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
        className="cursor-help underline decoration-subtle decoration-dotted decoration-1 underline-offset-[5px] transition-colors hover:decoration-fg"
      >
        {children}
      </span>
      {box && (
        <span
          id={id}
          role="tooltip"
          style={{ left: box.left, width: box.width }}
          className="not-prose absolute top-full z-40 mt-1.5 block rounded-lg border border-border bg-surface px-3 py-2.5 text-left text-xs leading-relaxed font-normal text-muted shadow-lg"
        >
          <span className="mb-0.5 block text-2xs font-semibold tracking-[0.1em] text-fg uppercase">{term}</span>
          <span className="block">{def}</span>
          {href && (
            <Link href={href} className="mt-1.5 inline-block font-medium text-accent hover:underline">
              Learn more →
            </Link>
          )}
        </span>
      )}
    </span>
  );
}
