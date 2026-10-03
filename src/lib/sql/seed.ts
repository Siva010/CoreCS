// Seed data for the SQL labs. Everything is deterministic (setseed) so graded
// exercises and lesson examples produce the same results for every learner.

const FIRST_NAMES = [
  "Asha", "Ravi", "Meera", "Karan", "Neha", "Sameer", "Pallavi", "Rahul", "Sunita", "Imran",
  "Divya", "Arnav", "Farah", "Gautam", "Hema", "Jatin", "Komal", "Lokesh", "Mitali", "Naveen",
  "Ojas", "Payal", "Qasim", "Ritu", "Sahil", "Tanvi", "Uday", "Vani", "Waseem", "Yamini",
  "Zubin", "Anil", "Bhavna", "Chirag", "Deepa", "Eshan", "Fatima", "Girish", "Heena", "Irfan",
];

/** Small, readable dataset used by the SQL Playground and lesson examples. */
export const PLAYGROUND_SEED = `
SELECT setseed(0.42);

CREATE TABLE departments (
  id        int PRIMARY KEY,
  name      text NOT NULL,
  location  text NOT NULL
);
INSERT INTO departments VALUES
  (1, 'Engineering', 'Bengaluru'), (2, 'Sales', 'Mumbai'), (3, 'Marketing', 'Mumbai'),
  (4, 'Finance', 'Pune'), (5, 'Support', 'Hyderabad'), (6, 'Research', 'Bengaluru');

CREATE TABLE employees (
  id             int PRIMARY KEY,
  name           text NOT NULL,
  department_id  int REFERENCES departments(id),
  manager_id     int REFERENCES employees(id),
  salary         numeric(10,2) NOT NULL,
  hired_at       date NOT NULL
);
INSERT INTO employees VALUES
  (1,  'Aarav Mehta',    1,    NULL, 320000, '2015-03-01'),
  (2,  'Diya Sharma',    1,    1,    210000, '2016-06-15'),
  (3,  'Kabir Rao',      2,    1,    190000, '2016-09-01'),
  (4,  'Ananya Iyer',    4,    1,    185000, '2017-01-10'),
  (5,  'Rohan Gupta',    1,    2,    150000, '2018-04-02'),
  (6,  'Meera Nair',     1,    2,    150000, '2019-07-22'),
  (7,  'Vikram Singh',   1,    5,    120000, '2020-02-17'),
  (8,  'Sneha Kulkarni', 1,    5,    125000, '2021-08-30'),
  (9,  'Arjun Das',      1,    6,     98000, '2022-01-05'),
  (10, 'Priya Menon',    1,    6,    160000, '2022-05-16'),
  (11, 'Ishaan Verma',   2,    3,    110000, '2018-11-12'),
  (12, 'Kavya Reddy',    2,    3,    105000, '2019-03-25'),
  (13, 'Aditya Joshi',   2,    11,    82000, '2021-06-01'),
  (14, 'Nisha Pillai',   2,    11,    82000, '2023-01-09'),
  (15, 'Siddharth Bose', 2,    12,   115000, '2023-04-17'),
  (16, 'Tara Kapoor',    3,    3,    130000, '2019-10-01'),
  (17, 'Yash Malhotra',  3,    16,    90000, '2021-02-14'),
  (18, 'Ira Chatterjee', 3,    16,    95000, '2022-09-19'),
  (19, 'Neel Banerjee',  4,    4,    120000, '2018-05-07'),
  (20, 'Riya Saxena',    4,    19,    88000, '2020-12-01'),
  (21, 'Manav Chopra',   4,    19,    88000, '2023-03-13'),
  (22, 'Zoya Khan',      5,    1,    115000, '2017-08-21'),
  (23, 'Dev Patel',      5,    22,    62000, '2021-01-18'),
  (24, 'Aisha Ali',      5,    22,    64000, '2022-07-04'),
  (25, 'Kunal Shah',     5,    22,    60000, '2023-11-20'),
  (26, 'Pooja Desai',    5,    23,    58000, '2024-02-12'),
  (27, 'Harsh Vardhan',  NULL, 1,    140000, '2020-06-01'),
  (28, 'Leela Thomas',   NULL, 2,     95000, '2024-01-08'),
  (29, 'Omar Sheikh',    1,    7,    105000, '2023-06-26'),
  (30, 'Gauri Pandey',   1,    7,    118000, '2024-03-04');
CREATE INDEX employees_manager_idx ON employees (manager_id);

CREATE TABLE customers (
  id          int PRIMARY KEY,
  name        text NOT NULL,
  email       text NOT NULL UNIQUE,
  city        text,
  created_at  date NOT NULL
);
INSERT INTO customers
SELECT i, n, lower(n) || i || '@example.com',
       (ARRAY['Pune','Mumbai','Delhi','Bengaluru','Chennai','Hyderabad','Kolkata'])[1 + (i * 3) % 7],
       DATE '2022-01-01' + i * 17
FROM (
  SELECT n, ord::int AS i
  FROM unnest(ARRAY[${FIRST_NAMES.map((n) => `'${n}'`).join(",")}]) WITH ORDINALITY AS t(n, ord)
) named;
UPDATE customers SET city = NULL WHERE id = 40;

CREATE TABLE products (
  id        int PRIMARY KEY,
  name      text NOT NULL,
  category  text NOT NULL,
  price     numeric(10,2) NOT NULL CHECK (price > 0)
);
INSERT INTO products VALUES
  (1, 'SQL Tuning Handbook', 'Books', 1450), (2, 'Distributed Systems Primer', 'Books', 2400),
  (3, 'Operating Systems Notes', 'Books', 1200), (4, 'Networking Fundamentals', 'Books', 1800),
  (5, 'Mechanical Keyboard', 'Electronics', 6500), (6, 'Noise-Cancelling Headphones', 'Electronics', 14999),
  (7, 'USB-C Hub', 'Electronics', 2499), (8, '27-inch Monitor', 'Electronics', 18999),
  (9, 'Standing Desk', 'Home', 32000), (10, 'Desk Lamp', 'Home', 1899),
  (11, 'Ergonomic Chair', 'Home', 21000), (12, 'Coffee Grinder', 'Home', 3499),
  (13, 'Puzzle Cube', 'Toys', 499), (14, 'Robot Kit', 'Toys', 4999), (15, 'Board Game', 'Toys', 2199);

CREATE TABLE orders (
  id           int PRIMARY KEY,
  customer_id  int REFERENCES customers(id),          -- NULL = guest checkout
  order_date   date NOT NULL,
  status       text NOT NULL CHECK (status IN ('pending','paid','shipped','cancelled')),
  total        numeric(12,2) NOT NULL DEFAULT 0
);
INSERT INTO orders (id, customer_id, order_date, status)
SELECT g,
       CASE WHEN g % 37 = 0 THEN NULL ELSE 1 + floor(random() * 34)::int END,
       DATE '2023-01-01' + floor(random() * 731)::int,
       (ARRAY['paid','paid','paid','shipped','shipped','pending','cancelled'])[1 + floor(random() * 7)::int]
FROM generate_series(1, 360) AS g;
CREATE INDEX orders_customer_idx ON orders (customer_id);

CREATE TABLE order_items (
  order_id    int NOT NULL REFERENCES orders(id),
  product_id  int NOT NULL REFERENCES products(id),
  quantity    int NOT NULL CHECK (quantity > 0),
  unit_price  numeric(10,2) NOT NULL,
  PRIMARY KEY (order_id, product_id)
);
INSERT INTO order_items (order_id, product_id, quantity, unit_price)
SELECT o.id, pr.id, 1 + floor(random() * 3)::int, pr.price
FROM orders o
CROSS JOIN LATERAL (SELECT 1 + floor(random() * 15)::int AS pid FROM generate_series(1, 1 + o.id % 3)) pick
JOIN products pr ON pr.id = pick.pid
ORDER BY o.id
ON CONFLICT DO NOTHING;
CREATE INDEX order_items_product_idx ON order_items (product_id);

UPDATE orders o SET total = s.t
FROM (SELECT order_id, sum(quantity * unit_price) AS t FROM order_items GROUP BY order_id) s
WHERE s.order_id = o.id;

CREATE TABLE logins (
  user_id     int NOT NULL REFERENCES customers(id),
  login_date  date NOT NULL
);
INSERT INTO logins
SELECT c.id, DATE '2024-06-01' + d
FROM customers c CROSS JOIN generate_series(0, 29) AS d
WHERE random() < CASE WHEN c.id % 5 = 0 THEN 0.8 ELSE 0.25 END
ORDER BY c.id, d;
INSERT INTO logins VALUES (3, '2024-06-10'), (3, '2024-06-10'), (7, '2024-06-02');

ANALYZE;
`;

