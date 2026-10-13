"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useTheme } from "next-themes";

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function Mermaid({ chart }: { chart: string }) {
  const { resolvedTheme } = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const rawId = useId();
  const id = "m" + rawId.replace(/[^a-zA-Z0-9]/g, "");

  useEffect(() => {
    let cancelled = false;
    mermaidPromise ??= import("mermaid").then((m) => m.default);
    mermaidPromise
      .then(async (mermaid) => {
        const dark = resolvedTheme === "dark";
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          // Mermaid measures label widths with this font, so it must be a real family name, not a CSS variable.
          fontFamily: `${cssVar("--font-geist") || "Geist"}, ui-sans-serif, system-ui`,
          themeVariables: {
            darkMode: dark,
            background: cssVar("--surface"),
            primaryColor: cssVar("--surface-2"),
            primaryBorderColor: cssVar("--border-strong"),
            primaryTextColor: cssVar("--fg"),
            secondaryColor: cssVar("--accent-soft"),
            tertiaryColor: cssVar("--bg-subtle"),
            lineColor: cssVar("--muted"),
            textColor: cssVar("--fg"),
            noteBkgColor: cssVar("--surface-2"),
            noteTextColor: cssVar("--fg"),
            noteBorderColor: cssVar("--warn"),
            actorBkg: cssVar("--surface-2"),
            actorBorder: cssVar("--border-strong"),
            actorTextColor: cssVar("--fg"),
            signalColor: cssVar("--fg"),
            signalTextColor: cssVar("--fg"),
            labelBoxBkgColor: cssVar("--surface-2"),
            labelTextColor: cssVar("--fg"),
            edgeLabelBackground: cssVar("--surface"),
            fontSize: "13px",
          },
        });
        const { svg } = await mermaid.render(id + (dark ? "d" : "l"), chart);
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
          setError(null);
          setReady(true);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [chart, resolvedTheme, id]);

  return (
    <figure className="not-prose my-6 overflow-x-auto rounded-lg border border-border bg-surface p-4 thin-scroll">
      {error ? (
        <div>
          <p className="text-sm text-bad">Diagram failed to render.</p>
          <pre className="mt-2 overflow-x-auto text-xs text-muted">{chart}</pre>
        </div>
      ) : (
        <>
          {!ready && <div className="h-32 animate-pulse rounded-lg bg-surface-2" aria-label="Loading diagram" />}
          <div ref={ref} className="mermaid-host flex justify-center" />
        </>
      )}
    </figure>
  );
}
