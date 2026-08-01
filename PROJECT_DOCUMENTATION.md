# AI SignalDesk Project Documentation

Last reviewed locally: 2026-07-28

## 1. Project Overview

AI SignalDesk is a local-first Node.js SaaS MVP for publishing daily AI opportunity intelligence collected by n8n. The application receives posts from automation workflows, stores them in local JSON files, displays them in a searchable web dashboard, generates daily email digests, captures subscriber leads, and provides an optional OpenRouter-powered chatbot that answers questions using the local feed as context.

The product is positioned as a decision-ready intelligence desk for:

- AI job seekers
- AI researchers
- founders and builders
- agencies and operators
- content creators who turn market signals into LinkedIn posts, newsletters, reports, prompt packs, and image creative briefs

## 2. Current Repository Structure

```text
H:\n8nDailyRashi
|-- .gitignore
|-- README.md
|-- PROJECT_DOCUMENTATION.md
|-- package.json
|-- server.js
|-- openrouter.txt
|-- AISignal_n8n-http-request-example.json
|-- AISignal_n8n-real-opportunity-workflow.js
|-- AISignal_n8n-real-opportunity-workflow-v2.js
|-- AISignal_n8n-real-opportunity-workflow-v3.js
|-- server.err.log
|-- server.out.log
|-- data
|   |-- news.json
|   `-- leads.json
`-- public
    |-- index.html
    |-- app.js
    |-- styles.css
    `-- assets
        `-- conference-template-a4.docx
```

## 3. Technology Stack

- Runtime: Node.js 18 or newer
- Server: native Node `http` module
- Storage: local JSON files under `data/`
- Frontend: static HTML, CSS, and vanilla JavaScript
- Automation: n8n workflows and HTTP Request nodes
- Optional AI chat: OpenRouter OpenAI-compatible chat completions API

There are no npm package dependencies in the current `package.json`. The app uses built-in Node modules and browser APIs.

## 4. How To Run Locally

From the project root:

```powershell
npm start
```

Then open:

```text
http://localhost:4173
```

The default port is `4173`. You can override it:

```powershell
$env:PORT="5000"
npm start
```

## 5. Environment Variables

| Variable | Required | Default | Purpose |
|---|---:|---|---|
| `PORT` | No | `4173` | Local HTTP server port. |
| `WEBHOOK_TOKEN` | No | empty | Protects ingestion endpoint and lead export when set. |
| `SOURCE_CHECK_ENABLED` | No | `true` | Checks source reachability before accepting feed items. |
| `SOURCE_CHECK_TIMEOUT_MS` | No | `8000` | Per-source validation timeout. |
| `SOURCE_CHECK_CONCURRENCY` | No | `8` | Maximum simultaneous source checks. |
| `SOURCE_CHECK_ALLOW_403_HOSTS` | No | `remotive.com` | Providers whose API confirms listings but whose pages block automated checks. |
| `N8N_LIVE_WEBHOOK_URL` | No | `https://n8n.ailabworks.tech/webhook/ai-opportunity-real-data-pull-v2` | Remote n8n webhook used by the homepage live update button. |
| `N8N_LIVE_WEBHOOK_TOKEN` | No | empty | Optional token sent as `x-live-update-token` to n8n live webhook. |
| `OPENROUTER_API_KEY` | Yes for chat | empty | Enables `/api/chat` and the homepage chatbot. |
| `OPENROUTER_MODEL` | No | `qwen/qwen3.7-flash` | Model used for feed-grounded chat. |
| `OPENROUTER_SITE_URL` | No | `http://localhost:<PORT>` | OpenRouter HTTP referer metadata. |
| `OPENROUTER_SITE_NAME` | No | `AI SignalDesk` | OpenRouter title metadata. |

Important: `openrouter.txt` appears to be a local credential/helper file. Keep it private and avoid committing or sharing it.

## 6. Main Application Flow

1. n8n collects AI opportunities from external sources.
2. n8n posts JSON items to `POST /api/posts/daily`.
3. `server.js` normalizes incoming payloads and verifies that every source link is public and reachable.
4. Unavailable sources are rejected; accepted posts are deduplicated by `id`, sorted by `publishedAt` descending, and saved to `data/news.json`.
5. The frontend fetches `GET /api/posts`, renders the dashboard, and refreshes every 60 seconds.
6. Users can filter, search, view post detail pages, subscribe to daily email, request live updates, and ask the AI copilot questions.

## 7. Backend Design

The backend lives in `server.js`.

### Responsibilities

