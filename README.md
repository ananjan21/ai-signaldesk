# AI SignalDesk

A local-first SaaS MVP that receives daily AI opportunity briefs from n8n and publishes them as a searchable website.

The site can publish and score:

- AI/ML jobs and research positions
- research papers and summaries
- grants, funding calls, and startup news
- AI tools and workflow updates
- curated opportunities with fit scores and tags

It also captures free-preview signups locally in `data/leads.json`, so the same user profiles can later power email, Telegram, or WhatsApp digests from n8n.

## Run

```powershell
npm start
```

Open:

```text
http://localhost:4173
```

## Docker / VPS

Docker Compose project name:

```text
ai-signaldesk
```

Product/display name:

```text
AI SignalDesk
```

Production Docker setup is included:

```powershell
Copy-Item .env.production.example .env
docker compose up -d --build
```

For Hostinger VPS, DNS, Nginx, HTTPS, n8n URL updates, and MCP deployment details, see `HOSTINGER_DEPLOYMENT.md`.

## Local MVP

Use an HTTP Request node after your daily trigger and content-generation steps.

- Method: `POST`
- URL: `http://localhost:4173/api/posts/daily`
- Body Content Type: JSON
- Body: use the mapping in `AISignal_n8n-http-request-example.json`

The endpoint is stable. Changing the n8n trigger schedule, sources, search terms, or AI prompt will change what appears on the site, but the website integration remains the same as long as the workflow posts JSON to `/api/posts/daily`.

The bundled `AISignal_` workflows use free public read endpoints from Remotive, Hacker News/Algolia, OpenAlex or Semantic Scholar/arXiv, GitHub, DEV Community, and Hugging Face. The added sources provide hiring demand, open-source momentum, developer-content demand, and trending-model adoption signals without requiring paid API plans. Anonymous GitHub requests are rate limited, so the default once-daily schedule is recommended unless a server-side GitHub token is configured in n8n.

Each post gets a page:

```text
http://localhost:4173/post/<id>
```

## Payload Fields

```json
{
  "id": "daily-ai-brief-2026-07-27",
  "title": "Daily AI Brief",
  "publisher": "Curated by n8n",
  "location": "Global",
  "category": "Research",
  "fitScore": 88,
  "publishedAt": "2026-07-27T08:00:00+05:30",
  "summary": "Short homepage summary.",
  "content": "Full article text for the post page.",
  "tags": ["LLM", "Jobs", "Startups"],
  "imageUrl": "https://example.com/cover.jpg",
  "link": "https://example.com/source"
}
```

Accepted category aliases include `news`, `updates`, `jobs`, `research`, `paper`, `startup`, `startups`, and `funding`.

## Optional Token

```powershell
$env:WEBHOOK_TOKEN="change-me"; npm start
```

Then add either header in n8n:

- `Authorization: Bearer change-me`
- `x-webhook-token: change-me`

The bundled workflows reference an n8n **Header Auth** credential named `AI SignalDesk Webhook`. Configure that credential with header name `Authorization` and value `Bearer <the same WEBHOOK_TOKEN>`. The secret stays in n8n credential storage and is not embedded in workflow code.

Set `WEBHOOK_TOKEN` before exposing the app to the internet. It protects lead export, feed deletion, and any ingestion request when configured.

## Health, Analytics, and Exports

Health check:

```text
GET /api/health
```

Subscriber JSON export, protected by `WEBHOOK_TOKEN`:

```text
GET /api/leads
Authorization: Bearer change-me
```

Subscriber CSV export, protected by `WEBHOOK_TOKEN`:

```text
GET /api/leads.csv
Authorization: Bearer change-me
```

Local product analytics are saved to:

```text
data/analytics.json
```

The frontend tracks page loads, category filters, post views, and paid-beta interest clicks. Keep this local analytics file private.

## AI Chatbot

The homepage includes an AI chatbot that answers questions using the current local opportunity feed as context.

Set your OpenRouter key before starting the app:

```powershell
$env:OPENROUTER_API_KEY="your-openrouter-key"
$env:OPENROUTER_MODEL="qwen/qwen3.7-flash"
npm start
```

