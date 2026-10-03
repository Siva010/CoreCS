import { toJsxRuntime, type Components } from "hast-util-to-jsx-runtime";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import type { Root } from "hast";
import { Callout, Compare, DepthBlock, Details, LabCard, SmartLink, Steps, Table } from "./blocks";
import { Pre } from "./CodeBlock";
import { Mermaid } from "./Mermaid";
import { AnswerReveal } from "./AnswerReveal";
import { VizEmbed } from "./VizEmbed";

const components = {
  "x-callout": Callout,
  "x-depth": DepthBlock,
  "x-details": Details,
  "x-compare": Compare,
  "x-steps": Steps,
  "x-answer": AnswerReveal,
  "x-viz": VizEmbed,
  "x-lab": LabCard,
  "x-mermaid": Mermaid,
  pre: Pre,
  table: Table,
  a: SmartLink,
} as unknown as Partial<Components>;

/** Renders a hast tree (from the content loader) with the academy's components. */
export function Rendered({ hast }: { hast: Root }) {
  return toJsxRuntime(hast, { Fragment, jsx, jsxs, components, ignoreInvalidStyle: true });
}

export function Prose({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`prose prose-academy ${className}`}>{children}</div>;
}
