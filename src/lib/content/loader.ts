// Loads and validates everything under /content. Used by server components at
// build time and by scripts/validate-content.ts. No React in here.
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { RootContent, List, ListItem } from "mdast";
import type { Root as HastRoot } from "hast";
import { SUBJECTS, STAGES, ROADMAPS } from "@content/structure";
import { WIDGETS, getWidget } from "@/lib/registry";
import {
  DEPTHS,
  QUESTION_TYPES,
  SECTION_ALIASES,
  SECTION_ORDER,
  SECTION_TITLES,
  type Depth,
  type LessonFrontmatter,
  type LessonMeta,
  type PracticeData,
  type PracticeKind,
  type QuestionData,
  type QuestionLevel,
  type QuestionType,
  type SectionKey,
  type SubjectDef,
  type SubjectId,
} from "./types";
import { createRenderer, parseMarkdown, plainText, slugify, splitAnswer, splitByHeading } from "./markdown";
import { visit } from "unist-util-visit";

const CONTENT_DIR = path.join(process.cwd(), "content");
const SUBJECT_IDS: SubjectId[] = ["os", "cn", "db", "x"];

export interface Diagnostic {
  level: "error" | "warn";
  file: string;
  message: string;
}

interface RawQuestion {
  id: string;
  level: QuestionLevel;
  type: QuestionType;
  prompt: string;
  promptNodes: RootContent[];
  answerNodes: RootContent[];
}

interface RawPractice {
  id: string;
  kind: PracticeKind;
  prompt: string;
  promptNodes: RootContent[];
  options?: { nodes: RootContent[]; correct: boolean }[];
  answer?: number;
  tolerance?: number;
  unit?: string;
  explanationNodes: RootContent[];
}

export interface LessonRecord {
  meta: LessonMeta;
  intro: RootContent[];
  sections: { key: SectionKey; nodes: RootContent[] }[];
  questions: RawQuestion[];
  practice: RawPractice[];
  plain: Partial<Record<SectionKey, string>>;
  file: string;
}

export interface CaseStudyMeta {
  id: string;
  title: string;
  subject: SubjectId;
  summary: string;
  difficulty: number;
  concepts: string[];
  tags: string[];
  order: number;
  href: string;
}

export interface WalkthroughMeta {
  id: string;
  title: string;
  summary: string;
  subjects: SubjectId[];
  order: number;
  related: string[];
  href: string;
  stepCount: number;
}

export interface TrapMeta {
  id: string;
  title: string;
  subject: SubjectId;
  href: string;
}

interface Store {
  signature: string;
  lessons: LessonRecord[];
  lessonsById: Map<string, LessonRecord>;
  cases: { meta: CaseStudyMeta; nodes: RootContent[] }[];
  walkthroughs: { meta: WalkthroughMeta; intro: RootContent[]; steps: { layer: string; title: string; nodes: RootContent[] }[] }[];
  traps: { meta: TrapMeta; nodes: RootContent[] }[];
  diagnostics: Diagnostic[];
}

let store: Store | null = null;

function listMarkdown(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => path.join(dir, f));
}

function allContentFiles(): string[] {
  const files: string[] = [];
  for (const s of SUBJECT_IDS) files.push(...listMarkdown(path.join(CONTENT_DIR, "lessons", s)));
  files.push(...listMarkdown(path.join(CONTENT_DIR, "case-studies")));
  files.push(...listMarkdown(path.join(CONTENT_DIR, "under-the-hood")));
  const traps = path.join(CONTENT_DIR, "traps.md");
  if (fs.existsSync(traps)) files.push(traps);
  return files;
}

function computeSignature(files: string[]): string {
  let sig = String(files.length);
  for (const f of files) sig += ":" + fs.statSync(f).mtimeMs;
  return sig;
}

function rel(file: string) {
  return path.relative(CONTENT_DIR, file).replace(/\\/g, "/");
}

const QUESTION_HEADING = /^\[\s*L([1-4])\s*[·•|,/-]?\s*([a-z-]+)\s*\]\s*(.+)$/i;
const PRACTICE_HEADING = /^\[\s*(mcq|numeric|exercise)([^\]]*)\]\s*(.+)$/i;

