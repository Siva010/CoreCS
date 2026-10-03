# Core CS Interview Academy

**Understand the machine. Master the interview.**

A mechanism-first curriculum covering Operating Systems, Computer Networks and Databases (with SQL), built as a Next.js site: 150 concept lessons, 700+ interview questions, 300+ practice
items, 40 browser labs and visualizations (including a real PostgreSQL compiled to WebAssembly), 18 incident case studies, 16 "under the hood" walkthroughs and a page of interview traps.

The goal isn't to list answers to memorize. It's to teach enough of the underlying systems that the answers become consequences of understanding.

## Running it

```bash
npm install          # also copies PGlite into public/vendor/pglite (postinstall)
npm run dev          # http://localhost:3000
```

Other scripts:

| Script | What it does |
|---|---|
| `npm run validate` | Parses and renders all content, checks the curriculum graph, links, questions and practice items |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run check` | typecheck + validate (run this before committing content or widget changes) |
| `npm run build` | Production build (static pages for every lesson, lab and case study) |

`npm run validate -- --all` also prints warnings (missing recommended sections, stage ordering, roadmap references).

## How the site is organized

| Route | Contents |
|---|---|
| `/` | Overview, progress snapshot, next unlocked lesson |
| `/path`, `/path/[roadmap]` | Study stages and the Fresher / 1–3 YOE / 3–5+ YOE roadmaps |
| `/os`, `/networks`, `/databases`, `/databases/sql`, `/connections` | Subject pages with the level list and the dependency graph |
| `/os/[slug]` etc. | Concept lessons (17 standard sections, depth filtering, revision modes) |
| `/interview` | Interview mode: drills, mock sets, due questions, browsing by topic |
| `/labs`, `/labs/[id]`, `/visualizations`, `/visualizations/[id]` | Interactive simulators |
| `/case-studies`, `/under-the-hood`, `/traps` | Incidents, step-by-step walkthroughs, misconceptions |
| `/revision`, `/revision/[subject]`, `/progress` | Spaced repetition, cheat sheets, progress and mastery |

## Architecture

- **Content**: Markdown in `content/` with frontmatter, compiled at build time (`src/lib/content/`) through a unified/remark/rehype pipeline with custom directives (`:::depth`, `:::callout`,
  `::viz{id=…}`, `lesson:`/`lab:`/`case:` links), Mermaid diagrams and syntax highlighting. `content/structure.ts` defines subjects, levels, stages and roadmaps.
- **Widgets**: `src/components/widgets/` — one component per simulator, lazily loaded by id from `src/lib/registry.ts`.
- **SQL labs**: PGlite (PostgreSQL in WebAssembly) runs in a Web Worker (`public/vendor/sql-worker.js`), so a runaway query can be cancelled by terminating the worker. Seeds, exercises and
  grading live in `src/lib/sql/`.
- **Progress**: a Zustand store persisted to `localStorage` (`src/lib/progress/`), with SM-2 style spaced repetition, mastery estimation and a revision queue. Nothing leaves the browser.
- **Search**: a static `/search-index.json` consumed by MiniSearch in the ⌘K palette.

See [CONTENT_GUIDE.md](CONTENT_GUIDE.md) for how to write or extend lessons, questions, case studies and walkthroughs.

## Content at a glance

| Subject | Lessons | Levels |
|---|---|---|
| Operating Systems | 45 | 12 (mental model → processes → concurrency → scheduling → sync → deadlocks → memory → virtual memory → storage/IO → kernel boundary → performance → isolation) |
| Computer Networks | 42 | 12 (how data travels → models → Ethernet → IP → TCP → UDP → DNS → HTTP → TLS → web infrastructure → performance → advanced) |
| Databases & SQL | 55 | 16 (why databases → relational model → SQL → joins → advanced SQL → modeling → storage → indexing → execution → transactions → concurrency → recovery → replication → sharding → NoSQL → distributed) |
| Cross-domain connections | 8 | 2 (end-to-end journeys, unifying patterns) |

Every lesson declares its prerequisites, so the curriculum is a dependency graph rather than a list; the validator rejects cycles, unknown references and stage inversions.
