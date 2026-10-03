// Graded exercises for the SQL Playground. A learner's query is checked by
// running the reference solution against the same database and comparing
// result sets (as multisets, or as sequences when `ordered` is set). Column
// names don't matter; column order and values do.

export interface SqlExercise {
  id: string;
  title: string;
  level: 1 | 2 | 3 | 4;
  topic: string;
  prompt: string;
  /** Result columns the learner should return, in order. */
  columns: string[];
  ordered: boolean;
  hint: string;
  solution: string;
  lesson: string;
}

export const SQL_EXERCISES: SqlExercise[] = [
  {
    id: "pune-customers",
    title: "Customers in Pune",
    level: 1,
    topic: "SELECT · WHERE · ORDER BY",
    prompt: "List the id and name of every customer whose city is Pune, sorted by name.",
    columns: ["id", "name"],
    ordered: true,
    hint: "Filter with WHERE city = 'Pune' and sort with ORDER BY name.",
    solution: "SELECT id, name\nFROM customers\nWHERE city = 'Pune'\nORDER BY name;",
    lesson: "sql-select-basics",
  },
  {
    id: "top-products",
    title: "Five most expensive products",
    level: 1,
    topic: "ORDER BY · LIMIT",
    prompt: "Return the name and price of the five most expensive products, most expensive first.",
    columns: ["name", "price"],
    ordered: true,
    hint: "ORDER BY price DESC, then LIMIT 5.",
    solution: "SELECT name, price\nFROM products\nORDER BY price DESC\nLIMIT 5;",
    lesson: "sql-select-basics",
  },
  {
    id: "no-department",
    title: "Employees without a department",
    level: 1,
    topic: "NULL",
    prompt: "Return the names of employees who don't belong to any department.",
    columns: ["name"],
    ordered: false,
    hint: "A missing department is NULL — and `= NULL` is never true.",
    solution: "SELECT name\nFROM employees\nWHERE department_id IS NULL;",
    lesson: "sql-null-logic",
  },
  {
    id: "orders-per-status",
    title: "Orders per status",
    level: 1,
    topic: "GROUP BY",
    prompt: "For each order status, return the status and the number of orders with it.",
    columns: ["status", "count"],
    ordered: false,
    hint: "GROUP BY status with count(*).",
    solution: "SELECT status, count(*)\nFROM orders\nGROUP BY status;",
    lesson: "sql-aggregation",
  },
  {
    id: "frequent-customers",
    title: "Frequent customers",
    level: 2,
    topic: "GROUP BY · HAVING",
    prompt: "Return customer_id and the number of orders for customers who placed more than 12 orders. Ignore guest orders (customer_id is NULL).",
    columns: ["customer_id", "orders"],
    ordered: false,
    hint: "Filter rows in WHERE, filter groups in HAVING count(*) > 12.",
    solution: "SELECT customer_id, count(*) AS orders\nFROM orders\nWHERE customer_id IS NOT NULL\nGROUP BY customer_id\nHAVING count(*) > 12;",
    lesson: "sql-aggregation",
  },
  {
    id: "big-orders",
    title: "Big orders with customer names",
    level: 2,
    topic: "INNER JOIN",
    prompt: "Return the order id, the customer's name and the order total for orders with a total above 100,000, largest first.",
    columns: ["id", "name", "total"],
    ordered: true,
    hint: "JOIN customers ON customers.id = orders.customer_id; guest orders disappear in an inner join, which is what we want here.",
    solution: "SELECT o.id, c.name, o.total\nFROM orders o\nJOIN customers c ON c.id = o.customer_id\nWHERE o.total > 100000\nORDER BY o.total DESC, o.id;",
    lesson: "sql-joins",
  },
  {
    id: "headcount",
    title: "Headcount per department (including empty ones)",
    level: 2,
    topic: "LEFT JOIN · COUNT",
    prompt: "Return every department's name and its number of employees — departments without employees must appear with 0.",
    columns: ["name", "headcount"],
    ordered: false,
    hint: "LEFT JOIN employees and count a column from employees (count(e.id)), not count(*).",
    solution: "SELECT d.name, count(e.id) AS headcount\nFROM departments d\nLEFT JOIN employees e ON e.department_id = d.id\nGROUP BY d.id, d.name;",
    lesson: "sql-joins",
  },
  {
    id: "never-ordered",
    title: "Customers who never ordered",
    level: 2,
    topic: "Anti join · NULL trap",
    prompt: "Return the id and name of customers who have never placed an order. (Try NOT IN first and see what happens.)",
    columns: ["id", "name"],
    ordered: false,
    hint: "orders.customer_id contains NULLs (guest orders), so NOT IN returns nothing. Use NOT EXISTS.",
    solution: "SELECT c.id, c.name\nFROM customers c\nWHERE NOT EXISTS (\n  SELECT 1 FROM orders o WHERE o.customer_id = c.id\n);",
    lesson: "sql-semi-anti-joins",
  },
  {
    id: "above-manager",
    title: "Earning more than their manager",
    level: 2,
    topic: "Self join",
    prompt: "Return each employee's name and salary, and their manager's name and salary, for employees paid more than their manager.",
    columns: ["employee", "salary", "manager", "manager_salary"],
    ordered: false,
    hint: "Join employees to itself: employees e JOIN employees m ON m.id = e.manager_id.",
    solution: "SELECT e.name AS employee, e.salary, m.name AS manager, m.salary AS manager_salary\nFROM employees e\nJOIN employees m ON m.id = e.manager_id\nWHERE e.salary > m.salary;",
    lesson: "sql-joins",
  },
  {
    id: "above-average-products",
    title: "Products priced above average",
    level: 2,
    topic: "Scalar subquery",
    prompt: "Return the name and price of products priced above the average product price.",
    columns: ["name", "price"],
    ordered: false,
    hint: "Compare with (SELECT avg(price) FROM products).",
    solution: "SELECT name, price\nFROM products\nWHERE price > (SELECT avg(price) FROM products);",
    lesson: "sql-subqueries-ctes",
  },
  {
    id: "second-highest",
    title: "Second-highest salary",
    level: 2,
    topic: "Nth highest",
    prompt: "Return the second-highest distinct salary among all employees as a single value.",
    columns: ["second_highest"],
    ordered: false,
    hint: "The max of salaries below the max — or DENSE_RANK() = 2.",
    solution: "SELECT max(salary) AS second_highest\nFROM employees\nWHERE salary < (SELECT max(salary) FROM employees);",
    lesson: "sql-interview-patterns",
  },
  {
    id: "category-units",
    title: "Units sold per category",
    level: 2,
    topic: "JOIN · GROUP BY · ORDER BY",
    prompt: "Return each product category and the total units sold (sum of quantity across all order items), highest first.",
    columns: ["category", "units"],
    ordered: true,
    hint: "Join order_items to products, group by category, sum quantity.",
    solution: "SELECT p.category, sum(oi.quantity) AS units\nFROM order_items oi\nJOIN products p ON p.id = oi.product_id\nGROUP BY p.category\nORDER BY units DESC;",
    lesson: "sql-aggregation",
  },
  {
    id: "salary-rank",
    title: "Salary rank within department",
    level: 3,
    topic: "Window functions",
    prompt: "For every employee with a department, return name, department_id, salary and their dense rank by salary within the department (1 = highest).",
    columns: ["name", "department_id", "salary", "rnk"],
    ordered: false,
    hint: "dense_rank() OVER (PARTITION BY department_id ORDER BY salary DESC).",
    solution: "SELECT name, department_id, salary,\n       dense_rank() OVER (PARTITION BY department_id ORDER BY salary DESC) AS rnk\nFROM employees\nWHERE department_id IS NOT NULL;",
    lesson: "sql-window-functions",
  },
  {
    id: "top-earners",
    title: "Top earner(s) per department",
    level: 3,
    topic: "Top-N per group",
    prompt: "For each department, return department_id, name and salary of its highest-paid employee(s) — include ties.",
    columns: ["department_id", "name", "salary"],
    ordered: false,
    hint: "Rank within the department in a subquery or CTE, then keep rank 1. rank() keeps ties; row_number() wouldn't.",
    solution: "SELECT department_id, name, salary\nFROM (\n  SELECT e.*, rank() OVER (PARTITION BY department_id ORDER BY salary DESC) AS r\n  FROM employees e\n  WHERE department_id IS NOT NULL\n) t\nWHERE r = 1;",
    lesson: "sql-window-functions",
  },
  {
    id: "running-total",
    title: "Running revenue in June 2024",
    level: 3,
    topic: "Running totals",
    prompt: "For each day in June 2024 that had non-cancelled orders, return the date, that day's revenue (sum of total) and the running total since June 1st, in date order.",
    columns: ["order_date", "revenue", "running_total"],
    ordered: true,
    hint: "Aggregate per day in a CTE, then sum(revenue) OVER (ORDER BY order_date).",
    solution: "WITH d AS (\n  SELECT order_date, sum(total) AS revenue\n  FROM orders\n  WHERE status <> 'cancelled'\n    AND order_date >= DATE '2024-06-01' AND order_date < DATE '2024-07-01'\n  GROUP BY order_date\n)\nSELECT order_date, revenue,\n       sum(revenue) OVER (ORDER BY order_date) AS running_total\nFROM d\nORDER BY order_date;",
    lesson: "sql-window-functions",
  },
  {
    id: "month-over-month",
    title: "Month-over-month revenue (2024)",
    level: 3,
    topic: "LAG",
    prompt: "For each month of 2024, return the month (first day, as a date), revenue from paid or shipped orders, and the change versus the previous month (NULL for January). Order by month.",
    columns: ["month", "revenue", "change"],
    ordered: true,
    hint: "date_trunc('month', order_date)::date, aggregate in a CTE, then revenue - lag(revenue) OVER (ORDER BY month).",
    solution: "WITH m AS (\n  SELECT date_trunc('month', order_date)::date AS month, sum(total) AS revenue\n  FROM orders\n  WHERE status IN ('paid', 'shipped')\n    AND order_date >= DATE '2024-01-01' AND order_date < DATE '2025-01-01'\n  GROUP BY 1\n)\nSELECT month, revenue, revenue - lag(revenue) OVER (ORDER BY month) AS change\nFROM m\nORDER BY month;",
    lesson: "sql-interview-patterns",
  },
  {
    id: "login-streaks",
    title: "Login streaks of 3+ days",
    level: 4,
    topic: "Gaps and islands",
    prompt: "Return the user_id of every user who logged in on at least 3 consecutive days in the logins table. Note: some users logged in twice on the same day.",
    columns: ["user_id"],
    ordered: false,
    hint: "Deduplicate (user, day) first. For consecutive dates, login_date minus row_number() is constant within a streak.",
    solution: "WITH d AS (SELECT DISTINCT user_id, login_date FROM logins),\ng AS (\n  SELECT user_id, login_date,\n         login_date - (row_number() OVER (PARTITION BY user_id ORDER BY login_date))::int AS grp\n  FROM d\n)\nSELECT DISTINCT user_id\nFROM g\nGROUP BY user_id, grp\nHAVING count(*) >= 3;",
    lesson: "sql-interview-patterns",
  },
  {
    id: "reporting-chain",
    title: "Everyone under Diya Sharma",
    level: 4,
    topic: "Recursive CTE",
    prompt: "Diya Sharma has id 2. Return id, name and depth (1 = direct report) of every employee in her reporting tree, excluding Diya herself.",
    columns: ["id", "name", "depth"],
    ordered: false,
    hint: "WITH RECURSIVE: anchor = employee 2 at depth 0; recursive step joins employees whose manager_id is in the previous level.",
    solution: "WITH RECURSIVE r AS (\n  SELECT id, name, 0 AS depth FROM employees WHERE id = 2\n  UNION ALL\n  SELECT e.id, e.name, r.depth + 1\n  FROM employees e\n  JOIN r ON e.manager_id = r.id\n)\nSELECT id, name, depth FROM r WHERE depth > 0;",
    lesson: "sql-subqueries-ctes",
  },
];