function parseQuestions(lessonId: string, nodes: RootContent[], diag: Diagnostic[], file: string): RawQuestion[] {
  const { intro, parts } = splitByHeading(nodes, 3);
  if (intro.some((n) => n.type !== "html")) diag.push({ level: "warn", file, message: "Content before first question in Interview Questions is ignored" });
  const seen = new Set<string>();
  const out: RawQuestion[] = [];
  for (const p of parts) {
    const m = QUESTION_HEADING.exec(p.heading);
    if (!m) {
      diag.push({ level: "error", file, message: `Question heading must look like "[L2 · trace] Question": ${p.heading}` });
      continue;
    }
    const type = m[2].toLowerCase() as QuestionType;
    if (!QUESTION_TYPES.includes(type)) diag.push({ level: "error", file, message: `Unknown question type "${type}" in: ${p.heading}` });
    const prompt = m[3].trim();
    let id = `${lessonId}--${slugify(prompt)}`;
    while (seen.has(id)) id += "-x";
    seen.add(id);
    const { prompt: promptNodes, answer } = splitAnswer(p.nodes);
    if (!answer.length) diag.push({ level: "error", file, message: `Question has no answer: ${prompt}` });
    out.push({ id, level: Number(m[1]) as QuestionLevel, type, prompt, promptNodes, answerNodes: answer });
  }
  return out;
}

function parsePractice(lessonId: string, nodes: RootContent[], diag: Diagnostic[], file: string): RawPractice[] {
  const { parts } = splitByHeading(nodes, 3);
  const out: RawPractice[] = [];
  parts.forEach((p, i) => {
    const m = PRACTICE_HEADING.exec(p.heading);
    if (!m) {
      diag.push({ level: "error", file, message: `Practice heading must start with [mcq], [numeric <answer>] or [exercise]: ${p.heading}` });
      return;
    }
    const kind = m[1].toLowerCase() as PracticeKind;
    const params = m[2].trim();
    const prompt = m[3].trim();
    const id = `${lessonId}--p${i + 1}`;
    if (/\bwait\b[,—-]|\brecount\b|\.\.\.\s*$|…\s*$/im.test(plainText(p.nodes))) {
      diag.push({ level: "error", file, message: `Practice explanation reads like an unfinished self-correction — ${prompt}` });
    }
    if (kind === "mcq") {
      const listIdx = p.nodes.findIndex((n) => n.type === "list" && (n as List).children.every((li) => typeof (li as ListItem).checked === "boolean"));
      if (listIdx === -1) {
        diag.push({ level: "error", file, message: `MCQ has no task-list options: ${prompt}` });
        return;
      }
      const list = p.nodes[listIdx] as List;
      const options = list.children.map((li) => ({ nodes: li.children as RootContent[], correct: !!li.checked }));
      if (!options.some((o) => o.correct)) diag.push({ level: "error", file, message: `MCQ has no correct option: ${prompt}` });
      const rest = p.nodes.slice(listIdx + 1);
      const { answer } = splitAnswer(rest);
      out.push({ id, kind, prompt, promptNodes: p.nodes.slice(0, listIdx), options, explanationNodes: answer });
    } else if (kind === "numeric") {
      const nums = params.match(/-?\d+(\.\d+)?/g) ?? [];
      const answer = nums.length ? Number(nums[0]) : NaN;
      const tolMatch = /(?:±|tol=)\s*(\d+(\.\d+)?)/.exec(params);
      const unitMatch = /unit=([^\s]+)/.exec(params);
      if (Number.isNaN(answer)) diag.push({ level: "error", file, message: `Numeric practice needs an answer, e.g. [numeric 6.5]: ${prompt}` });
      const { prompt: promptNodes, answer: expl, explicit } = splitAnswer(p.nodes);
      if (!explicit) diag.push({ level: "warn", file, message: `Numeric practice should put its working in :::answer — ${prompt}` });
      const tolerance = tolMatch ? Number(tolMatch[1]) : Math.max(Math.abs(answer) * 0.01, 0.01);
      // Guard against answer keys that disagree with the worked solution.
      const bolded: number[] = [];
      visit({ type: "root", children: explicit ? expl : p.nodes } as never, "strong", (n: { children?: { value?: string }[] }) => {
        const text = (n.children ?? []).map((c) => c.value ?? "").join("").replace(/,/g, "").replace(/−/g, "-");
        const m = /-?\d+(\.\d+)?/.exec(text);
        if (m) bolded.push(Number(m[0]));
      });
      if (bolded.length && !bolded.some((b) => Math.abs(b - answer) <= tolerance)) {
        diag.push({ level: "error", file, message: `Numeric key ${answer} doesn't match the bolded result (${bolded.join(", ")}) — ${prompt}` });
      }
      out.push({
        id,
        kind,
        prompt,
        promptNodes: explicit ? promptNodes : [],
        answer,
        tolerance,
        unit: unitMatch?.[1],
        explanationNodes: explicit ? expl : p.nodes,
      });
    } else {
      const { prompt: promptNodes, answer, explicit } = splitAnswer(p.nodes);
      if (!explicit) diag.push({ level: "warn", file, message: `Exercise should put its solution in :::solution — ${prompt}` });
      out.push({ id, kind, prompt, promptNodes: explicit ? promptNodes : [], explanationNodes: explicit ? answer : p.nodes });
    }
  });
  return out;
}

