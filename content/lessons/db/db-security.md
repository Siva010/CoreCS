---
title: "Database Security: Injection, Least Privilege, Row-Level Security and Encryption"
subject: db
level: 16
order: 1
summary: "How data actually leaks — SQL injection, over-privileged accounts, missing tenant checks, unencrypted wires and backups — and the mechanisms that stop each: parameterized queries, roles and GRANT, row-level security, TLS and encryption at rest, password hashing and auditing."
depth: core
difficulty: 3
minutes: 45
relevance: high
stage: 2
prerequisites: [sql-dml-ddl, sql-views-programmability]
related: [cn-tls-handshake, cn-certificates-pki, cn-cors-csrf, cn-crypto-foundations, db-backups-pitr, db-schema-design]
tags: [sql injection, parameterized query, prepared statement, least privilege, roles, grant, revoke, row level security, rls, multi tenant, encryption at rest, encryption in transit, tls, sslmode, tde, password hashing, argon2, bcrypt, audit, pgaudit, security definer]
---

## Mental Model

A database will do anything a connected, authorized session asks — that is its job. Security is therefore about controlling **who can connect, what they may ask, which rows they may see, and who can read the bytes** when they travel or sit on disk. There are five ways it goes wrong, and one mechanism for each:

| Threat | Mechanism |
|---|---|
| An attacker's input becomes part of your SQL | **Parameterized queries** — values never become syntax |
| The app's account can do far more than the app needs | **Least privilege** — roles, GRANT, separate owners |
| One customer sees another customer's rows | **Row-level authorization** — RLS policies or enforced filters |
| Someone reads the network traffic, the disk or a backup | **Encryption** in transit and at rest |
| It happened and nobody knows | **Auditing** and alerting |

## Why It Exists

**The problem.** The database holds the most valuable thing a company has, and it is reachable — through the application, through admin tools, through backups and replicas. Most real breaches are not exotic: a query built by string concatenation, an app connected as superuser, a tenant filter someone forgot, a backup bucket left public.

**Without it.** One injectable search box lets an attacker read every table the app's account can read — and if that account owns the schema, drop them. One missing `WHERE tenant_id = …` shows a customer someone else's invoices. An unencrypted snapshot copied to the wrong place leaks everything, no SQL required.

**The idea.** Don't rely on every line of application code being perfect. Build layers that each fail safe on their own:

- the SQL text can't be changed by data;
- the account can't touch what it doesn't need;
- the database itself filters rows by tenant;
- the bytes are useless without keys;
- every privileged action leaves a trail.

**From idea to mechanism.**
- *Data must never become code* → send the SQL and the values separately (prepared statements / bind parameters).
- *A compromised app shouldn't own the database* → the app gets a role with only DML on its tables; migrations run as a different role.
- *Tenant isolation shouldn't depend on remembering a WHERE clause* → a row-level security policy adds the predicate to every query.
- *Disks, backups and networks get copied and sniffed* → TLS on every connection, encrypted storage and backups, keys managed separately.

