import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Brain,
  Clock,
  Cpu,
  Flame,
  Gauge,
  Lightbulb,
  ListChecks,
  MessagesSquare,
  Scale,
  Server,
  SquareTerminal,
  TriangleAlert,
  Waypoints,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { getLesson, getLessonBySlug, getLessonsBySubject, getNeighbors, getSubject, renderLesson } from "@/lib/content/loader";
import { SECTION_MIN_MODE, SECTION_ORDER, SECTION_TITLES, type SectionKey, type SubjectId } from "@/lib/content/types";
import { getWidget } from "@/lib/registry";
import { Prose, Rendered } from "@/components/content/Rendered";
import { VizEmbed } from "@/components/content/VizEmbed";
import { LabCard } from "@/components/content/blocks";
import { DepthBadge, DifficultyMeter, Pill, RelevanceMeter, SubjectBadge } from "@/components/ui/badges";
import { cn, formatMinutes, SUBJECT_STYLE } from "@/lib/utils";
import { LessonShell } from "./LessonShell";
import { LessonToc } from "./LessonToc";
import { BookmarkButton, CompleteButton, PrereqStatus, RevisedButton } from "./LessonActions";
import { QuestionList } from "./QuestionList";
import { PracticeList } from "./PracticeList";

const SECTION_ICONS: Record<SectionKey, LucideIcon> = {
  "mental-model": Brain,
  definition: BookOpen,
  "why-it-exists": Lightbulb,
  "how-it-works": Workflow,
  "internal-mechanism": Cpu,
  example: SquareTerminal,
  visualization: Activity,
  performance: Gauge,
  "trade-offs": Scale,
  "failure-modes": Flame,
  "in-production": Server,
  connections: Waypoints,
  misconceptions: TriangleAlert,
  "interview-questions": MessagesSquare,
  practice: ListChecks,
  "quick-revision": Zap,
};

export function lessonParams(subject: SubjectId) {
  return getLessonsBySubject(subject).map((l) => ({ slug: l.slug }));
}

export function lessonMetadata(subject: SubjectId, slug: string): Metadata {
  const l = getLessonBySlug(subject, slug);
  if (!l) return {};
  return { title: l.title, description: l.summary };
}

function LessonLinkCard({ id, dir }: { id?: string; dir: "prev" | "next" }) {
  const l = id ? getLesson(id) : undefined;
  if (!l) return <div />;
  return (
    <Link
      href={l.href}
      className={cn("group flex flex-col rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent/50", dir === "next" && "items-end text-right")}
    >
      <span className="flex items-center gap-1 text-[12px] text-subtle">
        {dir === "prev" && <ArrowLeft className="h-3.5 w-3.5" />}
        {dir === "prev" ? "Previous" : "Next"} · L{l.level}
        {dir === "next" && <ArrowRight className="h-3.5 w-3.5" />}
      </span>
      <span className="mt-1 font-medium text-fg group-hover:text-accent">{l.title}</span>
    </Link>
  );
}

function ConceptChip({ id, note }: { id: string; note?: string }) {
  const l = getLesson(id);
  if (!l) return null;
  return (
    <Link href={l.href} className="group flex items-start gap-3 rounded-xl border border-border bg-surface p-3 hover:border-accent/50">
      <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", SUBJECT_STYLE[l.subject].dot)} />
      <span className="min-w-0">
        <span className="block text-[14px] font-medium text-fg group-hover:text-accent">{l.title}</span>
        <span className="block text-[12px] text-subtle">
          {note ? `${note} · ` : ""}
          {getSubject(l.subject).short} L{l.level}
        </span>
      </span>
    </Link>
  );
}