function loadLesson(file: string, subjectDir: SubjectId, diag: Diagnostic[]): LessonRecord | null {
  const src = fs.readFileSync(file, "utf8");
  const { data, content } = matter(src);
  const fm = data as Partial<LessonFrontmatter>;
  const id = path.basename(file, ".md");
  const f = rel(file);
  const required: (keyof LessonFrontmatter)[] = ["title", "subject", "level", "order", "summary", "depth", "difficulty", "minutes", "relevance", "stage"];
  for (const k of required) if (fm[k] === undefined) diag.push({ level: "error", file: f, message: `Missing frontmatter field: ${k}` });
  if (fm.subject !== subjectDir) diag.push({ level: "error", file: f, message: `subject "${fm.subject}" does not match folder "${subjectDir}"` });
  if (fm.depth && !DEPTHS.includes(fm.depth)) diag.push({ level: "error", file: f, message: `Invalid depth "${fm.depth}"` });
  const subject = SUBJECTS.find((s) => s.id === subjectDir)!;
  const levelDef = subject.levels.find((l) => l.n === fm.level);
  if (!levelDef) diag.push({ level: "error", file: f, message: `Level ${fm.level} not defined for subject ${subjectDir}` });

  const tree = parseMarkdown(content);
  const depthBlocks: Partial<Record<Depth, number>> = {};
  visit(tree, "containerDirective", (node: { name: string; attributes?: Record<string, string | null | undefined> | null }) => {
    if (node.name !== "depth") return;
    const level = node.attributes?.level as Depth | undefined;
    if (!level || !DEPTHS.includes(level)) {
      diag.push({ level: "error", file: f, message: `:::depth needs a level of ${DEPTHS.join(" | ")} (got "${level ?? "nothing"}")` });
      return;
    }
    depthBlocks[level] = (depthBlocks[level] ?? 0) + 1;
  });
  const inlineWidgets: string[] = [];
  visit(tree, "leafDirective", (node: { name: string; attributes?: Record<string, string | null | undefined> | null }) => {
    const wid = node.attributes?.id;
    if ((node.name === "viz" || node.name === "lab") && wid) {
      inlineWidgets.push(wid);
      const w = getWidget(wid);
      if (!w) diag.push({ level: "error", file: f, message: `Unknown inline widget "${wid}"` });
      else if (!w.kinds.includes(node.name)) diag.push({ level: "error", file: f, message: `Inline ::${node.name}{id=${wid}} but the widget is registered as ${w.kinds.join("/")}` });
    }
  });
  const { intro, parts } = splitByHeading(tree.children as RootContent[], 2);
  const sections: { key: SectionKey; nodes: RootContent[] }[] = [];
  let questions: RawQuestion[] = [];
  let practice: RawPractice[] = [];
  for (const p of parts) {
    const key = SECTION_ALIASES[p.heading.toLowerCase()];
    if (!key) {
      diag.push({ level: "error", file: f, message: `Unknown section heading "## ${p.heading}"` });
      continue;
    }
    if (key === "interview-questions") questions = parseQuestions(id, p.nodes, diag, f);
    else if (key === "practice") practice = parsePractice(id, p.nodes, diag, f);
    const existing = sections.find((s) => s.key === key);
    if (existing) existing.nodes.push(...p.nodes);
    else sections.push({ key, nodes: p.nodes });
  }
  if ((fm.visualizations?.length ?? 0) > 0 && !sections.some((s) => s.key === "visualization")) {
    sections.push({ key: "visualization", nodes: [] });
  }
  sections.sort((a, b) => SECTION_ORDER.indexOf(a.key) - SECTION_ORDER.indexOf(b.key));
  for (const must of ["mental-model", "quick-revision"] as SectionKey[]) {
    if (!sections.some((s) => s.key === must)) diag.push({ level: "warn", file: f, message: `Missing recommended section: ${SECTION_TITLES[must]}` });
  }
  const plain: Partial<Record<SectionKey, string>> = {};
  for (const s of sections) if (s.key !== "interview-questions" && s.key !== "practice") plain[s.key] = plainText(s.nodes);

  const slug = id.startsWith(`${subjectDir}-`) ? id.slice(subjectDir.length + 1) : id;
  const meta: LessonMeta = {
    id,
    slug,
    href: `/${subject.path}/${slug}`,
    title: fm.title ?? id,
    subject: subjectDir,
    level: fm.level ?? 0,
    order: fm.order ?? 0,
    summary: fm.summary ?? "",
    depth: fm.depth ?? "core",
    difficulty: fm.difficulty ?? 2,
    minutes: fm.minutes ?? 20,
    relevance: fm.relevance ?? "medium",
    stage: fm.stage ?? 2,
    prerequisites: fm.prerequisites ?? [],
    related: fm.related ?? [],
    visualizations: fm.visualizations ?? [],
    labs: fm.labs ?? [],
    tags: fm.tags ?? [],
    levelTitle: levelDef?.title ?? `Level ${fm.level}`,
    sectionKeys: sections.map((s) => s.key),
    questionCount: questions.length,
    inlineWidgets,
    depthBlocks,
  };
  return { meta, intro, sections, questions, practice, plain, file: f };
}