:::callout[That's all it is]{type=insight}
SQL injection exists because code and data travel in the same string; parameters split them. Everything else is the principle of least privilege applied at every layer — connection, table, row and byte — plus a log of who used it.
:::

## Definition

- **SQL injection**: user-controlled input changes the structure of a SQL statement because the statement was built by concatenating strings.
- **Parameterized query / prepared statement**: the SQL text contains placeholders (`$1`, `?`, `%s`); values are sent separately and bound as data, never parsed as SQL.
- **Role**: a database principal (user or group). **GRANT / REVOKE** give or take privileges (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, `USAGE`, `CREATE`, `EXECUTE`, …) on objects.
- **Least privilege**: every principal gets the minimum privileges its job needs.
- **Row-level security (RLS)**: per-table policies whose predicates the database adds to every query, so a session only sees (`USING`) and writes (`WITH CHECK`) the rows it's allowed to.
- **Encryption in transit**: TLS between client and server (and between replicas). **Encryption at rest**: data files, WAL and backups encrypted on storage — by the disk/volume, by the database (TDE), or by the application for specific columns.
- **Password hashing**: storing a slow, salted one-way hash (Argon2id, bcrypt, scrypt) instead of the password.
- **Audit log**: a tamper-resistant record of who connected and which privileged statements or data accesses happened.

## How It Works

### SQL injection, mechanically

The application builds SQL by pasting input into a string:

```python
# Vulnerable
sql = "SELECT id, name FROM users WHERE email = '" + email + "' AND active"
```

With `email = "x' OR '1'='1' --"` the database receives:

```sql
SELECT id, name FROM users WHERE email = 'x' OR '1'='1' --' AND active
```

The quote closed the string literal early, `OR '1'='1'` made the predicate always true, and `--` commented out the rest. The parser can't know which characters came from the user — by the time it sees the text, data and code are the same thing. The same trick gives attackers:

- **UNION-based extraction**: `' UNION SELECT username, password_hash FROM admins --` appends rows from any table the account can read.
- **Blind injection**: no output is shown, but a yes/no question leaks one bit per request (`' AND substr(token,1,1) > 'm' --`, or a time delay with `pg_sleep`). Slow, automatic, and enough to extract anything.
- **Stacked queries**: `'; DROP TABLE users; --` where the driver allows several statements per call.
- **Second-order injection**: input is stored safely, then later concatenated into a query by a different code path (a report, an admin tool).

### Why parameters fix it

With a bind parameter the SQL text is fixed and parsed **before** any value arrives:

```python
cur.execute("SELECT id, name FROM users WHERE email = %s AND active", (email,))   # psycopg
```

```js
await client.query("SELECT id, name FROM users WHERE email = $1 AND active", [email]);  // node-postgres
```

In PostgreSQL's extended protocol this is literally separate messages: **Parse** (the SQL with `$1`), **Bind** (the values), **Execute**. `x' OR '1'='1' --` is then just an unusual email address that matches nothing. (Some drivers interpolate client-side, but with correct quoting for the declared type — still safe.) Prepared statements can also reuse the parsed plan, so the safe way is usually the fast way too.

Things a parameter **can't** be — identifiers and keywords:

- Table and column names, `ASC`/`DESC`, `LIMIT` in some engines: validate against an **allowlist** (`{"price": "price", "name": "name"}[user_choice]`), never pass through.
- Dynamic SQL inside the database: use `format('… %I …', ident)` for identifiers and `%L` for literals, or `EXECUTE … USING` for values. A stored procedure that concatenates is exactly as injectable as app code.
- `LIKE` patterns: parameterize the value, and escape `%` and `_` if users shouldn't be able to use them as wildcards.

### Least privilege with roles

```sql
-- Owner of the schema: used only by migrations
CREATE ROLE app_owner NOLOGIN;
-- The application: data access only
CREATE ROLE app_rw LOGIN PASSWORD '…';
GRANT USAGE ON SCHEMA app TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;     -- future tables too
-- Read-only analysts and reporting
CREATE ROLE readonly NOLOGIN;
GRANT USAGE ON SCHEMA app TO readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA app TO readonly;
```

Why separate the owner: in PostgreSQL the **owner** of a table can always `DROP` or `ALTER` it, regardless of grants, and (by default) bypasses row-level security. If the app connects as the owner, an injection can drop tables and RLS doesn't apply. The app should be a different role with only DML.

More rules that follow from the same idea:
- Never connect an application as a superuser — a superuser can read files on the server and run programs through some features.
- Expose subsets through **views** or `SECURITY DEFINER` functions instead of granting on base tables; a `SECURITY DEFINER` function runs with its owner's rights, so pin its `search_path` (`SET search_path = app, pg_temp`) or a caller can plant a look-alike function.
- PostgreSQL 15 stopped granting `CREATE` on the `public` schema to every user; on older versions run `REVOKE CREATE ON SCHEMA public FROM PUBLIC`.
- Restrict *who can connect from where*: private network only, `pg_hba.conf` rules per database/user/address, `scram-sha-256` authentication (the default `password_encryption` since PostgreSQL 14).

### Row-level security for multi-tenant data

Without RLS, tenant isolation is a `WHERE tenant_id = ?` that every query must remember. With RLS, the database adds it:

```sql
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON invoices
  USING      (tenant_id = current_setting('app.tenant_id')::bigint)   -- rows you can see / update / delete
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::bigint);  -- rows you can insert / update into

