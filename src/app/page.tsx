import Link from "next/link";
import { ArrowRight, Cpu, Database, Layers, MessagesSquare, Network, Route, Waypoints, Clock, Brain, FlaskConical } from "lucide-react";
import { getAllLessons, getCounts, getLessonsBySubject, getSubjects, getWalkthroughs } from "@/lib/content/loader";
import { DEPTHS, REVISION_MODES, type SubjectId } from "@/lib/content/types";
import { ContinueLearning, SubjectMasteryCard } from "@/components/progress/ProgressBits";
import { GithubMark, REPO_URL } from "@/components/ui/GithubMark";
import { cn, DEPTH_META, SUBJECT_STYLE } from "@/lib/utils";

const SUBJECT_ICON: Record<SubjectId, typeof Cpu> = { os: Cpu, cn: Network, db: Database, x: Waypoints };

const HIGHLIGHTS: Record<SubjectId, string[]> = {
  os: ["Processes & threads", "Scheduling", "Locks & deadlocks", "Virtual memory", "Page cache", "epoll"],
  cn: ["TCP internals", "DNS", "HTTP/1.1 → HTTP/3", "TLS 1.3", "Load balancers", "Kubernetes networking"],
  db: ["SQL & window functions", "B+ trees", "Query plans", "MVCC & isolation", "WAL & recovery", "Replication & sharding"],
  x: [],
};

