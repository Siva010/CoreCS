# Content guide

Everything learners read lives in `content/` as Markdown. `npm run validate` parses and renders all of it; **a content change isn't done until validation passes with zero errors.**

```
content/
  structure.ts          subjects, levels, stages, roadmaps
  lessons/{os,cn,db,x}/ concept lessons (one file per lesson, filename = lesson id)
  case-studies/         incident write-ups
  under-the-hood/       step-by-step walkthroughs
  traps.md              interview traps (one file, many sections)
```

## Lessons

File name is the lesson id (`db-index-fundamentals.md` → `db-index-fundamentals`). The URL is `/{subject path}/{id without the subject prefix}`. SQL lessons use `sql-*` ids but live in
`content/lessons/db` with `subject: db`.

### Frontmatter

```yaml
---
title: "Index Fundamentals: What an Index Is and When It Helps"
subject: db                 # os | cn | db | x — must match the folder
level: 7                    # a level defined for this subject in structure.ts
order: 1                    # position within the level
summary: "One or two sentences shown in listings and search."
depth: core                 # beginner | core | advanced | senior
difficulty: 2               # 1–5
minutes: 40                 # realistic reading time
relevance: essential        # essential | high | medium | low (for interviews)
stage: 2                    # 1–4 study stage; a lesson may not depend on a later stage
prerequisites: [db-btree, sql-select-basics]
related: [db-explain, x-slow-query]
visualizations: [btree]     # widget ids with kind "viz"
labs: [query-plan]          # widget ids with kind "lab"
tags: [index, selectivity, sargable]
---
```

The validator checks: required fields, subject/folder match, level exists, prerequisites and related ids exist, widget ids exist **and have the right kind**, no cycles in the prerequisite
graph, and that prerequisites don't sit in a later stage or later position in the same subject.

### Sections

Use `##` headings from this list (aliases in `src/lib/content/types.ts`), in any order — they're sorted into the canonical order at build time:

`Mental Model` · `Definition` · `Why It Exists` · `How It Works` · `Internal Mechanism` · `Example` · `Complexity & Performance` · `Trade-offs` · `Failure Modes` · `In Production` ·
`Deeper Connections` · `Common Misconceptions` · `Interview Questions` · `Practice` · `Quick Revision`

`Mental Model` and `Quick Revision` are required in practice (the validator warns without them). Unknown headings are errors.

### Markdown extensions

| Syntax | Renders as |
|---|---|
| `:::depth{level=advanced}` … `:::` | Content hidden unless the reader raises the depth filter (`advanced`, `senior`) |
| `:::callout{type=insight}[Optional title]` … `:::` | Callout — `note, tip, insight, warning, danger, interview, production` |
| `:::details[Summary]` … `:::` | Collapsible block |
| `:::compare[Title]` … `:::`, `:::steps` … `:::` | Comparison / numbered-steps block |
| `::viz{id=btree}` / `::lab{id=query-plan}` | Embeds a widget inline (also lists it in the lesson's widget section) |
| `[text](lesson:db-btree)` | Link to a lesson — also `lab:`, `viz:`, `case:`, `uth:`, `trap:` |
| ` ```mermaid ` | Mermaid diagram, themed for light/dark |

Raw HTML is stripped — use Markdown or the directives above.

### Interview questions

Inside `## Interview Questions`, one `###` per question:

```markdown
### [L2 · debugging] Why might the database not use an index on a column you filter by?

The predicate may not be selective … (plain answer, no self-corrections)

### [L3 · sql] Find customers who never ordered.

:::answer
Wrap the answer in :::answer when the prompt contains code or a schema the learner should see first.
:::
```

Levels are `L1`–`L4` (Basic, Intermediate, Advanced, Senior Touch). Types: `conceptual, why, how, what-if, debugging, scenario, numerical, trace, sql, optimization, diagram, compare, design,
failure, incident`.

### Practice

Inside `## Practice`:

```markdown
### [mcq] Which predicate can use a B+ tree index on `email`?

- [ ] `WHERE lower(email) = 'a@x.com'`
- [x] `WHERE email LIKE 'asha%'`

Explanation shown after answering.

### [numeric 128 unit=rows] How many rows fit per page …?

:::answer
8192 / 64 = **128** rows per page.
:::

### [exercise] Write the DDL for …

:::solution
…
:::
```

For numeric items: **work the number out before writing the heading**. The validator fails the build if the bolded number in the worked answer disagrees with the key, and flags explanations
that read like unfinished self-corrections. Tolerance defaults to 1%; set it with `[numeric 4.67 ±0.01]`.

## Case studies

`content/case-studies/<id>.md`:

```yaml
---
title: "The Admin Dashboard That Slowed Down Checkout"
subject: db              # os | cn | db | x
summary: "One sentence for the index page."
difficulty: 2
concepts: [db-index-fundamentals, db-explain]   # lesson ids
tags: [missing index, io saturation]
order: 1
---
```

Then `##` sections in this order: **Context, Symptoms, Metrics, Hypotheses, Investigation, Root Cause, Fix, Prevention, Interview Angle**. Keep numbers internally consistent — they're the
point of the exercise.

## Under-the-hood walkthroughs

`content/under-the-hood/<id>.md` with `title`, `summary`, `subjects`, `order`, `related`, then one `##` per step:

```markdown
## [kernel] fork(): clone the shell
```

The bracketed id picks the lane colour/label (`user, browser, app, runtime, driver, kernel, scheduler, cpu, mmu, memory, fs, disk, nic, network, dns, tcp, tls, http, lb, server, db, planner,
executor, buffer, wal, replica, locks, firmware, bootloader, shell`); unknown ids still render with a generated label.

## Traps

`content/traps.md`, one `##` per trap:

```markdown
## [db] "An index makes queries faster"

**Correction:** … one sentence that can be said out loud in an interview.

Short elaboration with a [lesson link](lesson:db-index-fundamentals).
```

## Widgets

Add the definition to `src/lib/registry.ts` (id, title, subject, `kinds: ["lab"]`/`["viz"]`, description, `tryThis`, related lessons), create the component in
`src/components/widgets/<subject>/<Name>.tsx`, and register it in `src/components/widgets/index.tsx`. Widgets are client components loaded lazily; keep simulation logic in pure exported
functions so it can be tested headlessly with `npx tsx`.

## House style

- Teach the mechanism, then the consequence. No filler, no "as we all know".
- Numbers must be defensible: state assumptions (RTT, page size, row width) and keep arithmetic consistent across a lesson.
- Prefer concrete failure stories to adjectives; name the signal an engineer would actually see.
- Every claim about PostgreSQL/MySQL behavior should be true for a current version, with the differences called out where they matter.
