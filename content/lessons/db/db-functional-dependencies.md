---
title: "Functional Dependencies, Closures and Candidate Keys"
subject: db
level: 5
order: 2
summary: "The formal tool behind normalization: what X → Y means, Armstrong's axioms, attribute closure, finding all candidate keys, and minimal covers — worked step by step the way exams and interviews ask."
depth: core
difficulty: 3
minutes: 40
relevance: medium
stage: 1
prerequisites: [db-er-modeling]
related: [db-normalization, db-keys-constraints, db-schema-design]
labs: [normalization]
tags: [functional dependency, armstrong's axioms, attribute closure, candidate key, super key, prime attribute, minimal cover, canonical cover, transitive dependency, partial dependency]
---

## Mental Model

A functional dependency **X → Y** says: *if you know X, Y is determined*. Two rows that agree on X must agree on Y. `email → name` means one email never appears with two different names.

FDs are **facts about the real world** (business rules), not about the current data. The rows in a table can suggest an FD, but only the domain can confirm it: "every employee has one department" is a rule; "no two current employees share a birthday" is a coincidence.

Everything in normalization — keys, partial and transitive dependencies, BCNF — is computed from the FDs.

## Definition

- **X → Y** holds in relation R if for all rows t1, t2: t1[X] = t2[X] ⇒ t1[Y] = t2[Y].
- **Trivial FD**: Y ⊆ X (e.g., `{A, B} → A`) — always true.
- **Closure of attributes X⁺**: the set of all attributes determined by X under the given FDs.
- **Super key**: X with X⁺ = all attributes. **Candidate key**: minimal super key.
- **Prime attribute**: an attribute that belongs to *some* candidate key.
- **Minimal (canonical) cover**: an equivalent, simplified set of FDs — single attribute on the right, no redundant left-hand attributes, no redundant FDs.

**Armstrong's axioms** (sound and complete — they derive every implied FD):

1. **Reflexivity**: if Y ⊆ X then X → Y.
2. **Augmentation**: if X → Y then XZ → YZ.
3. **Transitivity**: if X → Y and Y → Z then X → Z.

Derived rules: **union** (X → Y, X → Z ⇒ X → YZ), **decomposition** (X → YZ ⇒ X → Y), **pseudo-transitivity** (X → Y, WY → Z ⇒ WX → Z).

## Why It Exists

To normalize a schema you must answer precisely: "Is this attribute set a key?", "Does this non-key attribute depend on only part of the key?", "Is this decomposition lossless?". FDs and closures make those answers mechanical instead of intuitive.

## How It Works

### Computing a closure X⁺

Algorithm: start with X; repeatedly, for every FD A → B with A ⊆ current set, add B; stop when nothing changes.

Example: R(A, B, C, D, E), F = { A → B, B → C, CD → E }.

Compute {A, D}⁺:

| Step | Set | Reason |
|---|---|---|
| 0 | {A, D} | start |
| 1 | {A, B, D} | A → B |
| 2 | {A, B, C, D} | B → C |
| 3 | {A, B, C, D, E} | CD → E |

{A, D}⁺ = all attributes → {A, D} is a super key.

### Finding all candidate keys

1. Attributes that appear on **no right-hand side** must be in every key (nothing determines them). Here: A and D.
2. Attributes only on right-hand sides are never in a minimal key. Here: E.
3. Start from the must-have set; if its closure is everything, it is the **only** candidate key. Otherwise add the "middle" attributes (appearing on both sides) in increasing combinations, keeping only minimal results.

Here {A, D}⁺ = all, so **{A, D} is the unique candidate key**. Prime attributes: A, D.

### A two-key example

R(A, B, C), F = { A → B, B → A, A → C }.

- No attribute is missing from all right-hand sides (A and B both appear on right sides), so try single attributes.
- A⁺ = {A, B, C} ✔ key. B⁺ = {B, A, C} ✔ key. C⁺ = {C}.
- Candidate keys: **{A}** and **{B}**.

### Minimal cover

F = { A → BC, B → C, A → B, AB → C }:

1. Split right sides: A → B, A → C, B → C, A → B, AB → C → remove the duplicate: {A → B, A → C, B → C, AB → C}.
2. Remove extraneous left attributes: in AB → C, is B extraneous? A⁺ under F = {A, B, C} contains C → yes, AB → C becomes A → C (duplicate, remove).
3. Remove redundant FDs: is A → C implied by the others {A → B, B → C}? A⁺ = {A, B, C} → yes, remove it.

Minimal cover: **{ A → B, B → C }**.

::lab{id=normalization}

## Internal Mechanism

:::depth{level=advanced}
### Why closure answers implication questions

X → Y is implied by F **iff** Y ⊆ X⁺ (computed under F). This turns "can this FD be derived with Armstrong's axioms?" into a linear-time set computation, avoiding proof search.

### Lossless-join test for a binary decomposition

Decomposing R into R1 and R2 is lossless iff the common attributes are a key of at least one side: (R1 ∩ R2) → R1 or (R1 ∩ R2) → R2. Otherwise joining the pieces back produces **spurious tuples**.

### Dependency preservation

A decomposition preserves dependencies if every FD can be checked within a single piece (the union of the projected FDs implies F). 3NF synthesis always achieves lossless + dependency-preserving; BCNF decomposition is lossless but may lose some dependencies ([Normalization](lesson:db-normalization)).

### Complexity

Closure is polynomial, but *finding all candidate keys* can be exponential — a relation can have exponentially many keys. In practice schemas are small and keys obvious.
:::

## Example

`Enrollment(student_id, course_id, student_name, course_title, instructor, grade)` with rules:

- student_id → student_name
- course_id → course_title, instructor
- student_id, course_id → grade

Must-have attributes (never on a right side): student_id, course_id. Closure {student_id, course_id}⁺ = everything → the only candidate key.

`student_name` depends on **part** of the key (student_id) — a *partial dependency*, the signature of a 2NF violation that normalization will remove.

## Complexity & Performance

Pen-and-paper: closure is at most |attributes| passes over F. No runtime cost in a database — FDs don't exist as objects in SQL; they're enforced indirectly through keys and UNIQUE constraints after normalization.

## Trade-offs

Modeling every FD formally is overkill for most application schemas; the value is (1) recognizing redundancy quickly and (2) answering exam/interview questions rigorously. The practical habit: for each non-key column, ask "does this depend on the whole key, and only the key?"

## Failure Modes

- **Inferring FDs from sample data**: a coincidence becomes a "rule" and drives a wrong design.
- **Forgetting that the key must be minimal** — calling a super key a candidate key.
- **Missing attributes that appear on no right side** — they're always part of every key.

## In Production

You won't compute closures at work, but you'll constantly detect FDs informally: "city → state, so storing both on every order duplicates data", "sku → price at time of catalog, but order price must be copied because it's a historical fact" (the FD `sku → price` does **not** hold across time).

## Deeper Connections

- A UNIQUE constraint is how an FD "X → all columns" is enforced ([Keys & Constraints](lesson:db-keys-constraints)).
- The optimizer uses FDs too: knowing `id → name` lets PostgreSQL accept `GROUP BY id` while selecting `name` ([Aggregation](lesson:sql-aggregation)).

## Common Misconceptions

- **"FDs can be discovered from the data."** Data can refute an FD, never prove one.
- **"A → B implies B → A."** FDs are directional.
- **"If AB → C then A → C."** Not in general — the left side can't be split (the right side can).

## Interview Questions

### [L2 · numerical] R(A, B, C, D), F = { AB → C, C → D, D → A }. Find all candidate keys.

:::answer
B appears on no right-hand side, so it's in every key. B⁺ = {B} — not a key. Try adding one attribute:

- AB⁺: AB → C, C → D → {A, B, C, D} ✔
- BC⁺: C → D, D → A → {A, B, C, D} ✔
- BD⁺: D → A, AB → C → {A, B, C, D} ✔

All three are minimal (B alone isn't a key). Candidate keys: **AB, BC, BD**. Every attribute is prime.
:::

### [L2 · conceptual] What is the closure of a set of attributes and why is it useful?

X⁺ is the set of attributes functionally determined by X under the FDs, computed by repeatedly applying FDs whose left sides are contained in the current set. It tells you whether X is a super key (X⁺ = all attributes), whether an FD X → Y is implied (Y ⊆ X⁺), and it's the basic step in finding keys, minimal covers and checking normal forms.

### [L1 · compare] Partial vs transitive dependency?

A partial dependency is a non-prime attribute depending on a proper subset of a candidate key (violates 2NF). A transitive dependency is a non-prime attribute depending on another non-key attribute set, which in turn depends on the key: key → X → Y (violates 3NF).

## Practice

### [mcq] R(A, B, C, D, E), F = { A → B, B → C, CD → E }. What is {A}⁺?

- [ ] {A}
- [ ] {A, B}
- [x] {A, B, C}
- [ ] {A, B, C, D, E}

A → B, then B → C; CD → E needs D, which A doesn't determine.

### [mcq] R(A, B, C), F = { A → B, B → C }. Which is a candidate key?

- [x] {A}
- [ ] {B}
- [ ] {A, B}
- [ ] {C}

A⁺ = {A, B, C}; {A, B} is a super key but not minimal.

## Quick Revision

- X → Y: equal X ⇒ equal Y. A business rule, not a data pattern.
- Armstrong: reflexivity, augmentation, transitivity (+ union, decomposition, pseudo-transitivity).
- Closure X⁺ by repeated application; X is a super key iff X⁺ = all attributes.
- Keys: attributes on no RHS are in every key; RHS-only attributes are in none; grow from the must-have set.
- Minimal cover: split RHS, drop extraneous LHS attributes, drop redundant FDs.
- Lossless binary split iff the shared attributes are a key of one side.
