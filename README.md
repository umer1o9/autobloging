# AutoBlog Studio

A new Node.js application for planning, reviewing, scheduling, and delivering articles for multiple websites through a REST API. This is a working **local development milestone**, not the full original FRS or a production SaaS release.

## Current local connection

The app now uses your existing MySQL server at **127.0.0.1:3306**, database **autoblog**, username **root**, with an empty password, as requested. The active connection is set through `DATABASE_URL` in ignored `.env`. Start your existing MySQL service, then run `npm start`. Refresh phpMyAdmin to see the application tables.

The former project instance on port 3307 is retained as a preserved source and for disposable tests; `TEST_DATABASE_URL` still points to its separate test account. It is no longer the application database. Start it with `npm run db:local:start` only if needed for tests.

## Setup on another machine

Requires Node.js **22.14 or later** and **MySQL 8+ with InnoDB**. The running local installation has been verified with MySQL 8.0.41. SQLite is no longer used by the application runtime.

```sh
npm ci
# First setup, using an installed native MySQL binary:
npm run db:local:setup
npm run db:migrate
npm start
```

The native helper defaults to `/usr/local/mysql/bin/mysqld`; set `MYSQLD_PATH` for another installation. It creates a project-only MySQL instance on **127.0.0.1:3307**, data under ignored `data/mysql-local/`, and random credentials in private `.env` / `data/mysql-local.json` files. It does not alter an existing MySQL service. Keep the state file: it contains the local root credential needed by the shutdown helper. Do not share or commit these files.

For subsequent starts when using the optional isolated instance:

```sh
npm run db:local:start
npm start
# To stop just this project's database after stopping the app:
npm run db:local:stop
```

The app remains at **http://127.0.0.1:3210**. Existing imported accounts and sessions continue to work. New registration creates an independent workspace. Passwords are salted with scrypt, sessions use HttpOnly cookies, and only key/password hashes are stored in the application tables.

For an existing or hosted MySQL service, create a dedicated database/account, copy `.env.example` to `.env`, and configure `DATABASE_URL`. URL-encode reserved characters in credentials. Set `MYSQL_SSL=true` for trusted TLS. Run `npm run db:migrate` before starting. An optional `MIGRATION_DATABASE_URL` can use a separate schema-owner account; the runtime account needs SELECT/INSERT/UPDATE/DELETE on the application schema. The native helper also grants schema-creation permissions to its local application account for convenience.

```sh
npm test
npm run check
```

Database tests require `TEST_DATABASE_URL` for a separate account permitted to create/drop databases beginning with `abtest`. The native setup configures this. Each test gets a randomly named disposable database; tests never fall back to `DATABASE_URL`. HTTP tests also open an ephemeral loopback port. Provider fixtures do not incur AI charges. `npm run dev` restarts after source edits; reload the browser for UI edits.

## Import the earlier SQLite prototype

Stop the old application before taking the snapshot, and keep all writes stopped until cutover finishes. Apply MySQL migrations to an empty destination, then run:

```sh
npm run db:import-sqlite -- ./data/autoblog.sqlite
```

The importer opens SQLite read-only, captures a consistent snapshot including WAL-visible data, writes a private JSON backup under `data/backups/`, and imports in a single MySQL transaction. It preserves IDs, password hashes, session hashes/expiry, website delivery-key hashes, article revisions, settings, and job payloads. It verifies record content and row counts before committing. Re-running the same snapshot is harmless. A changed source cannot overwrite a populated destination. The source SQLite files are retained untouched. Only this one-time importer and its tests load `node:sqlite`.

See [MySQL migration notes](docs/MYSQL_MIGRATION.md) for schema design, verified guarantees, and rollback limits.

## Automatic workflow

Open **Automation** (the default page). Add a website, monthly volume, budget, and a nonzero job allowance. In **Set up / Resume**, select fully automatic publication and start the flow. Topic guidance is optional.

Queued topics take priority. Otherwise the grounded Gemini research pass inspects the configured public website through Google Search, chooses a non-duplicate audience question, and researches it with at least two captured sources. Topic hints are optional. Research and writing use Gemini; structural and source-URL checks run locally. Full automation publishes new, unedited automation-generated drafts after checks without claiming human review or factual verification. Existing manual drafts stay private. Review mode schedules after a human approves.

The worker checks every five seconds while Node runs. One job per website runs at a time, spaced at 30 days divided by the monthly target, with no catch-up burst. Budget, monthly unique-topic and review-capacity checks still apply. The Automation card reports missing setup, exhausted budget, failures and the next run. Failed jobs are not automatically retried: inspect Activity, fix the cause, and Resume (which acknowledges past failures). Retry the failed topic explicitly if needed. Pause prevents queued automated jobs and automated publication; an already-running paid job can finish. Published articles remain available.

