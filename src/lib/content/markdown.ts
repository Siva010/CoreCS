// Markdown pipeline shared by the site and the validation script.
//
// Authoring conventions (see CONTENT_GUIDE.md):
//   :::callout{type=warning}[Optional title]   -> <Callout>
//   :::depth{level=advanced}                    -> content marked as Advanced depth
//   :::answer / :::solution                     -> answer part of a question
//   :::details[Title] / :::compare[Title] / :::steps
//   ::viz{id=tcp-handshake}                     -> embedded interactive widget
//   ::lab{id=cpu-scheduler}                     -> link card to a lab
//   ```mermaid                                  -> diagram rendered client-side
//   [text](lesson:os-paging) / (lab:x) / (viz:x) / (case:x) / (uth:x) / (trap:x)
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import rehypeHighlight from "rehype-highlight";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import { toString } from "mdast-util-to-string";
import type { Root, RootContent, Parent, Link, Code, Paragraph } from "mdast";
import type { Root as HastRoot } from "hast";
import type { ContainerDirective, LeafDirective, TextDirective } from "mdast-util-directive";
import { VFile } from "vfile";

export type RenderMode = "react" | "html";
/** Returns an href for a scheme:id link, or null if the target does not exist. */
export type LinkResolver = (scheme: string, id: string) => string | null;

const LINK_SCHEME = /^(lesson|lab|viz|case|uth|trap):([a-z0-9-]+)(#[\w-]+)?$/;

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkDirective);

export function parseMarkdown(src: string): Root {
  return parser.parse(src) as Root;
}

interface CustomOptions {
  mode: RenderMode;
  resolve: LinkResolver;
  onBrokenLink?: (href: string, ctx: string) => void;
}

type DirectiveNode = ContainerDirective | LeafDirective;

function directiveLabel(node: ContainerDirective): string | undefined {
  const first = node.children[0] as Paragraph | undefined;
  if (first && first.type === "paragraph" && (first.data as { directiveLabel?: boolean } | undefined)?.directiveLabel) {
    node.children.shift();
    return toString(first);
  }
  return undefined;
}

function remarkCustom(options: CustomOptions) {
  const { mode, resolve } = options;
  return (tree: Root, file: VFile) => {
    const onBrokenLink = (href: string) => options.onBrokenLink?.(href, String(file.data.ctx ?? ""));
    // Text directives (":name") are never used intentionally; turn them back
    // into literal text so prose like "key:value" survives.
    visit(tree, "textDirective", (node: TextDirective, index, parent) => {
      if (!parent || index === undefined) return;
      const label = node.children.length ? `[${toString(node)}]` : "";
      (parent as Parent).children.splice(index, 1, { type: "text", value: `:${node.name}${label}` });
    });

    visit(tree, (node, index, parent) => {
      if (node.type === "code" && (node as Code).lang === "mermaid" && parent && index !== undefined) {
        const code = node as Code;
        const replacement =
          mode === "react"
            ? { type: "mermaidDiagram", data: { hName: "x-mermaid", hProperties: { chart: code.value } } }
            : { type: "code", lang: "text", value: code.value };
        (parent as Parent).children.splice(index, 1, replacement as unknown as RootContent);
        return;
      }

      if (node.type === "link") {
        const link = node as Link;
        const m = LINK_SCHEME.exec(link.url);
        if (m) {
          const href = resolve(m[1], m[2]);
          if (href) link.url = href + (m[3] ?? "");
          else {
            onBrokenLink?.(link.url);
            link.url = "#";
          }
        }
        return;
      }

      if (node.type !== "containerDirective" && node.type !== "leafDirective") return;
      const d = node as DirectiveNode;
      const attrs: Record<string, string> = {};
      for (const [k, v] of Object.entries(d.attributes ?? {})) if (v != null) attrs[k] = String(v);
      const title = d.type === "containerDirective" ? directiveLabel(d) : undefined;
      if (title) attrs.title = title;
      const data = (d.data ??= {});

      if (d.type === "leafDirective") {
        const id = attrs.id ?? "";
        if (d.name === "viz" || d.name === "lab") {
          const href = resolve(d.name === "viz" ? "viz" : "lab", id);
          if (!href) onBrokenLink?.(`${d.name}:${id}`);
          if (mode === "react") {
            data.hName = d.name === "viz" ? "x-viz" : "x-lab";
            data.hProperties = { id, ...attrs };
          } else {
            data.hName = "p";
            data.hChildren = [
              { type: "element", tagName: "a", properties: { href: href ?? "#" }, children: [{ type: "text", value: `Open the interactive ${d.name === "viz" ? "visualization" : "lab"} →` }] },
            ];
          }
        } else {
          data.hName = "div";
        }
        return;
      }

      // Container directives
      const known = ["callout", "depth", "answer", "solution", "details", "compare", "steps"];
      const name = known.includes(d.name) ? d.name : "callout";
      if (mode === "react") {
        data.hName = name === "solution" ? "x-answer" : `x-${name}`;
        data.hProperties = attrs;
      } else {
        const cls =
          name === "callout" ? `md-callout md-callout-${attrs.type ?? "note"}` : name === "depth" ? `md-depth md-depth-${attrs.level ?? "advanced"}` : `md-${name}`;
        data.hName = "div";
        data.hProperties = { className: cls.split(" ") };
        if (title) {
          d.children.unshift({ type: "paragraph", children: [{ type: "strong", children: [{ type: "text", value: title }] }] });
        }
      }
    });
  };
}

