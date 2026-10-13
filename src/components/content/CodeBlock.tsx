"use client";
import { useRef, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

function langOf(children: ReactNode): string | null {
  const child = Array.isArray(children) ? children[0] : children;
  const cls = (child as { props?: { className?: string } })?.props?.className ?? "";
  const m = /language-([\w-]+)/.exec(cls);
  return m ? m[1] : null;
}

const LANG_LABEL: Record<string, string> = { sql: "SQL", bash: "Shell", sh: "Shell", c: "C", cpp: "C++", java: "Java", python: "Python", js: "JavaScript", javascript: "JavaScript", ts: "TypeScript", typescript: "TypeScript", go: "Go", rust: "Rust", text: "", http: "HTTP", json: "JSON", yaml: "YAML", cypher: "Cypher", protobuf: "Protobuf", graphql: "GraphQL" };

/** Code figure: a caption bar with the language and a copy button, as on the Learn Levels site. */
export function Pre({ children, ...rest }: React.HTMLAttributes<HTMLPreElement>) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const lang = langOf(children);
  const label = lang ? (LANG_LABEL[lang] ?? lang) : "";
  const copy = () => {
    navigator.clipboard?.writeText(ref.current?.innerText ?? "").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const button = (
    <button
      type="button"
      aria-label="Copy code"
      onClick={copy}
      className="inline-flex items-center gap-1.5 rounded border border-border bg-surface px-2 py-1 text-2xs text-subtle opacity-0 transition-all group-hover:opacity-100 hover:text-fg focus-visible:opacity-100"
    >
      {copied ? <Check className="size-3 text-ok" /> : <Copy className="size-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
  return (
    <figure className="group relative my-5 overflow-hidden rounded-lg border border-border bg-surface">
      {label ? (
        <figcaption className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <span className="font-mono text-2xs tracking-wider text-subtle uppercase">{label}</span>
          {button}
        </figcaption>
      ) : (
        <div className="absolute top-1.5 right-1.5 z-10">{button}</div>
      )}
      <pre ref={ref} {...rest} className="thin-scroll overflow-x-auto !bg-transparent">
        {children}
      </pre>
    </figure>
  );
}
