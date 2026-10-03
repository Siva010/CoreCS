"use client";
import { useRef, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

function langOf(children: ReactNode): string | null {
  const child = Array.isArray(children) ? children[0] : children;
  const cls = (child as { props?: { className?: string } })?.props?.className ?? "";
  const m = /language-([\w-]+)/.exec(cls);
  return m ? m[1] : null;
}

const LANG_LABEL: Record<string, string> = { sql: "SQL", bash: "shell", sh: "shell", c: "C", cpp: "C++", java: "Java", python: "Python", js: "JavaScript", javascript: "JavaScript", ts: "TypeScript", typescript: "TypeScript", go: "Go", rust: "Rust", text: "", http: "HTTP", json: "JSON", yaml: "YAML" };

export function Pre({ children, ...rest }: React.HTMLAttributes<HTMLPreElement>) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const lang = langOf(children);
  const label = lang ? (LANG_LABEL[lang] ?? lang) : "";
  return (
    <div className="group relative my-5">
      {label && <span className="pointer-events-none absolute top-2 right-12 font-mono text-[10.5px] tracking-wide text-subtle uppercase">{label}</span>}
      <button
        type="button"
        aria-label="Copy code"
        onClick={() => {
          navigator.clipboard?.writeText(ref.current?.innerText ?? "").then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="absolute top-1.5 right-1.5 grid h-7 w-7 place-items-center rounded-md border border-border bg-surface text-subtle opacity-0 transition-opacity group-hover:opacity-100 hover:text-fg focus:opacity-100"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <pre ref={ref} {...rest} className="thin-scroll overflow-x-auto">
        {children}
      </pre>
    </div>
  );
}