-- per request, inside the transaction:
BEGIN;
SELECT set_config('app.tenant_id', '42', true);   -- true = local to this transaction
SELECT * FROM invoices WHERE status = 'open';     -- effectively: … AND tenant_id = 42
COMMIT;
```

Details that matter:
- `USING` filters existing rows; `WITH CHECK` validates new or changed rows (so nobody can insert into another tenant).
- Superusers and roles with `BYPASSRLS` skip policies; table owners do too unless you `ALTER TABLE … FORCE ROW LEVEL SECURITY`.
- With a connection pool, a plain `SET app.tenant_id` sticks to the pooled connection and **leaks to the next request**. Use transaction-local settings (`SET LOCAL` / `set_config(…, true)`).
- RLS adds a predicate to every query, so index `tenant_id` (usually as the first column of composite indexes).

Alternatives: a database or schema per tenant (strongest isolation, many objects to migrate), or app-enforced filters (no database feature needed, but one missed `WHERE` is a breach).

### Encryption: what each layer protects against

| Layer | Protects against | Does *not* protect against |
|---|---|---|
| **TLS in transit** | sniffing and tampering on the network | anyone with valid credentials; a compromised app |
| **Disk / volume encryption** (cloud default, LUKS) | stolen disks, decommissioned hardware | anyone who can query the running database or read its mounted files |
| **TDE** (SQL Server, Oracle, MySQL InnoDB data-at-rest encryption) | copied data files and backups of them | SQL access — the engine decrypts for every authorized query |
| **Application-level column encryption** | DBAs, database compromise, leaked dumps for that column | the app itself; you also lose indexing and range search on it |

TLS only authenticates the server if the client checks. In libpq, `sslmode=require` encrypts but **doesn't verify the certificate**, so a man-in-the-middle can present any certificate. (If a root CA file happens to be installed, it checks the chain, but never the hostname.) `verify-full` checks both the chain and the hostname ([TLS Handshake](lesson:cn-tls-handshake), [Certificates & PKI](lesson:cn-certificates-pki)). Community PostgreSQL has no built-in TDE; it relies on storage encryption, and some distributions add it.

Backups and replicas are copies of the same data: encrypt them, keep their keys in a key management service rather than next to the backup, and restrict who can read the bucket ([Backups & PITR](lesson:db-backups-pitr)).

### Passwords are hashed, not encrypted

Store `argon2id(password, salt)` (or bcrypt/scrypt), never the password and never a fast hash like MD5 or SHA-256. A per-user salt defeats precomputed tables; a deliberately slow, memory-hard function makes each guess expensive, so a leaked table can't be brute-forced at billions of guesses per second. Encryption would be the wrong tool: anything that can be decrypted can be decrypted by whoever gets the key.

### Auditing

Record who did what so misuse is detectable and provable: connection logs, `pgaudit` for statement- and object-level audit in PostgreSQL, the audit plugins in MySQL, trigger-based history tables for business data. Ship logs off the database host (an attacker with database access shouldn't be able to delete them), and be careful in the other direction too: statement logging can write passwords and personal data into logs.

## Example

A product search with sorting, written safely:

```python
SORTABLE = {"price": "price", "newest": "created_at", "name": "name"}

def search(cur, term: str, sort: str, desc: bool, tenant_id: int):
    order_col = SORTABLE.get(sort, "created_at")         # identifiers: allowlist
    direction = "DESC" if desc else "ASC"                 # keywords: chosen by code, not input
    cur.execute(
        f"""SELECT id, name, price
            FROM products
            WHERE tenant_id = %s
              AND name ILIKE %s ESCAPE '\\'
            ORDER BY {order_col} {direction}
            LIMIT 50""",
        (tenant_id, "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"),
    )
