---
title: "Normalization: 1NF to BCNF, and When to Denormalize"
subject: db
level: 5
order: 3
summary: "Update, insert and delete anomalies; what each normal form forbids and why; lossless decomposition to 3NF and BCNF worked end to end; 4NF in one idea; and the honest trade-offs of denormalization."
depth: core
difficulty: 3
minutes: 50
relevance: essential
stage: 1
prerequisites: [db-functional-dependencies]
related: [db-er-modeling, db-schema-design, sql-joins, db-column-stores, db-document-stores, x-caching-everywhere]
visualizations: []
labs: [normalization]
tags: [normalization, 1nf, 2nf, 3nf, bcnf, 4nf, update anomaly, insert anomaly, delete anomaly, partial dependency, transitive dependency, lossless decomposition, dependency preservation, denormalization]
---

## Mental Model

Normalization is one principle applied repeatedly: **every fact should be stored exactly once, in the table whose key it describes**. When a fact is duplicated, it can be updated in one place and not the other, and the database contradicts itself.

The normal forms are progressively stricter checks of "does every non-key column describe **the key, the whole key, and nothing but the key**?"

- 1NF: … a key (atomic values, a key exists)
- 2NF: … the **whole** key (no partial dependencies)
- 3NF: … **nothing but** the key (no transitive dependencies)
- BCNF: every determinant is a key, no exceptions

## Definition

| Normal form | Rule | Violation looks like |
|---|---|---|
| **1NF** | Atomic values; no repeating groups; rows identifiable by a key | `phones = '98xx, 99xx'`, columns `item1, item2, item3` |
| **2NF** | 1NF + no non-prime attribute depends on a *proper part* of a candidate key | `student_name` depends on `student_id` alone in `(student_id, course_id) → …` |
| **3NF** | 2NF + no non-prime attribute depends on another non-prime attribute (no transitive dependency). Formally: for every FD X → A, X is a super key **or A is prime** | `dept_id → dept_name` inside an `employees` table |
| **BCNF** | For every non-trivial FD X → Y, X is a super key | a non-key determinant of a prime attribute (see example below) |
| **4NF** | BCNF + no non-trivial multi-valued dependencies except on keys | independent lists stored in one table |

## Why It Exists

A single wide table `orders_flat(order_id, order_date, customer_id, customer_name, customer_city, product_id, product_name, qty, price)` shows all three **anomalies**:

- **Update anomaly**: a customer moves city → update every one of their order rows; miss one and the data disagrees with itself.
- **Insert anomaly**: you can't record a new customer until they place an order (no order_id to form the key).
- **Delete anomaly**: delete a customer's only order and you lose the customer entirely.

Decomposing into `customers`, `orders`, `products`, `order_items` removes all three: each fact lives in one row.

## How It Works

### Step through the forms

Start: `Enrollment(student_id, course_id, student_name, course_title, dept_id, dept_name, grade)`

FDs:
- student_id → student_name
- course_id → course_title, dept_id
- dept_id → dept_name
- student_id, course_id → grade

Candidate key: (student_id, course_id).

**2NF** — remove partial dependencies (attributes depending on only part of the key):

```text
Students(student_id, student_name)
Courses(course_id, course_title, dept_id, dept_name)
Enrollment(student_id, course_id, grade)
```

**3NF** — remove transitive dependencies (course_id → dept_id → dept_name):

```text
Courses(course_id, course_title, dept_id)
Departments(dept_id, dept_name)
```

Final: Students, Courses, Departments, Enrollment — each non-key attribute depends on the key, the whole key and nothing but the key.

### 3NF vs BCNF: the one case where they differ

`Teaching(student, subject, teacher)`: each teacher teaches one subject (teacher → subject); for each subject, a student has one teacher ((student, subject) → teacher).

- Candidate keys: (student, subject) and (student, teacher).
- teacher → subject: teacher is not a super key, but subject is **prime** → allowed by 3NF, **violates BCNF**.
- Anomaly: "Dr. Rao teaches Physics" is repeated for every student of Dr. Rao.