- serve static files from `public/`
- serve dynamic post detail pages at `/post/<id>`
- expose JSON API routes under `/api/`
- normalize and persist posts
- normalize and persist subscriber leads
- generate HTML and text email digests
- proxy chatbot requests to OpenRouter
- trigger a remote n8n live update webhook

### Storage Files

| File | Purpose |
|---|---|
| `data/news.json` | Main local post feed. |
| `data/leads.json` | Subscriber and preview signup records. |

If either file is missing, `ensureStore()` creates it as an empty JSON array.

## 8. API Reference

### `GET /api/posts`

Returns the stored opportunity feed.

Equivalent route:

```text
GET /api/news
```

Response:

```json
{
  "items": []
}
```

### `POST /api/posts/daily`

Main stable n8n ingestion endpoint.

Equivalent routes:

```text
POST /api/posts
POST /api/news
```

Accepted body:

- a single post object
- an array of post objects
- an object with an `items` array
- an n8n-style item with a nested `json` object

Response:

```json
{
  "ok": true,
  "received": 1,
  "total": 10
}
```

If `WEBHOOK_TOKEN` is set, requests must include one of:

```text
Authorization: Bearer <token>
x-webhook-token: <token>
```

### `DELETE /api/posts`

Clears the local feed by writing an empty array to `data/news.json`.

Equivalent route:

```text
DELETE /api/news
```

Response:

```json
{
  "ok": true
}
```

### `POST /api/subscribe`

Creates or updates a subscriber record.

Equivalent route:

```text
POST /api/leads
```

Required field:

- `email`

Optional fields:

- `name`
- `role`
- `channel`
- `interests`
- `frequency`
- `digestFormat`
- `subscribed`

Response:

```json
{
  "ok": true,
  "message": "Subscribed to the daily formatted AI opportunity email.",
  "lead": {
    "id": "...",
    "email": "user@example.com",
    "interests": [],
    "channel": "email",
    "frequency": "daily",
    "digestFormat": "html",
    "subscribed": true,
    "plan": "free-preview"
  }
}
```

### `GET /api/leads`

Exports subscriber records for n8n or another email workflow.

Requires `WEBHOOK_TOKEN`. Without the token configured, the route returns `403`.

Authentication:

```text
Authorization: Bearer <token>
```

or:

```text
x-webhook-token: <token>
```

### `POST /api/live-update`

Triggers the configured remote n8n live webhook. The server posts:

```json
{
  "source": "webapp-live-button",
  "requestedAt": "2026-07-28T..."
}
```

If the n8n response includes an array of items, or an object with `items`, the server normalizes and stores those posts.

### `GET /api/digest/daily`

Returns a structured email digest payload.

Response includes:

- `subject`
- `preheader`
- `html`
- `text`
- `counts`
- `items`

### `GET /api/digest/daily.html`

Returns the rendered HTML email digest directly in the browser.

### `POST /api/chat`

Sends a user message and recent chat history to OpenRouter with the current feed as context.

Requires:

```text
OPENROUTER_API_KEY
```

Request:

```json
{
  "message": "Compare today's top AI jobs",
  "history": [
    {
      "role": "user",
      "content": "Previous message"
    }
  ]
}
```

Response:

```json
{
  "ok": true,
  "reply": "...",
  "model": "qwen/qwen3.7-flash",
  "suggestions": [],
  "sources": []
}
```

## 9. Post Data Model

Stored posts use this normalized shape:

```json
{
  "id": "daily-ai-brief-2026-07-27",
  "title": "Daily AI Brief",
  "company": "Curated by n8n",
  "link": "https://example.com/source",
  "summary": "Short homepage summary.",
  "content": "Full article text.",
  "location": "Global",
  "publishedAt": "2026-07-27T08:00:00+05:30",
  "category": "Research",
  "fitScore": 88,
  "tags": ["LLM", "Jobs", "Startups"],
  "imageUrl": "https://example.com/cover.jpg",
  "receivedAt": "2026-07-28T..."
}
```

### Accepted Input Aliases

The backend accepts several alternate field names.

| Normalized field | Accepted input names |
|---|---|
| `title` | `title`, `headline`, `jobTitle`, `position` |
| `company` | `company`, `organization`, `employer`, `source`, `publisher` |
| `link` | `link`, `url`, `applyUrl`, `sourceUrl` |
| `summary` | `summary`, `description`, `snippet`, `excerpt` |
| `content` | `content`, `body`, `article`, `fullText` |
| `location` | `location`, `place`, `region` |
| `publishedAt` | `publishedAt`, `postedAt`, `date`, `createdAt` |
| `category` | `category`, `type`, `track`, `section` |
| `fitScore` | `fitScore`, `score`, `match` |
| `tags` | `tags`, `keywords`, `skills` |
| `imageUrl` | `imageUrl`, `image`, `thumbnail`, `coverImage` |
| `id` | `id`, `slug` |

