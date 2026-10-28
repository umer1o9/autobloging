# AutoBlog Studio — Website Integration Guide

This guide documents the delivery API implemented in the repository. It provides two read-only endpoints for showing **published articles** on any website, regardless of CMS or frontend framework.

Production API base URL: `https://autoblogging.snaprytr.com`

Import the accompanying [OpenAPI specification](DELIVERY_API.openapi.json) into Postman or an OpenAPI-compatible client to explore the endpoints. Replace placeholders with your own website ID and delivery key; no real credentials are included in these files.

## 1. How the integration works

```text
Visitor → Your website/backend → AutoBlog delivery API → Published articles
                              ↳ Website-specific secret delivery key
```

Your website controls its blog listing, article URLs, page design, SEO metadata, sitemap and caching. AutoBlog provides structured article content, images and a ready-to-render article HTML fragment. This is a pull API: it does not install a plugin, push files to your website, or send publication webhooks.

Create these two routes on your website:

| Your website route | What it displays | AutoBlog API to call from your backend |
| --- | --- | --- |
| `/blog` | Paginated article cards | Article listing |
| `/blog/{slug}` | One complete article | Article details |

## 2. Get your website ID and delivery key

1. In AutoBlog Studio, open **Websites** and select the website you are integrating.
2. Click **Create API key** (or **Rotate API key** if replacing an existing key).
3. Copy the returned delivery key and website ID. The Delivery API page also displays the listing endpoint for the selected website; its path contains the website ID.
4. Save them in your receiving website's **backend environment**, outside public files and version control.

Example receiving-website configuration:

```dotenv
AUTOBLOG_BASE_URL=https://autoblogging.snaprytr.com
AUTOBLOG_SITE_ID=YOUR_WEBSITE_ID
AUTOBLOG_API_KEY=YOUR_WEBSITE_DELIVERY_KEY
```

These are settings for the **receiving website**, not additional requirements for the AutoBlog server itself.

- Use the delivery key created for this particular website. A Gemini/OpenAI API key or an AutoBlog login password will not work.
- Keys only read published content for their associated website. An admin session cookie is not required.
- Keep the key on your server. Do not put it in browser JavaScript, HTML, a mobile bundle, or frontend-exposed variables such as `NEXT_PUBLIC_*` or `VITE_*`.
- Key rotation immediately invalidates the previous key. Update every receiving backend that uses it.

## 3. Authentication

Send this header on **both** requests:

```http
Authorization: Bearer YOUR_WEBSITE_DELIVERY_KEY
```

Use HTTPS in production. Delivery GET requests do not need `X-Autoblog-Client`, an admin cookie, or a JSON request body. The API does not currently enable cross-origin browser access; make the request from your backend and return only the data your frontend needs.

## 4. API 1 — Article listing

```http
GET /api/v1/sites/{siteId}/articles?limit=12&offset=0
```

| Parameter | Location | Required | Meaning |
| --- | --- | --- | --- |
| `siteId` | Path | Yes | Website ID associated with the delivery key |
| `limit` | Query | No | Integer 1–100; defaults to 20 |
| `offset` | Query | No | Integer 0 or greater; defaults to 0 |

```bash
curl --get \
  'https://autoblogging.snaprytr.com/api/v1/sites/YOUR_WEBSITE_ID/articles' \
  --header "Authorization: Bearer $AUTOBLOG_API_KEY" \
  --data-urlencode 'limit=12' \
  --data-urlencode 'offset=0'
```

Set `AUTOBLOG_API_KEY` privately in your shell/backend before using the example; do not paste a real key into shared commands or screenshots.

Response (`200 OK`, illustrative article values):

```json
{
  "articles": [
    {
      "id": "ARTICLE_ID",
      "slug": "how-to-plan-a-software-development-roadmap",
      "title": "How to Plan a Software Development Roadmap",
      "excerpt": "A practical guide to planning a software roadmap.",
      "category": "SaaS Development",
      "author": "Editorial team",
      "coverImage": {
        "url": "https://autoblogging.snaprytr.com/media/IMAGE_ID.jpg",
        "alt": "A software development roadmap",
        "caption": "",
        "prompt": "",
        "provider": "gemini",
        "model": "CONFIGURED_IMAGE_MODEL",
        "generatedAt": "2026-10-29T09:00:00.000Z"
      },
      "publishedAt": "2026-10-29T10:00:00.000Z",
      "updatedAt": "2026-10-29T10:00:00.000Z",
      "html": "<article>...</article>"
    }
  ],
  "total": 25,
  "offset": 0,
  "limit": 12
}
```

The example omits other article fields for readability. **Each listing entry currently contains the full article object, including structured sections and HTML**, not just a summary. Map the fields needed by your cards rather than forwarding the whole upstream payload to the browser.