For testing, an active website's Automation card has a **Run now** button. It bypasses only the cadence timestamp and asks the normal automation pipeline to run immediately. Provider readiness, pauses, unresolved failures, active jobs, monthly volume, budget reservations, duplicate prevention, and review capacity still apply.

The website must consume the Delivery API to display published articles. This does not install frontend routes or render pages on the external website.

## Optional manual workflow

1. Add a website, its timezone, audience, monthly article target, budget, per-job reservation, and maximum review backlog.
2. Add at least three approved links from that website's origin, marking at least one as a service link.
3. Add a topic. Choose **Write manually** to create a private draft.
4. Fill the article fields, evidence notes, FAQs, table, and approved links. **Save & validate** refreshes the preview and reports required corrections.
5. Review sources and attribution. Confirm evidence review and approve the current revision.
6. Choose a future publication date. Input uses the browser timezone; the calendar displays the website timezone.
7. While the server is running, its worker checks every five seconds and makes eligible due articles available through the delivery API.
8. Create a website delivery key and connect your website's backend. Keys are shown once; rotation immediately revokes the previous key.

Editing an unpublished article clears approval and scheduling. Live content must be unpublished before editing in this milestone. Pausing generation and pausing scheduled publication are separate controls. Publication pause does not remove already-published content.

## Optional Gemini integration

Edit the existing `.env` without replacing MySQL settings. Set `GEMINI_API_KEY` and `ALLOW_PAID_GENERATION=true`, then restart. Research and writing default to `gemini-3.5-flash-lite`; override `GEMINI_RESEARCH_MODEL` or `GEMINI_WRITER_MODEL` if needed. The previous 2.5 model is unavailable to new API users. Tests mock AI calls. Enabled automation resumes when the server starts, so it may make paid calls after restart.