function loadCaseStudies(diag: Diagnostic[]) {
  return listMarkdown(path.join(CONTENT_DIR, "case-studies")).map((file) => {
    const { data, content } = matter(fs.readFileSync(file, "utf8"));
    const id = path.basename(file, ".md");
    const f = rel(file);
    for (const k of ["title", "subject", "summary"]) if (data[k] === undefined) diag.push({ level: "error", file: f, message: `Missing frontmatter field: ${k}` });
    const meta: CaseStudyMeta = {
      id,
      title: data.title ?? id,
      subject: data.subject ?? "x",
      summary: data.summary ?? "",
      difficulty: data.difficulty ?? 2,
      concepts: data.concepts ?? [],
      tags: data.tags ?? [],
      order: data.order ?? 99,
      href: `/case-studies/${id}`,
    };
    return { meta, nodes: parseMarkdown(content).children as RootContent[] };
  }).sort((a, b) => a.meta.order - b.meta.order || a.meta.title.localeCompare(b.meta.title));
}

const STEP_HEADING = /^\[\s*([a-z0-9 -]+?)\s*\]\s*(.+)$/i;

function loadWalkthroughs(diag: Diagnostic[]) {
  return listMarkdown(path.join(CONTENT_DIR, "under-the-hood")).map((file) => {
    const { data, content } = matter(fs.readFileSync(file, "utf8"));
    const id = path.basename(file, ".md");
    const f = rel(file);
    const { intro, parts } = splitByHeading(parseMarkdown(content).children as RootContent[], 2);
    const steps = parts.map((p) => {
      const m = STEP_HEADING.exec(p.heading);
      if (!m) diag.push({ level: "error", file: f, message: `Step heading must look like "## [kernel] Title": ${p.heading}` });
      return { layer: m ? m[1].toLowerCase() : "app", title: m ? m[2] : p.heading, nodes: p.nodes };
    });
    const meta: WalkthroughMeta = {
      id,
      title: data.title ?? id,
      summary: data.summary ?? "",
      subjects: data.subjects ?? [],
      order: data.order ?? 99,
      related: data.related ?? [],
      href: `/under-the-hood/${id}`,
      stepCount: steps.length,
    };
    return { meta, intro, steps };
  }).sort((a, b) => a.meta.order - b.meta.order);
}

const TRAP_HEADING = /^\[\s*(os|cn|db|x)\s*\]\s*(.+)$/i;