const HIGHLIGHT_OPTIONS = {
  detect: false,
  plainText: ["text", "txt", "plain", "console", "http", "ascii", "diagram", "output"],
  aliases: { bash: ["sh", "shell-session"], sql: ["psql", "postgresql", "mysql"] },
};

export interface Renderer {
  /** ctx labels diagnostics (e.g. the lesson id) for broken-link reports. */
  toHast(nodes: RootContent[], ctx?: string): Promise<HastRoot>;
  toHtml(nodes: RootContent[], ctx?: string): Promise<string>;
}

export function createRenderer(resolve: LinkResolver, onBrokenLink?: (href: string, ctx: string) => void): Renderer {
  const hastProcessor = unified()
    .use(remarkCustom, { mode: "react", resolve, onBrokenLink })
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeHighlight, HIGHLIGHT_OPTIONS)
    .freeze();

  const htmlProcessor = unified()
    .use(remarkCustom, { mode: "html", resolve, onBrokenLink })
    .use(remarkRehype)
    .use(rehypeHighlight, HIGHLIGHT_OPTIONS)
    .use(rehypeStringify)
    .freeze();

  return {
    async toHast(nodes, ctx = "") {
      const tree: Root = { type: "root", children: structuredClone(nodes) };
      return (await hastProcessor.run(tree, new VFile({ data: { ctx } }))) as HastRoot;
    },
    async toHtml(nodes, ctx = "") {
      const tree: Root = { type: "root", children: structuredClone(nodes) };
      const hast = await htmlProcessor.run(tree, new VFile({ data: { ctx } }));
      return String(htmlProcessor.stringify(hast as HastRoot));
    },
  };
}

/** Split a document into an intro (before the first H2) and H2 sections. */
export function splitByHeading(nodes: RootContent[], depth: 2 | 3): { intro: RootContent[]; parts: { heading: string; nodes: RootContent[] }[] } {
  const intro: RootContent[] = [];
  const parts: { heading: string; nodes: RootContent[] }[] = [];
  for (const node of nodes) {
    if (node.type === "heading" && node.depth === depth) {
      parts.push({ heading: toString(node).trim(), nodes: [] });
    } else if (parts.length) {
      parts[parts.length - 1].nodes.push(node);
    } else {
      intro.push(node);
    }
  }
  return { intro, parts };
}

/** Split a question body into (prompt extras, answer) at a :::answer / :::solution directive. */
export function splitAnswer(nodes: RootContent[]): { prompt: RootContent[]; answer: RootContent[]; explicit: boolean } {
  const idx = nodes.findIndex(
    (n) => n.type === "containerDirective" && ((n as ContainerDirective).name === "answer" || (n as ContainerDirective).name === "solution"),
  );
  if (idx === -1) return { prompt: [], answer: nodes, explicit: false };
  const dir = nodes[idx] as ContainerDirective;
  return {
    prompt: nodes.slice(0, idx),
    answer: [...(dir.children as RootContent[]), ...nodes.slice(idx + 1)],
    explicit: true,
  };
}

export function plainText(nodes: RootContent[]): string {
  return nodes
    .map((n) => (n.type === "code" ? "" : toString(n)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[`'"’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