`OPENROUTER_MODEL` is optional. The default is `qwen/qwen3.7-flash` for low-cost feed-grounded chat. Other good low-cost options are `google/gemini-3.5-flash-lite` and `meituan/longcat-2.0`. The app uses OpenRouter's OpenAI-compatible chat completions endpoint.

## Daily Email Subscription

The homepage subscribe form posts to:

```text
POST /api/subscribe
```

It stores subscribers in:

```text
data/leads.json
```

Each subscriber is saved with `subscribed: true`, `frequency: daily`, and `digestFormat: html`.

The formatted email digest is available at:

```text
GET /api/digest/daily.html
```

n8n automation can use the JSON version:

```text
GET /api/digest/daily
```

That returns `subject`, `preheader`, `html`, `text`, `counts`, and top feed `items`. Use the `html` field as the email body in a Gmail, SMTP, or SendGrid node.

When `WEBHOOK_TOKEN` is set, leads can be exported for an n8n digest workflow with:

```text
GET /api/leads
Authorization: Bearer change-me
```

## MCP Connector

AI SignalDesk includes a Model Context Protocol server so ChatGPT, Claude Desktop, Claude Code, Cursor, Codex, and other MCP clients can inspect the feed, digest, sources, subscribers, and visual assets.

Local stdio mode:

```powershell
npm run mcp
```

Claude Desktop-style config:

```json
{
  "mcpServers": {
    "ai-signaldesk": {
      "command": "node",
      "args": ["H:\\n8nDailyRashi\\mcp-server.mjs"],
      "env": {
        "AI_SIGNALDESK_PUBLIC_URL": "http://localhost:4173",
        "MCP_TOKEN": "change-me"
      }
    }
  }
}
```

Remote HTTP mode:

```powershell
$env:MCP_PORT="4174"
$env:AI_SIGNALDESK_PUBLIC_URL="https://your-domain.com"
$env:MCP_TOKEN="change-me"
npm run mcp:http
```

The remote MCP endpoint is:

```text
http://localhost:4174/mcp
```

After deployment, use the public HTTPS URL in OpenAI Responses API as a remote MCP `server_url`.

Available MCP tools:

- `search_signals` - search opportunities by query, category, score, and limit
- `get_top_opportunities` - return highest-priority items
- `get_daily_digest` - return digest as JSON, HTML, or text
- `list_sources` - list workflow sources and current feed domains
- `get_asset_manifest` - list category covers, state art, hero images, and document templates
- `get_asset` - return one asset's path, URL, metadata, and optional base64
- `get_email_subscribers` - protected subscriber export
- `trigger_live_update` - calls the web app live-update endpoint

Readable MCP resources:

- `ai-signaldesk://feed`
- `ai-signaldesk://digest/daily`
- `ai-signaldesk://assets/manifest`

## Suggested Testing Flow

1. Run the webapp locally with `npm start`.
2. Open `http://localhost:4173`.
3. Test search, filters, post detail pages, and preview signup.
4. Send a test item from n8n to `http://localhost:4173/api/posts/daily`.
5. Check `GET /api/health`.
6. Preview the digest at `GET /api/digest/daily.html`.
7. Export leads with `GET /api/leads.csv` after setting `WEBHOOK_TOKEN`.
8. After 3-7 days of clean local/staging data, deploy to VPS behind Nginx and HTTPS.

## Real Data Workflow

Created in n8n:

```text
AI Research Opportunity Desk - Real Data v3
https://n8n.ailabworks.tech/workflow/fjqZnw4JVSWBNgi5
```

It collects real data from:

- Remotive remote AI/ML jobs
- Hacker News / Algolia AI agent and startup/tool signals
- OpenAlex recent AI research works

It runs at:

```text
7:00 AM daily
```

It also exposes a live webhook path:

```text
https://n8n.ailabworks.tech/webhook/ai-opportunity-live-update
```

For the homepage **Live update** button, set:

```powershell
$env:N8N_LIVE_WEBHOOK_URL="https://n8n.ailabworks.tech/webhook/ai-opportunity-live-update"
npm start
```

Because this n8n instance is remote, it cannot post to your Windows `localhost`. For full live publishing, update the workflow node **Publish to Opportunity Desk** from:

```text
http://localhost:4173/api/posts/daily
```

to your public staging/VPS URL:

```text
https://your-domain.com/api/posts/daily
```