Use these fields for each card:

- Link: `/blog/` + `slug` (the URL belongs to your website).
- Title: `title`.
- Description: `excerpt`.
- Thumbnail: `coverImage.url`, when non-empty; alternative text: `coverImage.alt`.
- Optional labels: `category`, `author`, `publishedAt`.

Articles are ordered by `publishedAt` descending, then article ID descending. No category, search, date-range or custom-sort filters are implemented.

### Pagination

For 12 articles per page:

| Page | `limit` | `offset` |
| --- | --- | --- |
| 1 | 12 | 0 |
| 2 | 12 | 12 |
| 3 | 12 | 24 |

```js
const offset = (page - 1) * pageSize;
const hasNextPage = response.offset + response.articles.length < response.total;
```

An empty website or an offset beyond the end returns `200` with `articles: []`. New publications can shift offset-based pages; the API does not provide snapshot cursors.

## 5. API 2 — Article details

```http
GET /api/v1/sites/{siteId}/articles/{slug}
```

**Use the article slug from the listing, not its UUID.** Do not add a trailing slash to either endpoint.

```bash
curl \
  'https://autoblogging.snaprytr.com/api/v1/sites/YOUR_WEBSITE_ID/articles/how-to-plan-a-software-development-roadmap' \
  --header "Authorization: Bearer $AUTOBLOG_API_KEY"
```

Response envelope:

```json
{
  "article": {
    "id": "ARTICLE_ID",
    "slug": "how-to-plan-a-software-development-roadmap",
    "title": "How to Plan a Software Development Roadmap",
    "html": "<article>...</article>"
  }
}
```

The example is abbreviated. The full detail object has the same fields as a listing entry.

### Complete article field reference

| Field | Shape | Intended use |
| --- | --- | --- |
| `id` | String | Stable article identifier |
| `slug` | String | Article route on your website |
| `title` | String | Page title and article heading |
| `category` | String | Category label |
| `excerpt` | String | Listing description / introductory text |
| `metaDescription` | String | Page's meta description |
| `author` | String | Author display name |
| `directAnswer` | String | Quick-answer block |
| `primaryKeyword` | String | Editorial SEO hint |
| `searchIntent` | String | Editorial classification |
| `coverImage` | Image object | Cover/thumbnail image |
| `sections` | Section array | Structured article body |
| `visualSummary` | Object | Title, description, caption and `steps: [{title, description}]` |
| `table` | Object | `title`, `intro`, `headers: string[]`, `rows: string[][]` |
| `faqs` | Array | `[{question, answer}]` |
| `references` | Array | `[{title, url}]`; private evidence notes are excluded |
| `internalLinks` | Array | `[{title, url}]` |
| `authorBio` | Object | `{name, bio}` |
| `callToAction` | Object | `{heading, description, label, url}` |
| `tags` | String array | Optional labels |
| `publishedAt` | ISO timestamp | Publication time |
| `updatedAt` | ISO timestamp | Stored update time, falling back to publication time |
| `html` | String | Complete article HTML fragment |

Do not use `updatedAt` as a guaranteed change feed or revision token. There is no incremental sync endpoint. The delivery projection does not include job diagnostics, research objects, approvals or admin-only workflow state.

Image object:

```json
{
  "url": "https://autoblogging.snaprytr.com/media/IMAGE_ID.jpg",
  "alt": "Meaningful alternative text",
  "caption": "Optional caption",
  "prompt": "Generation prompt, if present",
  "provider": "gemini",
  "model": "CONFIGURED_IMAGE_MODEL",
  "generatedAt": "2026-10-29T09:00:00.000Z"
}
```

Image fields can be empty strings. Display an image only when `url` is non-empty; never render generation prompts as page content.

Section object:

```json
{
  "heading": "How should you plan the roadmap?",
  "paragraphs": ["First paragraph.", "Second paragraph."],
  "bullets": ["An actionable point"],
  "subsections": [
    {
      "heading": "Define the first milestone",
      "paragraphs": ["A supporting explanation."],
      "bullets": []
    }
  ],
  "image": {
    "url": "",
    "alt": "",
    "caption": "",
    "prompt": "",
    "provider": "",
    "model": "",
    "generatedAt": ""
  }
}
```

## 6. Server-side JavaScript example

This helper works on a Node.js backend with native `fetch`. Save it as `autoblog-client.mjs` in your receiving project and load that project's environment variables before starting the server.