If `id` is missing, the server creates one from `publishedAt` and `title`.

## 10. Category Normalization

The backend and frontend both normalize categories with similar alias maps.

| Input aliases | Normalized category |
|---|---|
| `job`, `jobs`, `career`, `careers` | `Jobs` |
| `research`, `paper`, `papers` | `Research` |
| `startup`, `startups`, `startup news`, `funding` | `Startup News` |
| `product`, `products`, `ai product`, `ai products`, `tool`, `tools` | `AI Products` |
| `prompt`, `prompts`, `prompting`, `prompt engineering` | `Prompts` |
| `image`, `images`, `image prompt`, `image prompts`, `visual prompt`, `visual prompts`, `image generation`, `visual marketing` | `Image Prompts` |
| `news` | `News` |
| `update`, `updates` | `Updates` |

## 11. Lead Data Model

Subscriber records are stored in `data/leads.json`.

```json
{
  "id": "sha256-email-prefix",
  "email": "user@example.com",
  "name": "User Name",
  "role": "AI researcher",
  "channel": "email",
  "interests": ["AI Jobs", "Research Papers"],
  "frequency": "daily",
  "digestFormat": "html",
  "subscribed": true,
  "plan": "free-preview",
  "createdAt": "2026-07-28T...",
  "updatedAt": "2026-07-28T..."
}
```

The `id` is generated from a SHA-256 hash of the email and truncated to 18 characters. Re-submitting the same email updates the record while preserving `createdAt`.

## 12. Frontend Features

The frontend is composed of:

- `public/index.html`: main page markup
- `public/app.js`: dashboard state, rendering, filtering, chat, subscriptions, live updates
- `public/styles.css`: responsive visual design

### User-Facing Sections

- sticky top navigation
- hero panel with market pulse summary
- category snapshot cards
- intelligence mix controls
- live signal ticker
- audience value strip
- conversion explanation band
- feed metrics
- category filters
- latest dispatch spotlight
- searchable archive
- AI assistant console
- daily email subscription form

### Frontend State

`public/app.js` keeps a local `state` object:

```js
{
  items: [],
  query: "",
  category: "all",
  fit: "all",
  chat: [],
  suggestions: [],
  promptQueue: [],
  processingChat: false
}
```

### Refresh Behavior

- Initial load calls `GET /api/posts`.
- If no posts exist, a sample preview item is shown.
- The feed refreshes every 60 seconds.
- The manual refresh button also calls `GET /api/posts`.
- The live update button calls `POST /api/live-update`, then reloads posts after 5 seconds and 15 seconds.

## 13. n8n Integration

The stable publishing endpoint is:

```text
POST http://localhost:4173/api/posts/daily
```

For a remote n8n instance, `localhost` refers to the n8n server, not the Windows machine running this app. In production or staging, update the n8n HTTP Request node to use a public URL:

```text
https://your-domain.com/api/posts/daily
```

### HTTP Request Example

`AISignal_n8n-http-request-example.json` contains a ready mapping for an n8n HTTP Request node. It maps common n8n JSON fields into the app's normalized post schema.

### Workflow Files

| File | Description |
|---|---|
| `AISignal_n8n-real-opportunity-workflow.js` | Combined Code-node workflow using Remotive, Hacker News/Algolia, GitHub, DEV Community, Hugging Face, and arXiv. |
| `AISignal_n8n-real-opportunity-workflow-v2.js` | Parallel HTTP/normalize workflow using Remotive, Hacker News/Algolia, Semantic Scholar, GitHub, DEV Community, and Hugging Face. |
| `AISignal_n8n-real-opportunity-workflow-v3.js` | Current sequential workflow using Remotive, Hacker News/Algolia, OpenAlex, GitHub, DEV Community, and Hugging Face. |

### Free Market-Intelligence Sources

| Source | Commercial signal | Authentication | Workflow use |
|---|---|---|---|
| Remotive | Remote AI hiring demand | None | Jobs and skill demand |
| Hacker News via Algolia | Early products, tools, prompts, and founder discussion | None | Startup, product, prompt, and news signals |
| arXiv, Semantic Scholar, or OpenAlex | New methods and research direction | None for current read requests | Research opportunities |
| GitHub Search API | Open-source adoption and active product momentum | Optional; public requests work anonymously | AI Products scored with stars and recent activity |
| DEV/Forem | Rising developer questions and content demand | None for published article reads | News or Prompts scored with reactions |
| Hugging Face Hub | Trending model adoption and capability shifts | None for public model listing | AI Products or Image Prompts scored with downloads and likes |

