// Runs every graded SQL exercise against the real seed in PGlite and checks
// that the reference solutions work, that data-modification exercises change
// something, and that the classic wrong answers are actually rejected.
// Usage: npx tsx scripts/_verify-sql.mts
import { PGlite } from "@electric-sql/pglite";
import { PLAYGROUND_SEED, PLAN_SEED } from "../src/lib/sql/seed";
import { SQL_EXERCISES, compareResults, type SqlExercise } from "../src/lib/sql/exercises";
import { formatValue } from "../src/lib/sql/pglite";

// Plausible wrong answers the grader must reject.
const WRONG: Record<string, string> = {
  "never-ordered": "SELECT id, name FROM customers WHERE id NOT IN (SELECT customer_id FROM orders);",
  "cheap-books-toys": "SELECT name, category, price FROM products WHERE category = 'Books' OR category = 'Toys' AND price < 2000 ORDER BY price;",
  "cancel-rate": "SELECT round(100 * (count(*) FILTER (WHERE status = 'cancelled') / count(*)), 2) FROM orders;",
  "employee-departments": "SELECT e.name, d.name FROM employees e JOIN departments d ON d.id = e.department_id;",
  "high-earner-departments": "SELECT d.name FROM departments d JOIN employees e ON e.department_id = d.id WHERE e.salary > 150000;",
  headcount: "SELECT d.name, count(*) FROM departments d LEFT JOIN employees e ON e.department_id = d.id GROUP BY d.id, d.name;",
  "third-in-department": "SELECT department_id, name, salary FROM (SELECT e.*, row_number() OVER (PARTITION BY department_id ORDER BY salary DESC) r FROM employees e WHERE department_id IS NOT NULL) t WHERE r = 3;",
  "moving-average": "WITH daily AS (SELECT order_date AS day, sum(total) AS revenue FROM orders WHERE status <> 'cancelled' AND order_date >= DATE '2024-06-01' AND order_date < DATE '2024-07-01' GROUP BY 1) SELECT day, revenue, round(avg(revenue) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 2) FROM daily ORDER BY day;",
  "third-page": "SELECT id, order_date FROM orders ORDER BY order_date DESC, id DESC LIMIT 10 OFFSET 30;",
  "login-streaks": "SELECT user_id FROM logins GROUP BY user_id HAVING count(*) >= 3;",
  "price-quartiles": "SELECT name, price, ntile(4) OVER (ORDER BY price DESC) FROM products ORDER BY price;",
  "remove-dormant": "DELETE FROM customers WHERE id NOT IN (SELECT customer_id FROM orders WHERE customer_id IS NOT NULL);",
  "mumbai-raise": "UPDATE employees SET salary = salary * 1.05 WHERE department_id = 2;",
  "reprice-pending": "UPDATE order_items SET unit_price = 30000 WHERE product_id = 9;",
};

const rows = (r: { rows: unknown[] }) => (r.rows as unknown[][]).map((row) => row.map(formatValue));

async function resultOf(db: PGlite, ex: SqlExercise, sql: string): Promise<string[][]> {
  if (!ex.check) {
    const rs = await db.exec(sql, { rowMode: "array" });
    const last = [...rs].reverse().find((r) => r.fields.length > 0);
    if (!last) throw new Error("no result set");
    return rows(last);
  }
  await db.exec("BEGIN");
  try {
    await db.exec(sql);
    return rows(await db.query(ex.check, [], { rowMode: "array" }));
  } finally {
    await db.exec("ROLLBACK");
  }
}

const t0 = Date.now();
const db = await PGlite.create();
await db.exec(PLAYGROUND_SEED);
console.log(`playground seed: ${Date.now() - t0} ms`);
for (const t of ["departments", "employees", "customers", "products", "orders", "order_items", "logins"]) {
  const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`);
  process.stdout.write(`${t}=${r.rows[0].n} `);
}
console.log();

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.log(`  ✗ ${msg}`);
};

for (const ex of SQL_EXERCISES) {
  try {
    const got = await resultOf(db, ex, ex.solution);
    console.log(`\n# ${ex.id} [${ex.section} L${ex.level}]: ${got.length} rows`);
    for (const row of got.slice(0, 4)) console.log("   ", row.join(" | "));
    if (!got.length) fail(`${ex.id}: the reference solution returns no rows`);
    if (got[0] && got[0].length !== ex.columns.length) fail(`${ex.id}: ${got[0].length} columns, but the prompt lists ${ex.columns.length}`);
    if (ex.ordered && !ex.check && !/order\s+by/i.test(ex.solution.slice(ex.solution.lastIndexOf(")") + 1))) fail(`${ex.id}: ordered but the solution has no final ORDER BY`);
    if (ex.check) {
      // The check may read a table or column the exercise creates; then it can't run beforehand.
      const before = await db.query(ex.check, [], { rowMode: "array" }).then(rows, () => null);
      if (before && compareResults(before, got, true).ok) fail(`${ex.id}: the solution doesn't change what the check reads`);
    }
    // Run twice: the result must be deterministic (and DML must have been rolled back).
    const again = await resultOf(db, ex, ex.solution);
    if (!compareResults(again, got, ex.ordered).ok) fail(`${ex.id}: a second run gives a different result`);
    const wrong = WRONG[ex.id];
    if (wrong) {
      let verdict: string;
      try {
        verdict = compareResults(await resultOf(db, ex, wrong), got, ex.ordered).ok ? "ACCEPTED" : "rejected";
      } catch (e) {
        verdict = `rejected (error: ${(e as Error).message.slice(0, 60)})`;
      }
      console.log(`    wrong answer → ${verdict}`);
      if (verdict === "ACCEPTED") fail(`${ex.id}: the grader accepts the classic wrong answer`);
    }
  } catch (e) {
    fail(`${ex.id}: ERROR ${(e as Error).message}`);
  }
}

const orphanCheck = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM employees WHERE id = 31");
if (orphanCheck.rows[0].n !== 0) fail("a data-modification exercise leaked out of its transaction");

const t1 = Date.now();
const db2 = await PGlite.create();
await db2.exec(PLAN_SEED);
console.log(`\nplan seed: ${Date.now() - t1} ms`);

console.log(failures ? `\n${failures} problem(s).` : `\nAll ${SQL_EXERCISES.length} exercises verified.`);
process.exit(failures ? 1 : 0);
