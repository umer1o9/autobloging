# MySQL migration — v0.2

The Node.js application now uses the user’s existing MySQL 8.0.41 server at 127.0.0.1:3306, database `autoblog`. The original isolated instance on 3307 is retained as the pre-transfer source and test server.

## Data model

| Table | Purpose |
| --- | --- |
| `workspaces` | Account ownership boundary |
| `users`, `sessions` | Identity, password hashes, expiring session hashes |
| `websites` | Website settings, delivery-key hash, flexible JSON policy |
| `topics` | Website-scoped topic queue and unique normalized titles |
| `articles` | Revision/status/schedule/slug indexes and structured JSON content |
| `jobs` | Durable stage checkpoints, indexed state, reserved integer cents |
| `approvals` | Reviewed revision and invalidation state |
| `usage_records` | One row per recorded job call; not reconciled monetary spend |
| `audit_events` | Existing redacted action trail |
| `coordination_locks` | Transactional workspace mutexes |
| `schema_migrations` | Applied schema version |
| `data_imports` | Snapshot fingerprints for repeat-safe SQLite import |

JSON holds flexible content rather than replacing relational ownership and lookup fields. Tables use InnoDB. Composite foreign keys reject records whose website and workspace do not agree. Database uniqueness protects slugs, normalized topics, one article per topic, one active job per topic, and scheduled slots.

## Concurrency design

The pool uses asynchronous operations. `AsyncLocalStorage` carries one connection through an entire transaction, including nested service calls. A write locks its workspace's coordination row before reading policy state. This intentionally serializes writes within a workspace and avoids cross-table races while allowing different workspaces to progress independently. It can later be refined to site-level locks with explicit ordering if measurements justify that change.

Each publisher re-fetches and checks the article inside its transaction, so two publishers cannot both mark the same scheduled article published. Generation claims are also transactional. Schema migrations and the single elected scheduler use separate connection-bound MySQL advisory locks. A server without the worker lock serves the API but does not dispatch or recover jobs. It must restart to claim the lock after the owner exits; automatic failover is not implemented.

No external AI request is made inside a database transaction. Completed research and writing checkpoints are committed separately. This avoids holding transaction locks while a provider runs. External provider requests interrupted before a checkpoint may still be billable and require review.

## Import and rollback

The SQLite importer only reads the source, including WAL-visible records in one read transaction. It writes a private snapshot before importing. All target inserts and verification run in a single InnoDB transaction. Unknown source kinds, FK/unique conflicts, content mismatches, or count mismatches roll back the import. A repeat of the same fingerprint returns `alreadyImported`; a changed snapshot cannot be merged into non-empty tables.

At local cutover the verified source contained one workspace, one user, one session, one website, one topic, one article, three audit events, and no AI jobs. All were imported. Original SQLite files and the private JSON backup remain under ignored `data/`. Credentials and article contents are not included in this document.

There is no automatic downgrade from new MySQL writes to SQLite. To roll back a failed cutover before accepting new writes, stop the app and use the preserved source with the earlier application version. After accepting MySQL writes, reconcile those writes before any rollback. Do not run old and new backends simultaneously against diverging datasets.

## Verification

The suite runs against real disposable MySQL databases using a separate account; it never uses the application database as a fallback. Provider calls are fixtures.

- Existing auth, tenant isolation, revision, publication pause, delivery key, recovery, and provider contract tests.
- Two independent pools competing for a budget that admits only one job.
- Simultaneous edits to one revision and simultaneous due publishers.
- Competing job claims producing one provider call and one private draft.
- Transaction rollback and FK enforcement across workspaces/websites.
- Database-level delivery pagination and exclusion of drafts.
- Exclusive scheduler ownership.
- SQLite content/session/password preservation and import replay.

This is correctness testing, not a large-volume performance or multi-host failover certification. Admin dashboard queries and some preflight checks still load workspace-scoped lists. Production readiness also requires managed backups, restore tests, retention, monitoring, migrations in deployment, appropriately scoped credentials/TLS, and the previously documented AI/editorial work.

Implementation references: [mysql2 connection pools](https://sidorares.github.io/node-mysql2/docs/examples/connections/create-pool), [MySQL transactions](https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-model.html), and [MySQL data-directory initialization](https://dev.mysql.com/doc/refman/8.4/en/data-directory-initialization.html).

## Transfer to the existing local server

The user supplied root access with an empty password to 127.0.0.1:3306. Its `autoblog` database existed with no tables. With the app stopped, `scripts/transfer-mysql.js` took a read-only consistent snapshot of the current 3307 data, wrote a private backup, created the target schema, and copied/verified every application row in one destination transaction. The active `DATABASE_URL` was then changed to 3306. No other databases were changed. Account/session hashes and all content were preserved. The old database remains available for recovery; new application writes now go only to 3306.