function loadTraps(diag: Diagnostic[]) {
  const file = path.join(CONTENT_DIR, "traps.md");
  if (!fs.existsSync(file)) return [];
  const { content } = matter(fs.readFileSync(file, "utf8"));
  const { parts } = splitByHeading(parseMarkdown(content).children as RootContent[], 2);
  return parts.map((p) => {
    const m = TRAP_HEADING.exec(p.heading);
    if (!m) diag.push({ level: "error", file: "traps.md", message: `Trap heading must look like "## [os] Title": ${p.heading}` });
    const title = m ? m[2] : p.heading;
    const id = slugify(title);
    return { meta: { id, title, subject: (m?.[1].toLowerCase() ?? "x") as SubjectId, href: `/traps#${id}` }, nodes: p.nodes };
  });
}

function subjectIndex(s: SubjectId) {
  return SUBJECT_IDS.indexOf(s);
}

function validateGraph(s: Store) {
  const { lessons, lessonsById, diagnostics: diag } = s;
  for (const l of lessons) {
    for (const p of l.meta.prerequisites) {
      const pre = lessonsById.get(p);
      if (!pre) {
        diag.push({ level: "error", file: l.file, message: `Unknown prerequisite "${p}"` });
        continue;
      }
      if (pre.meta.stage > l.meta.stage) diag.push({ level: "warn", file: l.file, message: `Prerequisite ${p} is in a later stage (${pre.meta.stage} > ${l.meta.stage})` });
      if (pre.meta.subject === l.meta.subject && lessons.indexOf(pre) > lessons.indexOf(l))
        diag.push({ level: "warn", file: l.file, message: `Prerequisite ${p} appears later in the curriculum order` });
    }
    for (const r of l.meta.related) if (!lessonsById.has(r)) diag.push({ level: "error", file: l.file, message: `Unknown related lesson "${r}"` });
    for (const v of [...l.meta.visualizations, ...l.meta.labs]) if (!getWidget(v)) diag.push({ level: "error", file: l.file, message: `Unknown widget "${v}"` });
    for (const [list, kind] of [[l.meta.visualizations, "viz"], [l.meta.labs, "lab"]] as const) {
      for (const v of list) {
        const w = getWidget(v);
        if (w && !w.kinds.includes(kind)) diag.push({ level: "error", file: l.file, message: `Widget "${v}" is listed as a ${kind} but is registered as ${w.kinds.join("/")}` });
      }
    }
  }
  // cycle detection
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string, stack: string[]) => {
    const st = state.get(id);
    if (st === 2) return;
    if (st === 1) {
      diag.push({ level: "error", file: "graph", message: `Prerequisite cycle: ${[...stack, id].join(" -> ")}` });
      return;
    }
    state.set(id, 1);
    for (const p of lessonsById.get(id)?.meta.prerequisites ?? []) if (lessonsById.has(p)) visit(p, [...stack, id]);
    state.set(id, 2);
  };
  for (const l of lessons) visit(l.meta.id, []);
  for (const c of s.cases) for (const k of c.meta.concepts) if (!lessonsById.has(k)) diag.push({ level: "error", file: `case-studies/${c.meta.id}.md`, message: `Unknown concept "${k}"` });
  for (const w of s.walkthroughs) for (const k of w.meta.related) if (!lessonsById.has(k)) diag.push({ level: "error", file: `under-the-hood/${w.meta.id}.md`, message: `Unknown related lesson "${k}"` });
  for (const r of ROADMAPS) for (const ph of r.phases) for (const k of ph.lessons) if (!lessonsById.has(k)) diag.push({ level: "warn", file: "structure.ts", message: `Roadmap ${r.id} references missing lesson "${k}"` });
  for (const w of WIDGETS) for (const k of w.lessons) if (!lessonsById.has(k)) diag.push({ level: "warn", file: "registry.ts", message: `Widget ${w.id} references missing lesson "${k}"` });
}