```

The f-string only ever inserts values the code chose; everything the user typed travels as a parameter, with LIKE wildcards escaped. The `tenant_id` filter would be redundant under an RLS policy — and harmless.

## Complexity & Performance

- Parameterized queries cost nothing extra and can save planning time when statements are prepared once and executed many times (watch PostgreSQL's generic vs custom plan choice for skewed data).
- An RLS policy is one more predicate per query; with `tenant_id` leading the relevant indexes it's nearly free. A policy that calls a slow function per row is not.
- TLS: one handshake per connection — negligible with connection pooling, painful without it ([Connection Management](lesson:x-connection-management)).
- Application-level encryption costs CPU per field and removes the ability to index, sort or range-search encrypted columns (deterministic encryption allows equality lookups at the price of leaking which rows are equal).

## Trade-offs

- **Database-enforced vs app-enforced authorization**: RLS can't be forgotten by one endpoint, but it hides logic in the database and complicates debugging; app filters are visible but rely on discipline.
- **Isolation granularity**: shared tables with RLS (cheap, dense) vs schema or database per tenant (strong isolation, noisy-neighbour control, painful migrations at thousands of tenants).
- **Encryption depth**: storage encryption is transparent and cheap but doesn't stop SQL-level access; column encryption protects even from DBAs but breaks indexing and complicates key rotation.
- **Audit detail**: full statement logging is great for forensics and terrible for disk space and privacy.

## Failure Modes

- **Identifier injection**: everything is parameterized except `ORDER BY ${req.query.sort}`.
- **Owner connection**: the app connects as the table owner, so RLS silently doesn't apply and an injection can `DROP TABLE`.
- **Tenant setting leaks across pooled connections** because it was set with session scope instead of transaction scope.
- **`sslmode=require` everywhere**: encrypted, but any machine in the path can impersonate the server.
- **Public or unencrypted backups** — the most common large-scale leak, no SQL involved.
- **Secrets in source control or logs**: connection strings in a repository, passwords in statement logs.
- **`SECURITY DEFINER` without a fixed `search_path`**, letting a low-privilege user substitute objects.
- **Over-broad grants that grow over time**: `GRANT ALL` for a quick fix, never revoked.

## In Production

- Parameterize everything; lint for string-built SQL; allowlist identifiers; review raw-SQL escape hatches in ORMs.
- Roles: migration owner, app read/write, read-only, and per-person admin accounts — no shared superuser password.
- Network: database in a private subnet, no public endpoint, `pg_hba.conf` restricted, `scram-sha-256`.
- TLS with `verify-full` (or the driver's equivalent) for apps, replicas and admin tools.
- Encrypted storage, encrypted backups with separately managed keys, tested restores.
- Rotate credentials (short-lived credentials from a secrets manager or IAM auth beat static passwords).
- Audit logs shipped off-host, alerts on new superusers, privilege changes and unusual bulk reads.

## Deeper Connections

- Injection is the same bug as XSS and command injection: data interpreted as code because both share one channel ([CORS & CSRF](lesson:cn-cors-csrf)).
- TLS's guarantees — and what `verify-full` adds — come from certificate validation ([Certificates & PKI](lesson:cn-certificates-pki)).
- Least privilege is the same principle as user/kernel mode and file permissions in the OS: limit what a compromised component can reach ([What an OS Does](lesson:os-what-an-os-does)).
- Views and functions as security boundaries rely on the same machinery as ordinary views ([Views & Programmability](lesson:sql-views-programmability)).

## Common Misconceptions

- **"Escaping quotes is enough."** Escaping is easy to get wrong (numeric contexts need no quote at all, encodings, second-order paths); parameters remove the problem instead of patching it.
- **"ORMs make injection impossible."** Only for the queries they build; raw-SQL helpers and string-built fragments are as dangerous as anywhere else.
- **"Stored procedures prevent injection."** Only if they don't build dynamic SQL from their arguments.
- **"Encryption at rest protects us from SQL injection."** The engine decrypts for any authorized query; injection runs as the app.
- **"Hashing and encryption are the same."** Encryption is reversible with a key; password hashing must not be reversible at all.

## Interview Questions

### [L1 · conceptual] What is SQL injection, and how do you prevent it?

It happens when user input is concatenated into a SQL string, so characters in the input (a quote, `OR 1=1`, a comment marker) change the statement's structure. An attacker can bypass logins, read other tables with `UNION`, extract data one bit at a time with blind techniques, or modify data. The fix is to use parameterized queries / prepared statements, where the SQL text with placeholders and the values are sent separately and values are always bound as data. Add an allowlist for identifiers like sort columns, least-privilege database accounts so a hole can do less, and input validation as defence in depth.

### [L2 · why] Why exactly do parameterized queries stop injection, when escaping often doesn't?

The statement is parsed before the values exist. In PostgreSQL's extended protocol the client sends Parse (SQL with `$1`), then Bind (values), then Execute; the parser never sees the values, so nothing inside them can become a keyword, operator or comment. Escaping tries to make data safe *inside* the code string, and fails in edge cases: numeric contexts with no quotes, wrong character encodings, a forgotten field, or stored data reused later. Parameters remove the shared channel instead of sanitizing it.

### [L2 · how] A user can choose the sort column and direction. How do you build that query safely?

Identifiers and keywords can't be bind parameters. Map user choices through an allowlist in code (`{"price": "price", "newest": "created_at"}`) with a default, choose `ASC`/`DESC` by a boolean, and only then interpolate the code-chosen strings; all values (filters, limits where possible) remain parameters. Inside the database, use `format('%I', …)` for identifiers in dynamic SQL.

### [L2 · design] How would you design database roles for a typical web application?

An owner role (NOLOGIN) owns the schema and is used only by migrations; the application connects as a separate role with `USAGE` on the schema and `SELECT/INSERT/UPDATE/DELETE` on its tables (plus default privileges for future tables); a read-only role for reporting and analysts; individual named accounts for humans with elevated rights granted through group roles and audited. No app or person uses a superuser day to day. Because owners can drop tables and bypass RLS, keeping the app off the owner role contains the damage from any application bug.

### [L2 · compare] Encryption in transit vs at rest vs application-level: what does each protect against?

TLS protects data on the network from sniffing and tampering — if the client verifies the server certificate. Storage-level encryption at rest protects against stolen disks, snapshots and data files; it doesn't help against anyone who can query the database, because the engine decrypts transparently. Application-level encryption protects specific columns even from database administrators and leaked dumps, at the cost of indexing, searching and key management. Backups need their own encryption and key separation.

### [L2 · how] How should passwords be stored?

As a salted hash from a deliberately slow, memory-hard function — Argon2id, bcrypt or scrypt — never in plain text, never encrypted, never with a fast hash like SHA-256 or MD5. The salt (unique per user) defeats precomputed tables and makes identical passwords hash differently; the cost factor makes offline guessing slow. On login, hash the attempt with the stored salt and parameters and compare in constant time.

### [L3 · design] You're building a multi-tenant SaaS on PostgreSQL. How do you make sure one tenant can never see another's data?

Options: database per tenant, schema per tenant, or shared tables with a `tenant_id`. With shared tables, enforce isolation in the database with row-level security: enable RLS, add policies with `USING` and `WITH CHECK` on `tenant_id = current_setting('app.tenant_id')`, set that value per transaction with `set_config(…, true)` so it can't leak through the connection pool, and make sure the app's role is neither the table owner (or use `FORCE ROW LEVEL SECURITY`) nor `BYPASSRLS`. Lead indexes with `tenant_id`. Add tests that try cross-tenant reads, and keep app-level filters too as defence in depth.

### [L3 · debugging] Your RLS policies are in place, but a test shows a tenant can read another tenant's rows. What do you check?

Whether the connecting role bypasses RLS: superuser, `BYPASSRLS`, or table owner without `FORCE ROW LEVEL SECURITY`. Whether RLS is enabled on every table involved (including new ones and partitions accessed directly), and whether a permissive policy (policies combine with OR) or a `SECURITY DEFINER` function/view owned by a privileged role opens a side path. Whether the tenant setting is session-scoped and leaking from a previous request on a pooled connection. And whether the policy's `WITH CHECK` is missing, allowing writes into other tenants.

### [L3 · scenario] An audit finds every service connects with `sslmode=require`. Why is that flagged, and what do you change?

`require` encrypts the connection but doesn't verify the server's certificate, so an attacker able to intercept traffic (a compromised host on the path, DNS spoofing) can present their own certificate and read or alter everything. Switch to `verify-full`, distribute the CA certificate the server's certificate chains to, make sure the hostname clients use matches the certificate, and enforce TLS server-side (`hostssl` lines in `pg_hba.conf`) so plaintext connections are refused.

## Practice

### [mcq] The login query is built as `"… WHERE email = '" + email + "' AND password_hash = '" + h + "'"`. Which email value logs an attacker in as the first user?

- [ ] `admin@example.com`
- [x] `' OR 1=1 --`
- [ ] `%' --`
- [ ] `\' OR \'1\'=\'1`