export interface CompareOutcome {
  ok: boolean;
  message: string;
}

/** Compares two result sets given as arrays of already-formatted string rows. */
export function compareResults(actual: string[][], expected: string[][], ordered: boolean): CompareOutcome {
  const cols = (rows: string[][]) => (rows[0] ? rows[0].length : 0);
  if (actual.length && expected.length && cols(actual) !== cols(expected)) {
    return { ok: false, message: `Your result has ${cols(actual)} column(s); the expected result has ${cols(expected)}.` };
  }
  if (actual.length !== expected.length) {
    return { ok: false, message: `Your result has ${actual.length} row(s); the expected result has ${expected.length}.` };
  }
  const key = (r: string[]) => JSON.stringify(r);
  if (ordered) {
    for (let i = 0; i < expected.length; i++) {
      if (key(actual[i]) !== key(expected[i])) {
        const sameSet = compareResults(actual, expected, false).ok;
        return {
          ok: false,
          message: sameSet
            ? "The rows are right but the order isn't — check your ORDER BY."
            : `Row ${i + 1} differs: got (${actual[i].join(", ")}), expected (${expected[i].join(", ")}).`,
        };
      }
    }
    return { ok: true, message: "Correct — same rows in the same order." };
  }
  const counts = new Map<string, number>();
  for (const r of expected) counts.set(key(r), (counts.get(key(r)) ?? 0) + 1);
  for (const r of actual) {
    const k = key(r);
    const c = counts.get(k) ?? 0;
    if (c === 0) return { ok: false, message: `Unexpected row: (${r.join(", ")}).` };
    counts.set(k, c - 1);
  }
  return { ok: true, message: "Correct — same rows (order doesn't matter here)." };
}