The expanded workflows cap each source at five or six records and publish no more than 30 records per run. This remains below the web app's 50-post request limit. GitHub allows unauthenticated public-data requests but applies IP-based limits, so keep the default daily schedule or add a server-side GitHub token in n8n if execution frequency increases. Never place that token in frontend code.

### Workflow Triggers

The workflow scripts define three entry points:

- Manual Live Update
- Webapp Live Button
- Daily 7AM Update

The daily schedule uses cron:

```text
0 7 * * *
```

### Live Webhook Path

The live webhook path used by workflow scripts is:

```text
ai-opportunity-live-update
```

The app triggers the configured remote URL through:

```text
POST /api/live-update
```

## 14. Email Digest

The server builds a daily email digest from the top 24 feed items.

The digest groups posts in this order:

1. Jobs
2. Research
3. AI Products
4. Prompts
5. Image Prompts
6. News
7. Updates
8. Startup News

Each digest item includes:

- publisher or company
- location
- priority score
- title
- summary
- up to 4 tags
- source link when available

Use this endpoint for n8n email automation:

```text
GET /api/digest/daily
```

Use `html` as the email body in Gmail, SMTP, SendGrid, or another email node.

## 15. Chatbot Behavior

The chatbot is feed-grounded. The backend passes up to 15 compact feed items into the system prompt. Each compact item includes:

- title
- source
- category
- score
- date
- summary
- link
- tags

The chatbot is instructed to:

- answer using local feed context when relevant
- avoid inventing source facts
- format outputs for requested modes
- include source links for specific opportunities
- keep default answers concise

Output modes supported by the UI include:

- LinkedIn Post
- Newsletter Brief
- Client Report
- Prompt Pack
- Image Creative Brief
- Research Digest

## 16. Static And Dynamic Routes

| Route | Type | Served by |
|---|---|---|
| `/` | Static | `public/index.html` |
| `/styles.css` | Static | `public/styles.css` |
| `/app.js` | Static | `public/app.js` |
| `/post/<id>` | Dynamic | `renderPostPage()` in `server.js` |
| `/api/*` | API | `handleApi()` in `server.js` |

Static route fallback currently returns `index.html` when a file is not found. This supports client-like navigation but can also hide missing asset errors.

## 17. Security Notes

- The app has no user accounts or admin system.
- `WEBHOOK_TOKEN` should be set before exposing ingestion or lead export publicly.
- `GET /api/leads` requires `WEBHOOK_TOKEN`.
- Ingestion routes are unauthenticated when `WEBHOOK_TOKEN` is empty.
- Chat requests use the server-side `OPENROUTER_API_KEY`; the key is not exposed to the browser.
- Local JSON storage is not encrypted.
- Keep credential files such as `openrouter.txt` private.
- Add HTTPS and a reverse proxy before production use.

## 18. Data Quality Notes

Current `data/news.json` contains real-looking seed or captured records from OpenAlex, Hacker News/Algolia, and Remotive.

Observed issue: some OpenAlex records have future publication dates such as:

- 2030-01-01
- 2031-01-01
- 2045-12-10
- 2050-01-01

Because the server sorts by `publishedAt` descending, those records can appear ahead of genuinely current items. Consider validating or clamping future publication dates during n8n normalization or in `normalizeItem()`.

Some stored text contains mojibake, for example garbled punctuation or accented characters. This likely comes from source encoding or copied data. Consider normalizing text encoding during workflow processing.

## 19. Deployment Notes

Recommended production shape:

1. Run the Node app on a VPS.
2. Set environment variables through the process manager.
3. Put Nginx or another reverse proxy in front of the app.
4. Enable HTTPS.
5. Set `WEBHOOK_TOKEN`.
6. Update n8n publish URLs from `localhost` to the public domain.
7. Back up `data/news.json` and `data/leads.json`.

Example process start:

```powershell
$env:PORT="4173"
$env:WEBHOOK_TOKEN="change-me"
$env:OPENROUTER_API_KEY="your-openrouter-key"
$env:N8N_LIVE_WEBHOOK_URL="https://n8n.ailabworks.tech/webhook/ai-opportunity-live-update"
npm start
```

## 20. Testing Checklist

### Syntax Checks

These checks passed during this documentation review:

```powershell
node --check server.js
node --check public\app.js
```

### Manual Web App Checks