The quote closes the string, `OR 1=1` makes the condition true for every row, and `--` comments out the password check.

### [mcq] Which of these **cannot** be passed as a bind parameter?

- [ ] The value in `WHERE price > ?`
- [ ] The pattern in `WHERE name LIKE ?`
- [x] The column name in `ORDER BY ?`
- [ ] The id list in `WHERE id = ANY(?)`

Parameters are values. Identifiers and keywords must come from an allowlist in code.

### [mcq] The app connects as the owner of the `invoices` table, which has RLS policies enabled. What happens?

- [ ] Policies apply as usual
- [x] The owner bypasses the policies unless the table has FORCE ROW LEVEL SECURITY
- [ ] Queries fail with a permission error
- [ ] Only WITH CHECK policies apply

Table owners, superusers and BYPASSRLS roles skip RLS by default. Connect the app as a non-owner role.

### [mcq] Which libpq `sslmode` both encrypts the connection and verifies the server's certificate and hostname?

- [ ] `prefer`
- [ ] `require`
- [ ] `verify-ca`
- [x] `verify-full`

`require` doesn't verify identity; `verify-ca` checks the chain but not the hostname; `verify-full` checks both.

### [numeric 128 unit=requests] A blind injection can ask one yes/no question per request. How many requests does it take to extract a 32-character hexadecimal token using binary search on each character?

