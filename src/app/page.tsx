import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getAllLessons, getCounts, getLessonsBySubject, getSubjects, getWalkthroughs } from "@/lib/content/loader";
import { DEPTHS, REVISION_MODES, type Depth } from "@/lib/content/types";
import { ContinueLearning, SubjectMasteryCard } from "@/components/progress/ProgressBits";
import { GithubMark, REPO_URL } from "@/components/ui/GithubMark";
import { cn, DEPTH_META, SUBJECT_STYLE } from "@/lib/utils";

/** What each depth level asks of the reader — the home page's "four levels" grid. */
const DEPTH_STORY: Record<Depth, { tag: string; question: string; aim: string; items: string[] }> = {
  beginner: {
    tag: "Map",
    question: "Know what it is.",
    aim: "Build the mental model.",
    items: ["The problem it solves", "Mental model and analogy", "Definitions and vocabulary", "Basic examples", "Where it fits"],
  },
  core: {
    tag: "Mechanism",
    question: "Know how it works.",
    aim: "What standard interviews expect.",
    items: ["Step-by-step mechanism", "Classic numericals", "Common misconceptions", "Interview questions", "Practice and labs"],
  },
  advanced: {
    tag: "Depth",
    question: "Know why it's built this way.",
    aim: "The follow-up questions.",
    items: ["Internal data structures", "Costs and trade-offs", "Failure modes", "Engine-specific behaviour", "Debugging signals"],
  },
  senior: {
    tag: "Production",
    question: "Know how it breaks at scale.",
    aim: "Senior-touch awareness.",
    items: ["Production incidents", "Capacity and tail latency", "Operational trade-offs", "Design judgment", "What experience adds"],
  },
};

