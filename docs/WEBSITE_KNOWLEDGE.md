# Website knowledge and resync

In **Websites**, select a website from the dropdown. The **Website knowledge** panel shows its indexed-page count, sync state and last successful sync. Use **Resync website** whenever its content changes. New websites and website URL changes automatically queue an initial sync. Existing websites can start their first sync with this button.

**View saved pages** shows the saved URLs, titles, descriptions, headings, fetched timestamps and recent crawl errors. Open a page's Markdown, download one page, or download the complete active snapshot. Search saved passages to see the text available to the AI. The Markdown documents also include discovered internal URLs, image URLs/alt text, canonical URL and supported JSON-LD metadata.

## Background processing

The HTTP action only queues work and returns HTTP 202. The existing embedded worker or `npm run worker:once` cron processes at most ten page URLs and roughly one minute of crawling per pass, then continues article work. Later worker passes resume the crawl. Do not create a second cron entry. Overlapping workers are excluded by the application's existing database worker lock.

A resync is idempotent while that website has an active sync. Progress is durable in MySQL, including the frontier of discovered URLs. Until the crawl finishes, the previous active snapshot remains available for search and generation. Successful completion replaces the snapshot and removes old records, including pages no longer discovered. Partial completion activates the pages it could collect and clearly shows coverage warnings. A failed run leaves the previous active snapshot intact. A changed website URL clears the old index from use.

States: `not_synced`, `queued`, `running`, `completed`, `partial`, `failed`. Errors are visible on the website panel and in **View saved pages**. Worker logs include `[website-sync]` with the website ID and saved/visited/pending counts.

## What is captured

The crawler follows the connected URL, same-origin internal links, and up to five same-origin sitemap files/indexes. It observes robots.txt, noindex directives and a crawl delay. It makes GET requests without login cookies. Page extraction saves the readable main content as Markdown plus titles, descriptions, headings, canonical links, links, image metadata and JSON-LD. Canonical aliases and duplicate page content are consolidated so homepage fallbacks and repeated URLs do not mislead the AI. It does not execute JavaScript or download images.

The current bounds are 200 saved HTML pages, 600 attempted page URLs, 2,000 discovered URLs, 1 MB per HTTP response, 60,000 characters of readable text per page, and approximately 12 MB of Markdown per sync. Text over the per-page limit is truncated. Crawl delays above 60 seconds are not supported and produce a clear failure. A partial result does not mean every page on a website was captured. Login pages, form data, private/local networks, external origins, non-HTML documents and JavaScript-only content are excluded. Use the final canonical origin in website settings; cross-origin redirects (including a switch to www) require updating that URL.

## Retrieval and article generation

The Markdown is stored durably in MySQL, rather than in an ephemeral hosting build folder. Downloads create `.md` files on demand. Each page also has overlapping text chunks with normalized sparse 4,096-dimensional hashed term vectors stored in JSON. Retrieval ranks them by cosine similarity and passes up to eight relevant passages within a bounded context to article topic discovery and writing. This is local lexical vector retrieval, not an external semantic embedding model or hosted vector database. It needs no additional API key or embedding charges. Website context increases the writing prompt size, so normal provider input-token charges still apply.

Each article job records the retrieved passages and snapshot run ID in its generation details for traceability and stable retries. Automatic discovery retrieves again after choosing the actual article topic. All retrieval is scoped to the signed-in workspace and website. Source text is untrusted context and does not override the generation policy. Website claims supplement independent research; the system does not treat the website itself as independent factual verification. Discovered links do not automatically become approved publishing links—manage those in Website settings.

## Deployment

This feature adds migration **2** (`migrations/002_website_knowledge.sql`) for `website_knowledge` and `website_pages`. Run:

```sh
npm ci
npm run db:migrate
```

Then restart/redeploy the web app and retain your existing cron command for `scripts/worker-once.js`. No new environment variables are required. In hPanel, run the migration using the deployment/build command (for example `npm ci && npm run db:migrate`) with database environment variables available. Do not replace the web startup file with the worker script.

## Private admin endpoints

These require the normal signed-in admin session and the application's normal admin request headers/origin rules. They are not public delivery-key endpoints.

- `POST /api/sites/{siteId}/knowledge/sync`: queue or return the active sync.
- `GET /api/sites/{siteId}/knowledge`: summary and page metadata for the active snapshot.
- `GET /api/sites/{siteId}/knowledge/document`: `{ "markdown": "..." }` for the complete active snapshot. Add `?url=ENCODED_PAGE_URL` for one page.
- `GET /api/sites/{siteId}/knowledge/search?q=QUERY`: relevant passages and the snapshot run ID.