:::answer
Each hex character has 16 possibilities, so binary search needs log₂ 16 = 4 questions per character. 32 × 4 = **128** requests — trivial for an automated tool, which is why "it doesn't show any output" is no defence.
:::

### [numeric 100000 unit=seconds] A leaked table stores bcrypt hashes. A GPU rig computes 10 billion SHA-256 hashes per second but only 10,000 bcrypt hashes per second at the chosen cost. How many seconds does it take to try a 1-billion-word list against one bcrypt hash?

:::answer
10⁹ guesses ÷ 10⁴ per second = **100,000** seconds — about 28 hours for a single account. The same list against an unsalted SHA-256 hash takes 10⁹ ÷ 10¹⁰ = 0.1 s, and against a whole unsalted table it's one pass for everyone. Slowness and per-user salts are the point.
:::

### [exercise] Rewrite this Node.js handler so it is not injectable, without losing the sort feature: `` db.query(`SELECT * FROM orders WHERE customer_id = ${req.user.id} AND status = '${req.query.status}' ORDER BY ${req.query.sort}`) ``

:::solution
```js
const SORT = { date: "order_date", total: "total" };            // allowlist for identifiers
const sortCol = SORT[req.query.sort] ?? "order_date";
const { rows } = await db.query(
  `SELECT id, order_date, status, total
   FROM orders
   WHERE customer_id = $1 AND status = $2
   ORDER BY ${sortCol} DESC, id DESC`,
  [req.user.id, req.query.status],
);
```

Every value is a parameter; the only interpolated text is chosen from a fixed map by code. Selecting explicit columns instead of `*` also avoids leaking columns added later.
:::

### [exercise] Write the SQL to give a `reporting` role read-only access to every current and future table in schema `app` (tables created by `app_owner`), and nothing else.

:::solution
```sql
CREATE ROLE reporting LOGIN PASSWORD '…';
GRANT CONNECT ON DATABASE shop TO reporting;
GRANT USAGE ON SCHEMA app TO reporting;
GRANT SELECT ON ALL TABLES IN SCHEMA app TO reporting;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA app
  GRANT SELECT ON TABLES TO reporting;
```

`USAGE` lets the role resolve names in the schema; `GRANT SELECT ON ALL TABLES` covers what exists today; default privileges cover tables `app_owner` creates later. For extra safety: `ALTER ROLE reporting SET default_transaction_read_only = on`.
:::

## Quick Revision

- Injection = data and code in one string. Fix = parameters (Parse/Bind/Execute keep them apart) + allowlists for identifiers + least privilege.
- App role ≠ owner ≠ superuser. Owners can DROP and bypass RLS; use default privileges for future tables.
- RLS: `ENABLE ROW LEVEL SECURITY`, policies with `USING` (read) and `WITH CHECK` (write), tenant id via transaction-local `set_config`, `FORCE` for owners, index `tenant_id`.
- TLS needs verification (`verify-full`); storage/TDE encryption protects files and backups, not SQL access; column encryption protects even from DBAs but kills indexing.
- Passwords: Argon2id/bcrypt/scrypt with per-user salt — hashed, never encrypted.
- Audit off-host; keep secrets out of code and logs; backups are data too.