BCNF decomposition on teacher → subject: `TeacherSubject(teacher, subject)` and `StudentTeacher(student, teacher)`. Lossless (the common attribute `teacher` is a key of TeacherSubject) — but the FD (student, subject) → teacher now spans two tables and **can't be enforced by a single key**. That's the classic trade-off: BCNF can cost dependency preservation; 3NF never does.

::lab{id=normalization}

### Lossless vs lossy decomposition

Splitting must not invent data when you join back. `R(A, B, C)` split into `R1(A, B)` and `R2(B, C)` is lossless only if B is a key of R1 or R2. Otherwise, the join produces spurious rows — rows that were never in R ([Functional Dependencies](lesson:db-functional-dependencies)).

### 4NF in one idea

`EmployeeSkillsLanguages(emp, skill, language)` where skills and languages are independent lists: storing them in one table forces every skill × language combination (3 skills × 2 languages = 6 rows), and adding a language means adding 3 rows. Split into `EmployeeSkills(emp, skill)` and `EmployeeLanguages(emp, language)`. The underlying rule is a **multi-valued dependency** emp ↠ skill.

## Internal Mechanism

:::depth{level=advanced}
### Algorithms

- **3NF synthesis**: compute a minimal cover; create one table per FD group (X → A1…An becomes table (X, A1…An)); if no table contains a candidate key, add one; remove tables contained in others. Guarantees lossless join and dependency preservation.
- **BCNF decomposition**: while some table has an FD X → Y with X not a super key, split into (X ∪ Y) and (R − Y + X). Always lossless; may lose dependencies.

### Why normalization reduces write cost but may raise read cost

Normalized tables are narrower: an update touches one small row and fewer index entries. Reads that need data from several tables pay for joins — usually cheap with indexes, occasionally dominant on hot paths. That asymmetry is the whole normalization/denormalization debate.
:::

## Example

Is this table in 3NF? `Orders(order_id, customer_id, customer_email, total)` with order_id → everything, customer_id → customer_email.

- Key: order_id. customer_email depends on customer_id (non-key) → **transitive dependency** → not 3NF.
- Symptom: a customer changing their email must be updated in every order row.
- Fix: move `customer_email` to `customers`.

But **order price snapshots are not a violation**: `order_items.unit_price` records the price *at purchase time*, a different fact from `products.price` (the current price). Copying it is correct modeling, not denormalization — the FD `product_id → price` doesn't hold across time.

## Complexity & Performance

- Normalized: minimal storage, cheap and safe writes, joins at read time (O(log n) index lookups per joined row).
- Denormalized: faster single-table reads, larger rows, write amplification (update N copies), and code/triggers/jobs to keep copies consistent.

## Trade-offs

**When to denormalize** — deliberately, with a mechanism to keep copies consistent:

| Technique | Example | Consistency mechanism |
|---|---|---|
| Counter/summary columns | `posts.comment_count` | same transaction, trigger, or async job |
| Copied attributes for read paths | `orders.customer_name` for invoices (also a historical snapshot) | set at write time; intentionally not updated |
| Materialized views / rollup tables | daily revenue | scheduled refresh ([Views](lesson:sql-views-programmability)) |
| Search/analytics copies | Elasticsearch, warehouse | change data capture |
| Document/NoSQL modeling | embed order items in the order document | the aggregate is written as a unit ([Document Stores](lesson:db-document-stores)) |

Analytical warehouses use **star schemas** (denormalized dimension tables around a fact table) because they're read-mostly and scan-heavy ([Column Stores](lesson:db-column-stores)).

## Failure Modes

- **Over-normalization**: splitting 1:1 attributes into many tables or modeling every string as a lookup table — joins everywhere for no integrity gain.
- **Denormalization without a sync mechanism**: copies drift; nobody knows which is right.
- **Repeating groups disguised as columns** (`phone1`, `phone2`, `phone3`) or JSON arrays holding relational data that you then need to join or constrain.
- **Confusing historical snapshots with redundancy** — "normalizing" order prices back to the product table rewrites history when prices change.

## In Production

- OLTP schemas are typically 3NF with targeted denormalization for hot read paths.
- Most "normalization" discussions at work are about specific duplicated facts: "if this changes, where else must it change?" If the answer isn't "nowhere" or "handled automatically", you have a latent consistency bug.

## Deeper Connections

