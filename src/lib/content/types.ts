// Core content model. Content lives in /content as Markdown + frontmatter;
// these types describe what the loader produces from it.

export type SubjectId = "os" | "cn" | "db" | "x";
export type Depth = "beginner" | "core" | "advanced" | "senior";
export type Relevance = "essential" | "high" | "medium" | "low";
export type Stage = 1 | 2 | 3 | 4;

export const DEPTHS: Depth[] = ["beginner", "core", "advanced", "senior"];

export interface LevelDef {
  n: number;
  title: string;
  summary: string;
  /** Marks levels belonging to the SQL sub-track of Databases. */
  track?: "sql";
}

export interface AreaDef {
  id: string;
  title: string;
  levels: number[];
}

export interface SubjectDef {
  id: SubjectId;
  path: string; // URL segment
  title: string;
  short: string;
  tagline: string;
  description: string;
  levels: LevelDef[];
  areas: AreaDef[];
}

export interface StageDef {
  n: Stage;
  title: string;
  goal: string;
  description: string;
}

export interface RoadmapPhase {
  title: string;
  weeks: string;
  focus: string;
  lessons: string[];
  practice: string[];
}

export interface RoadmapDef {
  id: string;
  title: string;
  audience: string;
  summary: string;
  expectations: string[];
  notCovered: string[];
  phases: RoadmapPhase[];
  extras?: { title: string; body: string }[];
}

/** Canonical concept-page sections, in display order. */
export const SECTION_ORDER = [
  "mental-model",
  "definition",
  "why-it-exists",
  "how-it-works",
  "internal-mechanism",
  "example",
  "visualization",
  "performance",
  "trade-offs",
  "failure-modes",
  "in-production",
  "connections",
  "misconceptions",
  "interview-questions",
  "practice",
  "quick-revision",
] as const;

export type SectionKey = (typeof SECTION_ORDER)[number];

export const SECTION_TITLES: Record<SectionKey, string> = {
  "mental-model": "Mental Model",
  definition: "Definition",
  "why-it-exists": "Why It Exists",
  "how-it-works": "How It Works",
  "internal-mechanism": "Internal Mechanism",
  example: "Example",
  visualization: "Visualization",
  performance: "Complexity & Performance",
  "trade-offs": "Trade-offs",
  "failure-modes": "Failure Modes",
  "in-production": "In Production",
  connections: "Deeper Connections",
  misconceptions: "Common Misconceptions",
  "interview-questions": "Interview Questions",
  practice: "Practice",
  "quick-revision": "Quick Revision",
};

/** Heading text accepted in Markdown for each section (case-insensitive). */
export const SECTION_ALIASES: Record<string, SectionKey> = {
  "mental model": "mental-model",
  definition: "definition",
  "why it exists": "why-it-exists",
  "how it works": "how-it-works",
  "internal mechanism": "internal-mechanism",
  example: "example",
  examples: "example",
  "worked example": "example",
  visualization: "visualization",
  "complexity & performance": "performance",
  "complexity / performance": "performance",
  performance: "performance",
  "trade-offs": "trade-offs",
  tradeoffs: "trade-offs",
  "failure modes": "failure-modes",
  "what breaks": "failure-modes",
  "in production": "in-production",
  "production usage": "in-production",
  "deeper connections": "connections",
  connections: "connections",
  "related concepts": "connections",
  "common misconceptions": "misconceptions",
  misconceptions: "misconceptions",
  "interview questions": "interview-questions",
  practice: "practice",
  "quick revision": "quick-revision",
};

/**
 * Revision modes: which sections are shown in each time-boxed mode.
 * Deep dive shows everything.
 */
export type RevisionMode = "5" | "15" | "30" | "deep";

export const REVISION_MODES: { id: RevisionMode; label: string; blurb: string }[] = [
  { id: "5", label: "5 min", blurb: "Only the essential mental model and the revision sheet." },
  { id: "15", label: "15 min", blurb: "Key mechanisms, the definition and the diagrams." },
  { id: "30", label: "30 min", blurb: "Mechanisms, trade-offs, pitfalls and the interview questions." },
  { id: "deep", label: "Deep Dive", blurb: "The complete treatment, including advanced material." },
];

export const SECTION_MIN_MODE: Record<SectionKey, RevisionMode> = {
  "mental-model": "5",
  "quick-revision": "5",
  definition: "15",
  "how-it-works": "15",
  visualization: "15",
  "internal-mechanism": "30",
  "trade-offs": "30",
  "failure-modes": "30",
  misconceptions: "30",
  "interview-questions": "30",
  "why-it-exists": "deep",
  example: "deep",
  performance: "deep",
  "in-production": "deep",
  connections: "deep",
  practice: "deep",
};

export const QUESTION_LEVELS = [1, 2, 3, 4] as const;
export type QuestionLevel = (typeof QUESTION_LEVELS)[number];

export const QUESTION_LEVEL_LABELS: Record<QuestionLevel, string> = {
  1: "Basic",
  2: "Intermediate",
  3: "Advanced",
  4: "Senior Touch",
};

export const QUESTION_TYPES = [
  "conceptual",
  "why",
  "how",
  "what-if",
  "debugging",
  "scenario",
  "numerical",
  "trace",
  "sql",
  "optimization",
  "diagram",
  "compare",
  "design",
  "failure",
  "incident",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  conceptual: "Conceptual",
  why: "Why",
  how: "How",
  "what-if": "What happens if…",
  debugging: "Debugging",
  scenario: "Scenario",
  numerical: "Numerical",
  trace: "Trace the execution",
  sql: "SQL coding",
  optimization: "Query optimization",
  diagram: "Diagram interpretation",
  compare: "Compare & contrast",
  design: "Design",
  failure: "Failure analysis",
  incident: "Production incident",
};

export interface LessonFrontmatter {
  title: string;
  subject: SubjectId;
  level: number;
  order: number;
  summary: string;
  depth: Depth;
  difficulty: 1 | 2 | 3 | 4 | 5;
  minutes: number;
  relevance: Relevance;
  stage: Stage;
  prerequisites?: string[];
  related?: string[];
  visualizations?: string[];
  labs?: string[];
  tags?: string[];
}

export interface LessonMeta extends Required<Omit<LessonFrontmatter, "tags">> {
  id: string;
  slug: string;
  href: string;
  tags: string[];
  levelTitle: string;
  sectionKeys: SectionKey[];
  questionCount: number;
  /** Widget ids embedded inline with ::viz / ::lab anywhere in the lesson body. */
  inlineWidgets: string[];
}

export type PracticeKind = "mcq" | "numeric" | "exercise";

export interface QuestionData {
  id: string; // stable: lessonId#q-<slug>
  lessonId: string;
  subject: SubjectId;
  level: QuestionLevel;
  type: QuestionType;
  prompt: string; // plain-text question (heading)
  promptHtml?: string; // extra prompt content (tables, code) before the answer
  answerHtml: string;
}

export interface PracticeData {
  id: string;
  lessonId: string;
  kind: PracticeKind;
  prompt: string;
  promptHtml?: string;
  options?: { html: string; correct: boolean }[];
  answer?: number;
  tolerance?: number;
  unit?: string;
  explanationHtml: string;
}