1. Start the app with `npm start`.
2. Open `http://localhost:4173`.
3. Confirm the feed renders.
4. Test search.
5. Test category chips.
6. Test priority filter.
7. Open a post detail page.
8. Submit a test subscriber email.
9. Open `http://localhost:4173/api/digest/daily.html`.
10. If `OPENROUTER_API_KEY` is configured, test the chatbot.
11. If `N8N_LIVE_WEBHOOK_URL` is configured, test the live update button.

### API Smoke Tests

Post one item:

```powershell
$body = @{
  id = "manual-test-2026-07-28"
  title = "Manual Test AI Signal"
  publisher = "Local Test"
  location = "Global"
  category = "News"
  fitScore = 88
  publishedAt = "2026-07-28T09:00:00+05:30"
  summary = "Smoke test item."
  content = "This item confirms the ingestion endpoint works."
  tags = @("Test", "AI")
  link = "https://example.com"
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri "http://localhost:4173/api/posts/daily" -ContentType "application/json" -Body $body
```

Read posts:

```powershell
Invoke-RestMethod "http://localhost:4173/api/posts"
```

Preview digest:

```powershell
Start-Process "http://localhost:4173/api/digest/daily.html"
```

## 21. Known Improvement Opportunities

- Add a real database when moving beyond local MVP usage.
- Add a proper authentication and admin layer.
- Add source-level validation for future dates and malformed text.
- Add server-side pagination if `data/news.json` grows large.
- Add automated endpoint tests.
- Add a health endpoint such as `GET /api/health`.
- Add rate limiting to public ingestion, live update, subscribe, and chat routes.
- Add unsubscribe and preference-management flows for email subscribers.
- Move duplicated category normalization into a shared source or generate the frontend map from backend data.
- Add structured logs for ingestion, live update, chat errors, and email digest generation.

## 22. File-Level Summary

### `server.js`

Main backend entrypoint. It creates an HTTP server, serves static assets, manages JSON storage, normalizes posts and leads, handles all API routes, renders post pages, builds digests, triggers live n8n updates, and calls OpenRouter for chat.

### `public/index.html`

Single-page dashboard shell. Defines sections for hero, market pulse, intelligence mix, ticker, metrics, filters, latest dispatch, archive, chat assistant, and subscription form.

### `public/app.js`

Client-side application logic. Fetches posts, maintains UI state, filters/searches items, renders cards and spotlight, handles subscription form submission, runs live update requests, manages chat prompt queue, and exports chat HTML.

### `public/styles.css`

Responsive visual design for the dashboard. Includes layout, color tokens, cards, forms, chat UI, responsive breakpoints, and reduced-motion handling.

### `data/news.json`

Local post storage. Ignored by Git according to `.gitignore`.

### `data/leads.json`

Local subscriber storage. Ignored by Git according to `.gitignore`.

### `AISignal_n8n-http-request-example.json`

Example n8n HTTP Request node configuration for posting items into the app.

### `AISignal_n8n-real-opportunity-workflow-v3.js`

Most recent workflow helper in the repo. Fetches Remotive jobs, Hacker News/Algolia signals, OpenAlex works, GitHub repository momentum, DEV Community audience trends, and Hugging Face model adoption, then builds normalized post objects for publishing.

### `public/assets/conference-template-a4.docx`

An unrelated or auxiliary Word template asset currently stored in the public assets folder. It is not referenced by the web app code found during this review.

## 23. Quick Operational Recipes

### Local Only

```powershell
npm start
```

Publish from local n8n:

```text
http://localhost:4173/api/posts/daily
```

### Remote n8n To Local Windows

Remote n8n cannot reach Windows `localhost`. Use a public tunnel or deploy the app to a public server.

### Protected Publishing

```powershell
$env:WEBHOOK_TOKEN="change-me"
npm start
```

Then configure n8n header:

```text
Authorization: Bearer change-me
```

### Enable Chat

```powershell
$env:OPENROUTER_API_KEY="your-openrouter-key"
$env:OPENROUTER_MODEL="qwen/qwen3.7-flash"
npm start
```

### Use Daily Digest In n8n

1. Add HTTP Request node.
2. Method: `GET`.
3. URL: `https://your-domain.com/api/digest/daily`.
4. Use returned `html` in the email body.
5. Use returned `subject` as the email subject.

## 24. Maintenance Guidance

- Treat `README.md` as the quick-start file.
- Treat this file as the detailed implementation and operations guide.
- Keep `data/news.json`, `data/leads.json`, `.env`, logs, and local key files out of version control.
- When changing the post schema, update `normalizeItem()`, the frontend render functions, n8n mappings, and this documentation together.
- When changing categories, update both `server.js` and `public/app.js`.
- Before deploying, run syntax checks and test the ingestion endpoint manually.