export const PLAYGROUND_TABLES = ["departments", "employees", "customers", "products", "orders", "order_items", "logins"];

/** Larger dataset for the query-plan lab: big enough that plans differ. */
export const PLAN_SEED = `
SELECT setseed(0.7);

CREATE TABLE customers (
  id          int PRIMARY KEY,
  name        text NOT NULL,
  city        text NOT NULL,
  segment     text NOT NULL,
  created_at  date NOT NULL
);
INSERT INTO customers
SELECT g, 'Customer ' || g,
       CASE WHEN random() < 0.01 THEN 'Kochi'
            ELSE (ARRAY['Pune','Mumbai','Delhi','Bengaluru','Chennai','Hyderabad','Kolkata','Jaipur','Surat'])[1 + floor(random() * 9)::int] END,
       CASE WHEN random() < 0.05 THEN 'enterprise' ELSE 'retail' END,
       DATE '2020-01-01' + floor(random() * 1800)::int
FROM generate_series(1, 20000) AS g;

CREATE TABLE orders (
  id           int PRIMARY KEY,
  customer_id  int NOT NULL,
  order_date   date NOT NULL,
  status       text NOT NULL,
  total        numeric(10,2) NOT NULL
);
INSERT INTO orders
SELECT g, 1 + floor(random() * 20000)::int,
       DATE '2022-01-01' + floor(random() * 1000)::int,
       (ARRAY['paid','paid','paid','paid','paid','paid','paid','shipped','cancelled','pending'])[1 + floor(random() * 10)::int],
       round((100 + random() * 9900)::numeric, 2)
FROM generate_series(1, 200000) AS g;

ANALYZE;
`;