- Denormalized copies are caches, with all the invalidation problems of caches ([Caching Everywhere](lesson:x-caching-everywhere)).
- Document databases choose "denormalize the aggregate" as the default; relational databases choose "normalize and join" ([NoSQL Landscape](lesson:db-nosql-landscape)).

## Common Misconceptions

- **"Normalized means slow."** Indexed joins are fast; the problems are usually missing indexes or fan-out.
- **"3NF and BCNF are the same."** They differ when a non-key attribute determines part of a candidate key.
- **"Higher normal form is always better."** BCNF can sacrifice dependency preservation; practical designs usually target 3NF/BCNF and denormalize deliberately.

## Interview Questions

### [L1 · conceptual] What problems does normalization solve?

Redundancy and the anomalies it causes: update anomalies (a fact changed in one copy but not others), insertion anomalies (can't store a fact without an unrelated one), and deletion anomalies (deleting one fact loses another). Normalization stores each fact once, in the table whose key it depends on.

### [L2 · compare] Explain 1NF, 2NF, 3NF and BCNF.

1NF: atomic values, no repeating groups, a key exists. 2NF: no non-prime attribute depends on part of a candidate key. 3NF: no non-prime attribute depends transitively on a key (for every FD X → A, X is a super key or A is prime). BCNF: for every non-trivial FD X → Y, X is a super key — stricter than 3NF when a non-key determines a prime attribute.

### [L2 · numerical] R(A, B, C, D), key A, FDs A → B, A → C, C → D. Highest normal form? Decompose to 3NF.

:::answer
Single-attribute key → no partial dependencies → 2NF holds. C → D is a transitive dependency (C is not a super key, D is not prime) → not 3NF. Decompose into R1(A, B, C) and R2(C, D). Lossless because C is the key of R2; both FDs are preserved. Both tables are also in BCNF.
:::

### [L3 · design] Would you store `comment_count` on the posts table? Justify.

It's a deliberate denormalization: listing pages would otherwise count comments per post on every read. Store it if read volume justifies it, and keep it consistent — increment in the same transaction as the comment insert (or via trigger), or recompute asynchronously if slight staleness is acceptable. Beware hot-row contention on viral posts: batch increments or use sharded counters. Periodically reconcile against the true count.

## Practice

### [mcq] `EmployeeProject(emp_id, project_id, emp_name, hours)` with key (emp_id, project_id) and emp_id → emp_name. Which normal form is violated first?

- [ ] 1NF
- [x] 2NF
- [ ] 3NF only
- [ ] BCNF only

emp_name depends on part of the composite key — a partial dependency.

### [mcq] Which decomposition of R(A, B, C) with FD B → C is lossless?

- [x] R1(A, B), R2(B, C)
- [ ] R1(A, B), R2(A, C)
- [ ] R1(A, C), R2(B, C)
- [ ] R1(A), R2(B, C)

The shared attribute B is a key of R2(B, C), so the join can't create spurious tuples.

### [exercise] Normalize `Invoice(invoice_no, invoice_date, customer_id, customer_name, product_code, product_desc, qty, unit_price)` where one invoice has many lines.

:::solution
FDs: invoice_no → invoice_date, customer_id; customer_id → customer_name; product_code → product_desc; (invoice_no, product_code) → qty, unit_price. Key: (invoice_no, product_code).

```text
Customers(customer_id, customer_name)
Invoices(invoice_no, invoice_date, customer_id → Customers)
Products(product_code, product_desc)
InvoiceLines(invoice_no → Invoices, product_code → Products, qty, unit_price)
```

`unit_price` stays on InvoiceLines: it's the price charged on that invoice (a historical fact), not the product's current price.
:::

## Quick Revision

- Anomalies: update, insert, delete — all from storing a fact more than once.
- 1NF atomic; 2NF whole key; 3NF nothing but the key (or prime RHS); BCNF every determinant is a super key; 4NF no independent multi-valued facts in one table.
- 3NF synthesis: lossless + dependency-preserving. BCNF: lossless, may lose dependencies.
- Lossless split: shared attributes are a key of one side.
- Denormalize deliberately, with a sync mechanism; historical snapshots aren't redundancy.