export default function Home() {
  const counts = getCounts();
  const subjects = getSubjects();
  const mainSubjects = subjects.filter((s) => s.id !== "x");
  const connections = getAllLessons().filter((l) => l.subject === "x").slice(0, 4);
  const walkthroughs = getWalkthroughs().slice(0, 6);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
      {/* Hero */}
      <section className="pb-14">
        <p className="eyebrow">A mechanism-first curriculum</p>
        <h1 className="mt-4 max-w-3xl text-4xl leading-[1.05] font-semibold tracking-tight text-balance text-fg sm:text-5xl">Understand the machine.</h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-pretty text-muted sm:text-lg">
          From the problem a concept solves → how it works inside → explaining it in the interview → how it fails in production. Operating systems, networks and
          databases, taught from first principles.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/path" className="inline-flex h-10 items-center gap-2 rounded-md bg-fg px-5 text-sm font-medium text-bg transition-opacity hover:opacity-90">
            Start learning <ArrowRight className="size-4" />
          </Link>
          <Link href="/interview" className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-5 text-sm font-medium text-fg transition-colors hover:border-border-strong">
            Interview Mode <ArrowRight className="size-4" />
          </Link>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium text-fg transition-colors hover:border-border-strong"
          >
            <GithubMark className="size-4" /> View on GitHub
          </a>
          <span className="text-xs text-subtle">
            {counts.lessons} concepts · {mainSubjects.length} subjects + cross-domain · 4 depth levels
          </span>
        </div>
        <div className="mt-8">
          <ContinueLearning />
        </div>
      </section>

      <div className="border-t border-border" />

      {/* The four depths */}
      <section className="pt-12">
        <h2 className="text-sm font-semibold tracking-tight text-fg">The four depths</h2>
        <p className="mt-1 text-sm text-muted">Every lesson is written in layers — each one answering a harder question. Stop at the depth your interview needs.</p>
        <div className="mt-6 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
          {DEPTHS.map((d, i) => {
            const m = DEPTH_META[d];
            const story = DEPTH_STORY[d];
            return (
              <div key={d} className="flex flex-col bg-surface p-5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-2xs text-subtle">Level {i + 1}</span>
                  <span className={cn("text-2xs font-semibold tracking-[0.12em] uppercase", m.text)}>{story.tag}</span>
                </div>
                <h3 className="mt-3 text-lg font-semibold tracking-tight text-fg">{m.label}</h3>
                <p className="mt-1 text-sm text-fg/80">{story.question}</p>
                <p className="mt-2 text-xs text-subtle">{story.aim}</p>
                <ul className="mt-4 space-y-1.5 border-t border-border pt-4 text-xs text-muted">
                  {story.items.map((it) => (
                    <li key={it} className="flex items-center gap-2">
                      <span className={cn("size-1 rounded-full bg-current", m.text)} aria-hidden />
                      {it}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-5">
                  <div className="h-px w-full" style={{ backgroundColor: `var(--d-${d})` }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-10 space-y-1 text-sm text-muted">
          <p>Memorizing an answer is not the same as understanding the mechanism.</p>
          <p>Understanding the mechanism is not the same as explaining it under pressure.</p>
          <p>Explaining it is not the same as knowing how it fails in production.</p>
          <p className="pt-2 text-fg">The depth levels exist to close those gaps.</p>
        </div>
      </section>

      {/* Stats */}
      <section className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
        {[
          [counts.lessons, "concept lessons"],
          [counts.questions, "interview questions"],
          [counts.labs, "hands-on labs"],
          [counts.visualizations, "visualizations"],
          [counts.walkthroughs, "under-the-hood traces"],
          [counts.cases, "incident case studies"],
        ].map(([n, label]) => (
          <div key={label} className="bg-surface px-4 py-4">
            <div className="text-2xl font-semibold tracking-tight text-fg tabular-nums">{n}</div>
            <div className="text-xs text-subtle">{label}</div>
          </div>
        ))}
      </section>

      {/* Curricula */}
      <section id="subjects" className="scroll-mt-20 pt-16">
        {subjects.map((s) => {
          const lessons = getLessonsBySubject(s.id);
          const style = SUBJECT_STYLE[s.id];
          return (
            <div key={s.id} className="mb-14 last:mb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-fg">
                  <span className={cn("size-1.5 rounded-full", style.dot)} aria-hidden />
                  {s.title} curriculum
                </h2>
                <Link href={`/${s.path}`} className="text-xs text-muted transition-colors hover:text-fg">
                  Open dashboard →
                </Link>
              </div>
              <p className="mt-1 text-sm text-muted">{s.tagline}</p>
              <p className="mt-1 text-xs text-subtle">
                {lessons.length} concepts · {s.levels.length} levels
              </p>
              <ol className="mt-5 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
                {s.levels.map((lvl) => {
                  const n = lessons.filter((l) => l.level === lvl.n).length;
                  return (
                    <li key={lvl.n} className="bg-surface">
                      <Link href={`/${s.path}#level-${lvl.n}`} className="flex items-baseline gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
                        <span className="font-mono text-2xs text-subtle tabular-nums">{String(lvl.n).padStart(2, "0")}</span>
                        <span className="min-w-0 flex-1 text-sm text-fg">{lvl.title}</span>
                        <span className="text-xs text-subtle tabular-nums">{n} {n === 1 ? "concept" : "concepts"}</span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        })}
      </section>

      {/* Progress */}
      <section className="pt-16">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight text-fg">Your progress</h2>
          <Link href="/progress" className="text-xs text-muted transition-colors hover:text-fg">
            Progress dashboard →
          </Link>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {mainSubjects.map((s) => (
            <SubjectMasteryCard key={s.id} subject={s.id} href="/progress" />
          ))}
        </div>
      </section>

      {/* Revision */}
      <section className="pt-16">
        <h2 className="text-sm font-semibold tracking-tight text-fg">Revise in 5, 15 or 30 minutes</h2>
        <p className="mt-1 text-sm text-muted">Every lesson can be read as a quick revision sheet, a mechanism refresher or the full deep dive.</p>
        <ul className="mt-4 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
          {REVISION_MODES.map((m) => (
            <li key={m.id} className="bg-surface px-4 py-3">
              <div className="text-sm font-medium text-fg">{m.label}</div>
              <div className="mt-1 text-xs text-muted">{m.blurb}</div>
            </li>
          ))}
        </ul>
      </section>

      {/* Connections */}
      {connections.length > 0 && (
        <section className="pt-16">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-fg">Where the subjects meet</h2>
            <Link href="/connections" className="text-xs text-muted transition-colors hover:text-fg">
              All cross-domain lessons →
            </Link>
          </div>
          <p className="mt-1 text-sm text-muted">The strongest answers cross layers: one operation followed through the application, the kernel, the network and the database.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {connections.map((l) => (
              <Link key={l.id} href={l.href} className="rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong">
                <div className="text-sm font-medium text-fg">{l.title}</div>
                <p className="mt-1 text-xs text-muted">{l.summary}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Under the hood */}
      {walkthroughs.length > 0 && (
        <section className="pt-16">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-fg">What happens under the hood?</h2>
            <Link href="/under-the-hood" className="text-xs text-muted transition-colors hover:text-fg">
              All walkthroughs →
            </Link>
          </div>
          <p className="mt-1 text-sm text-muted">Step-by-step traces of the operations interviewers love to ask about — each step tagged with the layer doing the work.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {walkthroughs.map((w) => (
              <Link key={w.id} href={w.href} className="rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong">
                <div className="text-sm font-medium text-fg">{w.title}</div>
                <div className="mt-1 text-xs text-subtle">{w.stepCount} steps</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Honesty */}
      <section className="mt-16 rounded-lg border border-border bg-surface p-5" style={{ borderLeftWidth: 2, borderLeftColor: "var(--accent)" }}>
        <p className="eyebrow" style={{ color: "var(--accent)" }}>
          What this academy is — and is not
        </p>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
          It will give you accurate mental models, the vocabulary interviewers expect, and enough mechanism to reason through questions you have never seen. The Senior
          Touch material gives <em>conceptual exposure</em> to what senior engineers deal with. It does not replace the judgment that comes from operating real systems —
          and the best candidates are honest about that difference.
        </p>
      </section>
    </div>
  );
}