```js
export class DeliveryApiError extends Error {
  constructor(status, message, requestId) {
    super(message);
    this.status = status;
    this.requestId = requestId;
  }
}

async function deliveryRequest(suffix = '', query = {}) {
  const base = process.env.AUTOBLOG_BASE_URL;
  const site = process.env.AUTOBLOG_SITE_ID;
  const key = process.env.AUTOBLOG_API_KEY;
  if (!base || !site || !key) throw new Error('AutoBlog integration is not configured.');

  const url = new URL(
    `/api/v1/sites/${encodeURIComponent(site)}/articles${suffix}`,
    base
  );
  for (const [name, value] of Object.entries(query)) {
    url.searchParams.set(name, String(value));
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15000),
    cache: 'no-store'
  });
  const requestId = response.headers.get('x-request-id');
  let body;
  try {
    body = await response.json();
  } catch {
    throw new DeliveryApiError(response.status, 'AutoBlog returned a non-JSON response.', requestId);
  }
  if (!response.ok) {
    throw new DeliveryApiError(response.status, body.error || 'AutoBlog request failed.', requestId);
  }
  return body;
}

export function listArticles({ limit = 12, offset = 0 } = {}) {
  return deliveryRequest('', { limit, offset });
}

export async function getArticle(slug) {
  if (typeof slug !== 'string' || !slug.trim()) throw new Error('Article slug is required.');
  const { article } = await deliveryRequest(`/${encodeURIComponent(slug)}`);
  return article;
}
```

Use it from the backend routes/templates of your existing framework:

```js
import { listArticles, getArticle, DeliveryApiError } from './autoblog-client.mjs';

// Your GET /blog handler:
const listing = await listArticles({ limit: 12, offset: 0 });
const cards = listing.articles.map(article => ({
  title: article.title,
  excerpt: article.excerpt,
  href: `/blog/${encodeURIComponent(article.slug)}`,
  image: article.coverImage.url,
  imageAlt: article.coverImage.alt,
  publishedAt: article.publishedAt
}));
// Pass cards and listing.total to your framework's listing template.

// Your GET /blog/:slug handler:
try {
  const article = await getArticle(slugFromYourRouter);
  // Pass article to your framework's article template.
} catch (error) {
  if (error instanceof DeliveryApiError && error.status === 404) {
    // Render your own 404 page with HTTP 404.
  } else {
    // Log the status/request ID server-side and render an unavailable page.
    // Do not display credentials or raw provider/internal logs.
    throw error;
  }
}
```

The route-handler example is framework-neutral pseudocode: supply `slugFromYourRouter` and your framework's render/response functions. Do not expose the upstream API key through your own proxy route.

## 7. PHP backend example

PHP requires the cURL extension. Read the same three receiving-website environment variables:

```php
<?php
function autoblogRequest(string $suffix = '', array $query = []): array {
    $base = getenv('AUTOBLOG_BASE_URL');
    $site = getenv('AUTOBLOG_SITE_ID');
    $key = getenv('AUTOBLOG_API_KEY');
    if (!$base || !$site || !$key) {
        throw new RuntimeException('AutoBlog integration is not configured.');
    }
    $url = rtrim($base, '/') . '/api/v1/sites/' . rawurlencode($site) . '/articles' . $suffix;
    if ($query) $url .= '?' . http_build_query($query);
    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $key],
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 15
    ]);
    $response = curl_exec($curl);
    $status = curl_getinfo($curl, CURLINFO_HTTP_CODE);
    curl_close($curl);
    if ($response === false) throw new RuntimeException('AutoBlog could not be reached.');
    $body = json_decode($response, true, 512, JSON_THROW_ON_ERROR);
    if ($status !== 200) {
        throw new RuntimeException('AutoBlog HTTP ' . $status . ': ' . ($body['error'] ?? 'Request failed'), $status);
    }
    return $body;
}

$listing = autoblogRequest('', ['limit' => 12, 'offset' => 0]);
// For your article route, use the slug supplied by your router:
// $article = autoblogRequest('/' . rawurlencode($slug))['article'];
```

Map an upstream 404 to your article page's 404 response. Use `htmlspecialchars` for title, excerpt, metadata and other text fields in your templates.

## 8. Rendering, images and SEO

Choose one rendering approach:

**Ready HTML:** render `article.html` inside your website's article layout. It already includes the article title, cover image, quick answer, table of contents, sections, inline images, visual summary, comparison table, FAQs, references, author profile and closing call to action. Avoid duplicating the title and cover above it. The server constructs this HTML from escaped structured fields; render only the `html` field from your configured AutoBlog backend, not arbitrary visitor-submitted HTML.

**Custom components:** use the structured fields to build your own layout. Render paragraphs as text, `bullets` as lists, `subsections` as nested sections, `table` as a table, and each image only when its URL is present. Your frontend framework's normal escaping should remain enabled for text fields.

The HTML fragment does not include CSS or a document `<head>`. Add your own responsive article styling. A minimal starting point:

```css
.blog-content { max-width: 780px; margin: auto; line-height: 1.75; }
.blog-content img { display: block; max-width: 100%; height: auto; }
.blog-content figure { margin: 1.5rem 0; }
.blog-content .article-table-wrap { overflow-x: auto; }
.blog-content table { width: 100%; border-collapse: collapse; }
.blog-content th, .blog-content td { border: 1px solid #ddd; padding: .75rem; }
.blog-content .quick-answer, .blog-content .visual-summary { padding: 1rem; background: #f4f7f5; }
```

Image URLs are absolute. They can be displayed directly without an Authorization header, though your website's CSP or image-optimization framework may need to allow the AutoBlog image hostname. This API key does not make media URLs private.

On the AutoBlog server, `APP_ORIGIN` must be its public HTTPS origin so newly generated images have public URLs. `MEDIA_DIRECTORY` can point to persistent storage shared by the web server and cron. Changing `APP_ORIGIN` does not rewrite older saved image URLs; migrated articles with `localhost` URLs need a separate URL/data correction and their image files must exist on the hosted server.

Your receiving website must set:

- `<title>` from the article title and a safely escaped meta description from `metaDescription`.
- A canonical URL on **your website**, e.g. `https://yourwebsite.com/blog/{slug}`.
- Open Graph title, description and cover image when present.
- Sitemap entries for published article URLs; use your own SEO integration to generate structured data if needed. The API does not return a separate JSON-LD schema field.

## 9. Publication, caching and synchronization

Only records whose current article status is `published` are delivered. Draft, approved, scheduled, rejected and failed-generation records are excluded. Publication makes an article available through this API; your website still needs its `/blog` and detail routes to display it.

An existing article that is unpublished disappears from the listing and its detail endpoint returns 404. If its slug changes, the old slug is not automatically redirected by this API; redirects belong to your website.

The API sends `Cache-Control: no-store`. Start with backend fetches on each page request, as in the JavaScript example. If you intentionally add your own short cache or database synchronization, choose the acceptable freshness window and purge removed/unpublished articles. Do not serve a cached article indefinitely after its API endpoint returns 404. Webhooks, ETags and `updatedSince` synchronization are not implemented.

For a periodic importer, fetch every page and upsert records by `id`, using `slug` for routing. Mark removed records unavailable only after a complete successful scan; never interpret an authentication error or failed page request as an empty article list. Retain source IDs so edits do not produce duplicates.

## 10. Error handling and troubleshooting

Typical JSON error body:

```json
{
  "error": "Valid website delivery key required.",
  "requestId": "REQUEST_ID"
}
```

| HTTP status | Meaning / action |
| --- | --- |
| `200` | Success; an empty listing is valid |
| `400` | Invalid pagination; check integer `limit` and `offset` |
| `401` | Missing/incorrect/rotated key, unknown site ID, or a key belonging to another website |
| `404` | Wrong API path, unknown slug, or an article that is not currently published |
| `500` | Application/database failure; keep the request ID for investigation |

Hosting proxies may also return HTML, empty responses, 502 or 503 errors. Handle HTTP status and JSON parse failures independently. Never retry authentication errors, invalid parameters or 404s automatically. For transport failures and temporary 5xx errors on these read-only GET requests, a receiving backend can use a small bounded backoff (for example, two retries after 1 and 3 seconds).

| Symptom | Check |
| --- | --- |
| `articles: []` | Correct website selected? Article actually published? `offset` too large? |
| Details return 404 | Use listing `slug`, not article UUID; verify current publication status |
| 401 after working previously | Key may have been rotated; update the receiving backend's environment |
| Images missing | Check absolute image URL, file persistence, CSP and image-optimizer host configuration |
| JSON parse error | Inspect upstream HTTP status and content type; the hosting proxy may have returned a non-JSON error |
| New articles appear late | Check AutoBlog job/publication status, cron output, and your website's own cache |

Do not change admin-origin settings to bypass browser CORS. Route the integration through your receiving backend instead.

## 11. Implementation checklist

- [ ] Correct website ID and delivery key stored only on the receiving backend.
- [ ] `/blog` renders cards from the listing with working pagination.
- [ ] Each card links to `/blog/{slug}` on your website.
- [ ] Detail pages fetch by slug and show the entire article.
- [ ] Cover and inline images load on the public website.
- [ ] Missing/unpublished articles return an actual 404 page.
- [ ] Title, description, canonical URLs and sitemap entries are configured.
- [ ] Authentication, network and malformed-response errors have controlled handling.
- [ ] Key rotation and any local caching/synchronization strategy are tested.

Implementation references in this repository: delivery routes in `src/server.js`, delivery projection in `src/domain.js`, pagination/publication queries in `src/store.js`, and normalized fields/HTML generation in `src/content.js`.