The adapter uses [Gemini generateContent](https://ai.google.dev/api/generate-content), Google Search grounding for research, and JSON-mode writing. It captures grounding sources, memo, support metadata, token usage when available, and the actual reported model. It blocks source-free research, limits writing to two attempts, and only inserts a draft after structural validation. Provider refusals, truncation, HTTP errors, and invalid JSON are failures. These paths are implemented; live provider access, grounding response compatibility, output quality, and billing have **not** been verified with a paid call.

## Article images: Gemini and OpenAI

Every article supports one cover image and an optional image for each section. Editors can enter an external image URL, alternative text, caption, and generation prompt, or generate an image from the saved article. Generated files are stored under `data/media/` and served from `/media/{id}.{ext}`; back up this directory with the database and move it to durable object storage before running multiple application hosts.

Website settings select Gemini, OpenAI, or no automatic image generation; a model ID, low/medium/high quality, zero to four inline images, and a reusable website image style. Automatic jobs generate a thumbnail-friendly 16:9 cover, then select the sections where an explanatory diagram, decision map, comparison, checklist, timeline, or conceptual illustration adds the most value. The same palette and art direction are applied across the article. Prompts reject common low-quality AI visual patterns such as generic robots, glowing brains, random circuitry, fake interfaces, unsupported data, and unnecessary text. Manual generation preserves planned alternative text and captions, but invalidates the current approval and schedule because it creates a new article revision. Image calls are paid calls and their returned usage is recorded when available, but cost reconciliation is not implemented.

For Gemini, set `GEMINI_API_KEY`, `GEMINI_IMAGE_MODEL`, and `ALLOW_PAID_GENERATION=true`. The economical default is `gemini-3.1-flash-lite-image`; current presets also include Nano Banana 2.1, Nano Banana 2, Nano Banana Pro, and the legacy Nano Banana model. For OpenAI, set `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL`, and the same paid-generation flag. The default is `gpt-image-2.5-flare`; premium and snapshot model presets are available. The model field accepts a custom provider model ID so new supported small or large image models do not require an application release.

Text research and writing still use the server's configured Gemini provider. Image provider and model selection are per website, while keys remain server-side environment variables; encrypted customer BYOK and Deep Research are later milestones. Before enabling a customer-facing grounded workflow, implement and review the provider's search-suggestions display requirements; the response metadata is retained but the current UI only displays memo/source links. See [Google grounding documentation](https://ai.google.dev/gemini-api/docs/google-search).

### Budget semantics

Monthly budget and per-job allowance are in USD cents. An InnoDB transaction reserves the allowance before queuing a job. Jobs that cannot fit are blocked, including competing admissions. Failed attempts retain their allowance. Retries create a new reservation and reuse captured research when possible.

**Reservations are not actual API costs or enforceable provider spending caps.** Provider charges may exceed the reserved allowance. There is no verified pricing table, invoice reconciliation, or exact tool-cost accounting yet. The UI labels reservations and unreconciled usage explicitly. Failed requests without returned usage must be checked against provider billing. Do not treat this milestone as satisfying FRS-26/27. Provider/account controls and complete stage accounting are required before production paid automation.

The monthly article target bounds unique topics admitted to AI generation in the current UTC month. It is not yet a monthly publishing quota. Review capacity limits the number of queued/running AI jobs plus pending/rejected drafts; it is not a staff scheduling feature. Manual drafts can be created independently of AI quotas.

## Delivery API

All delivery requests use `Authorization: Bearer <website delivery key>`. Keep the key in the consuming website's backend environment. This milestone intentionally provides server-to-server delivery without browser CORS access. Static sites can fetch at build time or use their own serverless proxy.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/sites/{siteId}/articles?limit=20&offset=0` | List published articles; maximum page size 100 |
| GET | `/api/v1/sites/{siteId}/articles/{slug}` | Retrieve one published article |

```js
// Run in the consuming website's backend.
const response = await fetch(
  `${process.env.AUTOBLOG_ORIGIN}/api/v1/sites/${process.env.AUTOBLOG_SITE_ID}/articles`,
  { headers: { Authorization: `Bearer ${process.env.AUTOBLOG_API_KEY}` } }
);
if (!response.ok) throw new Error(`Content API failed: ${response.status}`);
const { articles, total } = await response.json();
```

List response: `{ articles, total, offset, limit }`. Single response: `{ article }`. Articles contain title, slug, category, excerpt, author, description, quick answer, cover image, generated table of contents, structured sections and subsections, optional explanatory images, a visual step summary, comparison table, collapsible FAQs, references, internal links, tags, author profile, closing call to action, search context, dates, and escaped/rendered `html`. Delivery excludes drafts, research memos, evidence notes, review records, settings, credentials, and budgets. Unknown or private slugs return 404 after key validation. No external website is modified by publication; it makes content available for the consuming frontend to fetch.

The consuming website owns its public routes, canonical URLs, SEO/FAQ schema, sitemap, cache invalidation, and crawler-visible rendering. The complete product will offer reusable integration examples and webhook notifications. Unpublishing immediately removes an article from our API; existing consumer caches need their own invalidation policy.

## Admin API

Admin requests require a session cookie. Mutations require JSON and `X-Autoblog-Client: admin`, and reject untrusted origins. During local HTTP development, `localhost`, `127.0.0.1`, and `[::1]` are accepted on the configured port. Production origins must match `APP_ORIGIN` or an explicit comma-separated `APP_ALLOWED_ORIGINS` entry.

| Endpoint | Methods / behavior |
| --- | --- |
| `/api/auth/register`, `/api/auth/login` | POST; local account setup and sign-in |
| `/api/auth/me`, `/api/dashboard` | GET; authenticated workspace state |
| `/api/auth/logout` | POST; revoke current session |
| `/api/sites` | POST; create a website |
| `/api/sites/{id}` | PUT; update website settings |
| `/api/sites/{id}/key` | POST; issue/rotate read-only delivery key |
| `/api/sites/{id}/topics` | POST; create a deduplicated topic |
| `/api/sites/{id}/automation` | POST; configure themes, enabled flag, and review/automatic publishing mode |
| `/api/sites/{id}/automation/run` | POST; request an immediate test run while retaining normal admission safeguards |
| `/api/topics/{id}/draft` | POST; create or return the topic's manual draft |
| `/api/topics/{id}/generate` | POST; reserve budget and queue generation |
| `/api/jobs/{id}` | GET; inspect checkpoints, validation, usage, and failures |
| `/api/articles/{id}` | GET / PUT; inspect or edit with expected `revision` |
| `/api/articles/{id}/approve` | POST; expected revision plus `evidenceReviewed: true` |
| `/api/articles/{id}/reject` | POST; expected revision plus reason |
| `/api/articles/{id}/schedule` | POST; expected revision plus ISO `scheduledAt` |
| `/api/articles/{id}/unpublish` | POST; remove a live article from API delivery |

## Architecture and operating limits

```text
Admin browser → Node HTTP API → workspace-scoped services → MySQL / InnoDB
                                   ↓
                           in-process job worker → Gemini (optional)
                                   ↓
                           approved due article
                                   ↓
Website backend ← website-scoped REST delivery API
```

- `src/store.js`: database, transactions, scope queries, audit events.
- `src/domain.js`: website/topic/article policies, approval, publishing, reservation and job lifecycle.
- `src/content.js`: content normalization, structural checks, HTML rendering with escaped user/model text.
- `src/provider.js`: optional research/writing adapter.
- `src/server.js`: HTTP, sessions, authentication, routing, and local worker.
- `public/`: responsive admin UI and editor.
- `test/`: isolation, API integration, publication, approval, budget-admission, retries, and provider contract tests.

The storage layer uses a connection pool and asynchronous queries. Each mutation holds a workspace coordination-row lock in one InnoDB transaction; decisions involving budget, topic state, approval revision, and scheduling are serialized for that workspace. Independent workspaces can proceed concurrently. Unique indexes protect topic titles, article slugs, article-per-topic, active-job-per-topic, and occupied schedule slots. Composite foreign keys enforce website/workspace ownership.

Dedicated tables store workspaces, users, sessions, websites, topics, articles, jobs, approvals, per-call usage records, and audit events. Flexible article/research/settings snapshots remain in JSON payloads. Indexed relational columns hold the fields needed for delivery, queueing, scheduling, and budgets. Amounts remain integer cents. UTC timestamps use fixed-width ISO strings, allowing exact ordering and preserving the prototype's precision.

A MySQL advisory lock elects one scheduler/generation dispatcher per database. Additional app instances can serve API traffic but do not recover or dispatch another worker's running jobs. A second instance must restart to take over after the owner exits; automatic failover and durable per-job leases remain later work. Shutdown stops new dispatch and drains in-flight jobs before releasing the worker lock. Interrupted paid requests still require billing review before retry; external timeouts cannot promise exactly-once provider execution.

Delivery pagination, website-key lookup, due-publication selection, and budget sums execute in MySQL. The admin dashboard and some editorial preflight checks still load workspace-scoped records; those need paginated admin endpoints and narrower queries before very large workspaces. MySQL migration is a scalability foundation, not a throughput benchmark or production-readiness claim. No Firebase services or WordPress integration are used.

## Remaining work before production

- Real provider validation and billing reconciliation, stage-level reservations, complete failure usage, price snapshots, and provider caps.
- Editorial policy agreement, claim verification, source freshness, semantic duplicate checks, model pilot, and expert review policy.
- Team invitations and roles, managed identity or verified email/password recovery, persistent/distributed abuse prevention, and account lifecycle controls. All current account holders are workspace administrators.
- TLS deployment, secure secret management, source/retention policy, backups and restore tests, monitoring, rate limits for the delivery API, paginated admin queries, and tested backup/restore procedures.
- Per-job durable leases, automatic worker failover, multi-host failure tests, and scheduler availability.
- Recurring calendar slots, daily limits, rescheduling, author directory, batch review, deterministic chart rendering, auto-topic suggestions, configurable provider profiles, allowlisted auto-approval, and webhooks.
- Full keyboard/accessibility/mobile QA and consumer-side SEO templates. Accessibility compliance is not certified.

Public registration is enabled for local development. Set `DISABLE_REGISTRATION=true` after creating local accounts if needed. The server binds only to loopback by default. Do not expose this build publicly without completing the production work above.

For hPanel hosting without PM2, set `WORKER_MODE=cron` and schedule `scripts/worker-once.js`. See [hPanel cron setup](docs/HPANEL_CRON.md).

The Websites and Calendar pages share a monthly box calendar with article and unfinished-job counts, status colors, and full-article/job links. Website, month, selected date, and expanded days persist in URL parameters and workspace-scoped browser storage. Published articles use their publication date, scheduled articles their schedule date, and drafts/jobs their creation date.

Writer requests include a JSON response schema and only the research memo/source list. Invalid or truncated writer output can consume remaining writing passes (at most three total, with at most one JSON repair call per pass). The pass counter persists across transient job retries. Safety refusals, configuration failures and ambiguous network interruptions stop for inspection. Activity retains failed-call usage when available and safe response diagnostics (model, finish/block reason, output length and JSON status); it does not retain rejected article text. Failed existing jobs are not replayed automatically.

Integrating another website? See the [Delivery API integration guide](docs/DELIVERY_API_INTEGRATION.md) and [OpenAPI specification](docs/DELIVERY_API.openapi.json) for published-article listing and detail endpoints.