function load(): Store {
  const files = allContentFiles();
  const signature = computeSignature(files);
  if (store && (process.env.NODE_ENV === "production" || store.signature === signature)) return store;

  const diagnostics: Diagnostic[] = [];
  const lessons: LessonRecord[] = [];
  const ids = new Set<string>();
  for (const s of SUBJECT_IDS) {
    for (const file of listMarkdown(path.join(CONTENT_DIR, "lessons", s))) {
      const rec = loadLesson(file, s, diagnostics);
      if (!rec) continue;
      if (ids.has(rec.meta.id)) diagnostics.push({ level: "error", file: rec.file, message: `Duplicate lesson id ${rec.meta.id}` });
      ids.add(rec.meta.id);
      lessons.push(rec);
    }
  }
  lessons.sort(
    (a, b) =>
      subjectIndex(a.meta.subject) - subjectIndex(b.meta.subject) || a.meta.level - b.meta.level || a.meta.order - b.meta.order || a.meta.id.localeCompare(b.meta.id),
  );
  const next: Store = {
    signature,
    lessons,
    lessonsById: new Map(lessons.map((l) => [l.meta.id, l])),
    cases: loadCaseStudies(diagnostics),
    walkthroughs: loadWalkthroughs(diagnostics),
    traps: loadTraps(diagnostics),
    diagnostics,
  };
  validateGraph(next);
  store = next;
  rendererCache = null;
  if (process.env.NODE_ENV !== "production") {
    const errors = diagnostics.filter((d) => d.level === "error");
    if (errors.length) console.warn(`[content] ${errors.length} content error(s):\n` + errors.slice(0, 20).map((d) => `  ${d.file}: ${d.message}`).join("\n"));
  }
  return next;
}

// ───────────────────────────── Link resolution & rendering ─────────────────────────────

let rendererCache: ReturnType<typeof createRenderer> | null = null;
const brokenLinks: { href: string; ctx: string }[] = [];

function renderer() {
  const s = load();
  if (rendererCache) return rendererCache;
  const caseIds = new Set(s.cases.map((c) => c.meta.id));
  const uthIds = new Set(s.walkthroughs.map((w) => w.meta.id));
  const trapIds = new Set(s.traps.map((t) => t.meta.id));
  rendererCache = createRenderer(
    (scheme, id) => {
      switch (scheme) {
        case "lesson":
          return s.lessonsById.get(id)?.meta.href ?? null;
        case "lab":
        case "viz": {
          const w = getWidget(id);
          if (!w) return null;
          const preferLab = scheme === "lab" ? w.kinds.includes("lab") : !w.kinds.includes("viz");
          return preferLab ? `/labs/${id}` : `/visualizations/${id}`;
        }
        case "case":
          return caseIds.has(id) ? `/case-studies/${id}` : null;
        case "uth":
          return uthIds.has(id) ? `/under-the-hood/${id}` : null;
        case "trap":
          return trapIds.has(id) ? `/traps#${id}` : null;
        default:
          return null;
      }
    },
    (href, ctx) => {
      brokenLinks.push({ href, ctx });
      if (process.env.NODE_ENV !== "production") console.warn(`[content] broken link ${href} in ${ctx}`);
    },
  );
  return rendererCache;
}

export function getBrokenLinks() {
  return brokenLinks;
}

// ───────────────────────────── Public API ─────────────────────────────

export function getSubjects(): SubjectDef[] {
  return SUBJECTS;
}

export function getSubject(id: SubjectId): SubjectDef {
  return SUBJECTS.find((s) => s.id === id)!;
}

export function getSubjectByPath(p: string): SubjectDef | undefined {
  return SUBJECTS.find((s) => s.path === p);
}

export function getStages() {
  return STAGES;
}

export function getRoadmaps() {
  return ROADMAPS;
}

export function getAllLessons(): LessonMeta[] {
  return load().lessons.map((l) => l.meta);
}

export function getLessonsBySubject(subject: SubjectId): LessonMeta[] {
  return getAllLessons().filter((l) => l.subject === subject);
}

export function getLesson(id: string): LessonMeta | undefined {
  return load().lessonsById.get(id)?.meta;
}

export function getLessonRecord(id: string): LessonRecord | undefined {
  return load().lessonsById.get(id);
}

export function getLessonBySlug(subject: SubjectId, slug: string): LessonMeta | undefined {
  return getAllLessons().find((l) => l.subject === subject && l.slug === slug);
}

export function getNeighbors(id: string) {
  const list = getLessonsBySubject(getLesson(id)!.subject);
  const i = list.findIndex((l) => l.id === id);
  const unlocks = getAllLessons().filter((l) => l.prerequisites.includes(id));
  return { prev: i > 0 ? list[i - 1] : undefined, next: i < list.length - 1 ? list[i + 1] : undefined, unlocks };
}

export interface RenderedSection {
  key: SectionKey;
  title: string;
  hast: HastRoot;
}

export interface RenderedLesson {
  meta: LessonMeta;
  intro: HastRoot | null;
  sections: RenderedSection[];
  questions: QuestionData[];
  practice: PracticeData[];
}