export default function Home() {
  const counts = getCounts();
  const subjects = getSubjects().filter((s) => s.id !== "x");
  const connections = getAllLessons().filter((l) => l.subject === "x").slice(0, 4);
  const walkthroughs = getWalkthroughs().slice(0, 6);

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-10">
      {/* Hero */}
      <section className="pb-12">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-[12.5px] text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-os" />
          <span className="h-1.5 w-1.5 rounded-full bg-cn" />
          <span className="h-1.5 w-1.5 rounded-full bg-db" />
          Operating Systems · Computer Networks · Databases & SQL
        </div>
        <h1 className="max-w-4xl text-4xl leading-[1.08] font-semibold tracking-tight text-balance text-fg sm:text-6xl">
          Understand the machine.
          <br />
          <span className="text-muted">Master the interview.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-pretty text-muted">
          A mechanism-first curriculum that takes you from beginner to interview-ready to genuinely strong engineer. We don&apos;t teach answers to memorize — we
          teach enough of the underlying system that the answers become consequences of understanding.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/path" className="inline-flex h-11 items-center gap-2 rounded-xl bg-fg px-5 text-sm font-semibold text-bg hover:opacity-90">
            Start learning <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/interview" className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-fg hover:border-border-strong">
            <MessagesSquare className="h-4 w-4" /> Interview Mode
          </Link>
          <Link href="/path#roadmaps" className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-fg hover:border-border-strong">
            <Route className="h-4 w-4" /> Learning roadmap
          </Link>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-fg hover:border-border-strong"
          >
            <GithubMark className="h-4 w-4" /> View on GitHub
          </a>
          <a href="#subjects" className="inline-flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-muted hover:text-fg">
            Browse by subject
          </a>
        </div>
        <div className="mt-8">
          <ContinueLearning />
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
        {[
          [counts.lessons, "concept lessons"],
          [counts.questions, "interview questions"],
          [counts.labs, "hands-on labs"],
          [counts.visualizations, "visualizations"],
          [counts.walkthroughs, "under-the-hood traces"],
          [counts.cases, "incident case studies"],
        ].map(([n, label]) => (
          <div key={label} className="bg-surface px-4 py-4">
            <div className="font-mono text-2xl font-semibold text-fg">{n}</div>
            <div className="text-[12.5px] text-muted">{label}</div>
          </div>
        ))}
      </section>

      {/* Subjects */}
      <section id="subjects" className="scroll-mt-20 pt-16">
        <h2 className="text-2xl font-semibold tracking-tight">Three academies, one system</h2>
        <p className="mt-2 max-w-3xl text-muted">Each track is a dependency graph, not a list: every lesson declares what it builds on, so you always meet ideas in an order that makes sense.</p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {subjects.map((s) => {
            const Icon = SUBJECT_ICON[s.id];
            const style = SUBJECT_STYLE[s.id];
            const n = getLessonsBySubject(s.id).length;
            return (
              <Link key={s.id} href={`/${s.path}`} className="group flex flex-col rounded-2xl border border-border bg-surface p-5 transition-colors hover:border-border-strong">
                <div className={cn("grid h-10 w-10 place-items-center rounded-xl", style.bg)}>
                  <Icon className={cn("h-5 w-5", style.text)} />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-fg">{s.title}</h3>
                <p className="mt-1 text-[14.5px] text-muted">{s.tagline}</p>
                <ul className="mt-4 flex flex-wrap gap-1.5">
                  {HIGHLIGHTS[s.id].map((h) => (
                    <li key={h} className="rounded-full border border-border px-2 py-0.5 text-[12px] text-muted">
                      {h}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto flex items-center justify-between pt-5 text-[13px] text-subtle">
                  <span>
                    {s.levels.length} levels · {n} lessons
                  </span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
                </div>
              </Link>
            );
          })}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {subjects.map((s) => (
            <SubjectMasteryCard key={s.id} subject={s.id} href="/progress" />
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="grid gap-6 pt-16 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface p-5">
          <Brain className="h-5 w-5 text-accent" />
          <h3 className="mt-3 font-semibold text-fg">Mechanisms, not definitions</h3>
          <p className="mt-2 text-[14.5px] text-muted">
            Every concept page answers the same questions: what it is, why it exists, what happens internally, the trade-offs, what breaks, how it shows up in interviews
            and in production — and how it connects to the rest of the system.
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5">
          <Layers className="h-5 w-5 text-accent" />
          <h3 className="mt-3 font-semibold text-fg">Stop at the depth you need</h3>
          <ul className="mt-3 space-y-2 text-[14px]">
            {DEPTHS.map((d) => (
              <li key={d} className="flex gap-2">
                <span aria-hidden>{DEPTH_META[d].emoji}</span>
                <span>
                  <span className={cn("font-medium", DEPTH_META[d].text)}>{DEPTH_META[d].label}</span>
                  <span className="text-muted"> — {DEPTH_META[d].blurb}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5">
          <Clock className="h-5 w-5 text-accent" />
          <h3 className="mt-3 font-semibold text-fg">Revise in 5, 15 or 30 minutes</h3>
          <ul className="mt-3 space-y-2 text-[14px]">
            {REVISION_MODES.map((m) => (
              <li key={m.id}>
                <span className="font-medium text-fg">{m.label}</span> <span className="text-muted">— {m.blurb}</span>
              </li>
            ))}
          </ul>
          <Link href="/revision" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
            Revision hub <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>

      {/* Connections */}
      {connections.length > 0 && (
        <section className="pt-16">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Where the subjects meet</h2>
              <p className="mt-2 max-w-3xl text-muted">The strongest interview answers cross layers. These lessons follow one operation through the application, the kernel, the network and the database.</p>
            </div>
            <Link href="/connections" className="text-sm font-medium text-accent hover:underline">
              All cross-domain lessons →
            </Link>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {connections.map((l) => (
              <Link key={l.id} href={l.href} className="group rounded-xl border border-border bg-surface p-4 hover:border-x/50">
                <div className="font-medium text-fg group-hover:text-x">{l.title}</div>
                <p className="mt-1 text-[13.5px] text-muted">{l.summary}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Under the hood */}
      {walkthroughs.length > 0 && (
        <section className="pt-16">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">What happens under the hood?</h2>
              <p className="mt-2 max-w-3xl text-muted">Step-by-step traces of the operations interviewers love to ask about — each step tagged with the layer doing the work.</p>
            </div>
            <Link href="/under-the-hood" className="text-sm font-medium text-accent hover:underline">
              All walkthroughs →
            </Link>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {walkthroughs.map((w) => (
              <Link key={w.id} href={w.href} className="rounded-xl border border-border bg-surface p-4 hover:border-border-strong">
                <div className="font-medium text-fg">{w.title}</div>
                <div className="mt-1 text-[12.5px] text-subtle">{w.stepCount} steps</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Honesty */}
      <section className="mt-16 rounded-2xl border border-border bg-surface p-6">
        <div className="flex items-start gap-4">
          <FlaskConical className="mt-1 h-5 w-5 shrink-0 text-accent" />
          <div>
            <h2 className="font-semibold text-fg">What this academy is — and is not</h2>
            <p className="mt-2 max-w-3xl text-[14.5px] text-muted">
              It will give you accurate mental models, the vocabulary interviewers expect, and enough mechanism to reason through questions you have never seen. The
              🔴 Senior Touch material gives <em>conceptual exposure</em> to what senior engineers deal with. It does not replace the judgment that comes from operating
              real systems — and the best candidates are honest about that difference.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