export async function LessonPage({ subject, slug }: { subject: SubjectId; slug: string }) {
  const meta = getLessonBySlug(subject, slug);
  if (!meta) notFound();
  const lesson = (await renderLesson(meta.id))!;
  const subj = getSubject(subject);
  const { prev, next, unlocks } = getNeighbors(meta.id);

  // Widgets listed in frontmatter but not already embedded inline get rendered in the Visualization section.
  const vizToShow = meta.visualizations.filter((v) => !meta.inlineWidgets.includes(v));
  const labsToShow = meta.labs.filter((l) => !meta.visualizations.includes(l) && !meta.inlineWidgets.includes(l) && getWidget(l));
  const sections = lesson.sections.filter(
    (s) => s.key !== "visualization" || s.hast.children.length > 0 || vizToShow.length > 0 || labsToShow.length > 0,
  );
  if (!sections.some((s) => s.key === "connections") && (meta.related.length || unlocks.length)) {
    sections.push({ key: "connections", title: SECTION_TITLES.connections, hast: { type: "root", children: [] } });
    sections.sort((a, b) => SECTION_ORDER.indexOf(a.key) - SECTION_ORDER.indexOf(b.key));
  }
  const toc = sections.map((s) => ({ key: s.key, title: s.key === "interview-questions" ? `Interview Questions (${lesson.questions.length})` : s.title }));
  const levelDef = subj.levels.find((l) => l.n === meta.level);

  return (
    <div className="px-4 pb-16 sm:px-6 lg:px-10">
      <LessonShell lessonId={meta.id}>
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_220px]">
          <article className="min-w-0 max-w-3xl">
            {/* Header */}
            <header className="mb-10">
              <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap items-center gap-1.5 text-[13px] text-subtle">
                <Link href={`/${subj.path}`} className={cn("font-medium hover:underline", SUBJECT_STYLE[subject].text)}>
                  {subj.title}
                </Link>
                <span>/</span>
                <Link href={`/${subj.path}#level-${meta.level}`} className="hover:text-fg">
                  Level {meta.level}: {meta.levelTitle}
                </Link>
                {levelDef?.track === "sql" && (
                  <>
                    <span>/</span>
                    <Link href="/databases/sql" className="hover:text-fg">SQL track</Link>
                  </>
                )}
              </nav>
              <h1 className="text-3xl leading-tight font-semibold tracking-tight text-balance text-fg sm:text-[2.35rem]">{meta.title}</h1>
              <p className="mt-3 text-[17px] leading-relaxed text-pretty text-muted">{meta.summary}</p>

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <SubjectBadge subject={subject} />
                <DepthBadge depth={meta.depth} />
                <Pill>Level {meta.level}</Pill>
                <Pill title="Where this sits in the recommended study path">Stage {meta.stage}</Pill>
              </div>
              <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 rounded-xl border border-border bg-surface px-4 py-3 text-[13px] sm:grid-cols-3">
                <div>
                  <dt className="text-[11px] font-semibold tracking-wider text-subtle uppercase">Study time</dt>
                  <dd className="mt-0.5 flex items-center gap-1.5 text-fg">
                    <Clock className="h-3.5 w-3.5 text-subtle" />
                    {formatMinutes(meta.minutes)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold tracking-wider text-subtle uppercase">Difficulty</dt>
                  <dd className="mt-0.5 text-fg">
                    <DifficultyMeter difficulty={meta.difficulty} />
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold tracking-wider text-subtle uppercase">Interview relevance</dt>
                  <dd className="mt-0.5 text-fg">
                    <RelevanceMeter relevance={meta.relevance} />
                  </dd>
                </div>
              </dl>
              <div className="mt-4">
                <div className="mb-1.5 text-[11px] font-semibold tracking-wider text-subtle uppercase">Prerequisites</div>
                <PrereqStatus prerequisites={meta.prerequisites} />
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <CompleteButton id={meta.id} title={meta.title} href={meta.href} />
                <BookmarkButton bkey={`lesson:${meta.id}`} />
              </div>
            </header>

            {lesson.intro && (
              <Prose className="mb-8">
                <Rendered hast={lesson.intro} />
              </Prose>
            )}

            {/* Sections */}
            {sections.map((s) => {
              const Icon = SECTION_ICONS[s.key];
              const highlight = s.key === "mental-model" || s.key === "quick-revision";
              return (
                <section key={s.key} id={s.key} data-min={SECTION_MIN_MODE[s.key]} className="lesson-section scroll-mt-32 border-t border-border pt-8 pb-2 first-of-type:border-0">
                  <h2 className="mb-4 flex items-center gap-2.5 text-[1.35rem] font-semibold tracking-tight text-fg">
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-surface-2 text-accent">
                      <Icon className="h-4 w-4" />
                    </span>
                    {s.key === "interview-questions" ? "Interview Questions" : s.title}
                  </h2>

                  {s.key === "interview-questions" ? (
                    <QuestionList questions={lesson.questions} />
                  ) : s.key === "practice" ? (
                    <PracticeList items={lesson.practice} />
                  ) : (
                    <>
                      {s.hast.children.length > 0 && (
                        <div className={cn(highlight && "rounded-2xl border border-border bg-surface px-5 py-1", s.key === "quick-revision" && "border-accent/30")}>
                          <Prose>
                            <Rendered hast={s.hast} />
                          </Prose>
                        </div>
                      )}
                      {s.key === "visualization" && (
                        <>
                          {vizToShow.map((v) => (
                            <VizEmbed key={v} id={v} />
                          ))}
                          {labsToShow.map((l) => (
                            <LabCard key={l} id={l} />
                          ))}
                        </>
                      )}
                      {s.key === "connections" && (meta.related.length > 0 || unlocks.length > 0) && (
                        <div className="mt-4 grid gap-2 sm:grid-cols-2">
                          {meta.related.map((r) => (
                            <ConceptChip key={r} id={r} note="Related" />
                          ))}
                          {unlocks
                            .filter((u) => !meta.related.includes(u.id))
                            .map((u) => (
                              <ConceptChip key={u.id} id={u.id} note="Builds on this" />
                            ))}
                        </div>
                      )}
                    </>
                  )}
                </section>
              );
            })}

            {/* Footer */}
            <div className="mt-12 rounded-2xl border border-border bg-surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-fg">Finished this concept?</div>
                  <p className="text-[13px] text-muted">Marking it complete updates your curriculum progress; answering the questions updates mastery.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <RevisedButton id={meta.id} title={meta.title} href={meta.href} />
                  <CompleteButton id={meta.id} title={meta.title} href={meta.href} size="lg" />
                </div>
              </div>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <LessonLinkCard id={prev?.id} dir="prev" />
              <LessonLinkCard id={next?.id} dir="next" />
            </div>
          </article>

          <aside className="hidden xl:block">
            <div className="sticky top-32 max-h-[calc(100vh-9rem)] overflow-y-auto thin-scroll">
              <LessonToc sections={toc} />
            </div>
          </aside>
        </div>
      </LessonShell>
    </div>
  );
}