async function renderQuestion(q: RawQuestion, subject: SubjectId, lessonId: string): Promise<QuestionData> {
  const r = renderer();
  return {
    id: q.id,
    lessonId,
    subject,
    level: q.level,
    type: q.type,
    prompt: q.prompt,
    promptHtml: q.promptNodes.length ? await r.toHtml(q.promptNodes, lessonId) : undefined,
    answerHtml: await r.toHtml(q.answerNodes, lessonId),
  };
}

async function renderPractice(p: RawPractice, lessonId: string): Promise<PracticeData> {
  const r = renderer();
  return {
    id: p.id,
    lessonId,
    kind: p.kind,
    prompt: p.prompt,
    promptHtml: p.promptNodes.length ? await r.toHtml(p.promptNodes, lessonId) : undefined,
    options: p.options ? await Promise.all(p.options.map(async (o) => ({ html: await r.toHtml(o.nodes, lessonId), correct: o.correct }))) : undefined,
    answer: p.answer,
    tolerance: p.tolerance,
    unit: p.unit,
    explanationHtml: await r.toHtml(p.explanationNodes, lessonId),
  };
}

export async function renderLesson(id: string): Promise<RenderedLesson | null> {
  const rec = getLessonRecord(id);
  if (!rec) return null;
  const r = renderer();
  const sections: RenderedSection[] = [];
  for (const s of rec.sections) {
    if (s.key === "interview-questions" || s.key === "practice") {
      sections.push({ key: s.key, title: SECTION_TITLES[s.key], hast: { type: "root", children: [] } });
      continue;
    }
    sections.push({ key: s.key, title: SECTION_TITLES[s.key], hast: await r.toHast(s.nodes, id) });
  }
  return {
    meta: rec.meta,
    intro: rec.intro.length ? await r.toHast(rec.intro, id) : null,
    sections,
    questions: await Promise.all(rec.questions.map((q) => renderQuestion(q, rec.meta.subject, id))),
    practice: await Promise.all(rec.practice.map((p) => renderPractice(p, id))),
  };
}

/** Lightweight question metadata (no answers) for counts and indexes. */
export function getQuestionIndex() {
  return load().lessons.flatMap((l) =>
    l.questions.map((q) => ({ id: q.id, lessonId: l.meta.id, subject: l.meta.subject, level: l.meta.level, qLevel: q.level, type: q.type, prompt: q.prompt })),
  );
}

export async function getQuestionsForSubject(subject: SubjectId): Promise<QuestionData[]> {
  const out: QuestionData[] = [];
  for (const l of load().lessons.filter((x) => x.meta.subject === subject)) {
    for (const q of l.questions) out.push(await renderQuestion(q, subject, l.meta.id));
  }
  return out;
}

export async function getPracticeForSubject(subject: SubjectId): Promise<PracticeData[]> {
  const out: PracticeData[] = [];
  for (const l of load().lessons.filter((x) => x.meta.subject === subject)) {
    for (const p of l.practice) out.push(await renderPractice(p, l.meta.id));
  }
  return out;
}

export function getQuickRevision(id: string): { mental: string; revision: string } {
  const rec = getLessonRecord(id);
  return { mental: rec?.plain["mental-model"] ?? "", revision: rec?.plain["quick-revision"] ?? "" };
}

export async function renderSectionsFor(id: string, keys: SectionKey[]): Promise<{ key: SectionKey; hast: HastRoot }[]> {
  const rec = getLessonRecord(id);
  if (!rec) return [];
  const r = renderer();
  const out: { key: SectionKey; hast: HastRoot }[] = [];
  for (const k of keys) {
    const s = rec.sections.find((x) => x.key === k);
    if (s) out.push({ key: k, hast: await r.toHast(s.nodes, id) });
  }
  return out;
}

export function getCaseStudies(): CaseStudyMeta[] {
  return load().cases.map((c) => c.meta);
}

export async function renderCaseStudy(id: string) {
  const c = load().cases.find((x) => x.meta.id === id);
  if (!c) return null;
  const { intro, parts } = splitByHeading(c.nodes, 2);
  const r = renderer();
  return {
    meta: c.meta,
    intro: intro.length ? await r.toHast(intro, id) : null,
    sections: await Promise.all(parts.map(async (p) => ({ title: p.heading, id: slugify(p.heading), hast: await r.toHast(p.nodes, id) }))),
  };
}

export function getWalkthroughs(): WalkthroughMeta[] {
  return load().walkthroughs.map((w) => w.meta);
}

export async function renderWalkthrough(id: string) {
  const w = load().walkthroughs.find((x) => x.meta.id === id);
  if (!w) return null;
  const r = renderer();
  return {
    meta: w.meta,
    intro: w.intro.length ? await r.toHast(w.intro, id) : null,
    steps: await Promise.all(w.steps.map(async (s) => ({ layer: s.layer, title: s.title, hast: await r.toHast(s.nodes, id) }))),
  };
}

export function getTraps(): TrapMeta[] {
  return load().traps.map((t) => t.meta);
}

export async function renderTraps() {
  const r = renderer();
  return Promise.all(load().traps.map(async (t) => ({ meta: t.meta, hast: await r.toHast(t.nodes, "traps") })));
}

export function getDiagnostics(): Diagnostic[] {
  return load().diagnostics;
}

/** Documents for the client-side search index. */
export function buildSearchDocs() {
  const s = load();
  const docs: { id: string; type: string; title: string; text: string; href: string; subject: string; context: string }[] = [];
  for (const l of s.lessons) {
    const subj = getSubject(l.meta.subject);
    const headings: string[] = [];
    for (const sec of l.sections)
      for (const n of sec.nodes) if (n.type === "heading" && n.depth === 3) headings.push(plainText([n]));
    docs.push({
      id: `lesson:${l.meta.id}`,
      type: "lesson",
      title: l.meta.title,
      text: [l.meta.summary, l.meta.tags.join(" "), headings.join(" "), (l.plain["mental-model"] ?? "").slice(0, 600), (l.plain.definition ?? "").slice(0, 400)].join(" "),
      href: l.meta.href,
      subject: l.meta.subject,
      context: `${subj.short} · Level ${l.meta.level}: ${l.meta.levelTitle}`,
    });
    for (const q of l.questions) {
      docs.push({
        id: `q:${q.id}`,
        type: "question",
        title: q.prompt,
        text: "",
        href: `${l.meta.href}#${q.id}`,
        subject: l.meta.subject,
        context: `Interview question · ${l.meta.title}`,
      });
    }
  }
  for (const w of WIDGETS) {
    const lab = w.kinds.includes("lab");
    docs.push({ id: `w:${w.id}`, type: lab ? "lab" : "viz", title: w.title, text: w.description, href: lab ? `/labs/${w.id}` : `/visualizations/${w.id}`, subject: w.subject, context: lab ? "Lab" : "Visualization" });
  }
  for (const c of s.cases) docs.push({ id: `case:${c.meta.id}`, type: "case", title: c.meta.title, text: c.meta.summary + " " + c.meta.tags.join(" "), href: c.meta.href, subject: c.meta.subject, context: "Case study" });
  for (const w of s.walkthroughs) docs.push({ id: `uth:${w.meta.id}`, type: "walkthrough", title: w.meta.title, text: w.meta.summary, href: w.meta.href, subject: "x", context: "Under the Hood" });
  for (const t of s.traps) docs.push({ id: `trap:${t.meta.id}`, type: "trap", title: t.meta.title, text: plainText(t.nodes).slice(0, 300), href: t.meta.href, subject: t.meta.subject, context: "Interview trap" });
  return docs;
}

export function getCounts() {
  const s = load();
  return {
    lessons: s.lessons.length,
    questions: s.lessons.reduce((n, l) => n + l.questions.length, 0),
    practice: s.lessons.reduce((n, l) => n + l.practice.length, 0),
    labs: WIDGETS.filter((w) => w.kinds.includes("lab")).length,
    visualizations: WIDGETS.filter((w) => w.kinds.includes("viz")).length,
    cases: s.cases.length,
    walkthroughs: s.walkthroughs.length,
    traps: s.traps.length,
  };
}

/** Level-level dependency graph derived from lesson prerequisites. */
export function getLevelGraph() {
  const s = load();
  const key = (l: LessonMeta) => `${l.subject}:${l.level}`;
  const edges = new Set<string>();
  for (const l of s.lessons) {
    for (const p of l.meta.prerequisites) {
      const pre = s.lessonsById.get(p);
      if (!pre) continue;
      const a = key(pre.meta);
      const b = key(l.meta);
      if (a !== b) edges.add(`${a}>${b}`);
    }
  }
  return [...edges].map((e) => {
    const [from, to] = e.split(">");
    return { from, to };
  });
}
