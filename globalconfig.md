# AI SignalDesk Global Config

Reusable configuration reference for moving AI SignalDesk access patterns into another VPS app.

Do not store real secrets in this file. Keep actual values in the target VPS `.env`, secret manager, or connector credential store.

## App Identity

| Setting | Value |
|---|---|
| Product name | AI SignalDesk |
| Docker project name | ai-signaldesk |
| Web container | ai-signaldesk-web |
| MCP container | ai-signaldesk-mcp |
| Public app URL | https://signaldesk.ailabworks.tech |
| VPS project path | /docker/ai-signaldesk/docker-compose.yml |
| Hostinger VPS project | ai-signaldesk |
| Hostinger VM ID | 1800336 |

## Core Ports

| Service | Internal port | Default public port | Purpose |
|---|---:|---:|---|
| Web app/API | 4173 | 4173 | Dashboard, REST API, admin, paid beta |
| MCP HTTP server | 4174 | 4174 | Remote MCP connector endpoint |

## Production Environment Template

Use this as the base `.env` for another VPS app. Replace every placeholder with a secret generated for that app.

```env
COMPOSE_PROJECT_NAME=ai-signaldesk

NODE_ENV=production
PORT=4173
WEB_PORT=4173

AI_SIGNALDESK_PUBLIC_URL=https://signaldesk.ailabworks.tech

WEBHOOK_TOKEN=<set-long-random-webhook-token>
ADMIN_USERNAME=<set-admin-username>
ADMIN_PASSWORD=<set-admin-password>

MCP_PORT=4174
MCP_HOST=0.0.0.0
MCP_ALLOWED_HOSTS=signaldesk.ailabworks.tech,signaldesk.ailabworks.tech:443,signaldesk.ailabworks.tech:4174,localhost,127.0.0.1
MCP_TOKEN=<set-long-random-mcp-token>

OPENROUTER_API_KEY=<set-openrouter-api-key>
OPENROUTER_MODEL=qwen/qwen3.7-flash
OPENROUTER_SITE_URL=https://signaldesk.ailabworks.tech
OPENROUTER_SITE_NAME=AI SignalDesk

N8N_LIVE_WEBHOOK_URL=<set-agentic-ai-live-update-webhook-url>
N8N_LIVE_WEBHOOK_TOKEN=<set-agentic-ai-live-update-token-or-empty>

MAX_BODY_BYTES=1048576
MAX_POSTS_PER_REQUEST=50
FUTURE_DATE_TOLERANCE_DAYS=30
RATE_LIMIT_WINDOW_MS=900000
LIVE_UPDATE_TIMEOUT_MS=25000
```

## External API: OpenRouter Chat

| Item | Config |
|---|---|
| API endpoint | https://openrouter.ai/api/v1/chat/completions |
| Required env | `OPENROUTER_API_KEY` |
| Model env | `OPENROUTER_MODEL` |
| Current Docker default | `qwen/qwen3.7-flash` |
| Local app fallback default | `google/gemini-3.5-flash-lite` |
| Referer header | `HTTP-Referer: ${OPENROUTER_SITE_URL}` |
| Title header | `X-OpenRouter-Title: ${OPENROUTER_SITE_NAME}` |
| Browser exposure | Never expose the API key to frontend JavaScript |

Server-side request headers:

```http
Authorization: Bearer <OPENROUTER_API_KEY>
Content-Type: application/json
HTTP-Referer: <OPENROUTER_SITE_URL>
X-OpenRouter-Title: <OPENROUTER_SITE_NAME>
```

## Agentic AI Live Update Connector

The current code keeps legacy env names for compatibility, but public UI text should call this `agentic AI`.

| Item | Config |
|---|---|
| Trigger env | `N8N_LIVE_WEBHOOK_URL` |
| Optional auth env | `N8N_LIVE_WEBHOOK_TOKEN` |
| App trigger endpoint | `POST /api/live-update` |
| Outbound auth header | `x-live-update-token: <N8N_LIVE_WEBHOOK_TOKEN>` |
| Expected response | JSON array or `{ "items": [...] }` |
| Fallback behavior | App can pull direct public sources if the live workflow returns no posts |

Incoming item publication endpoint for external workflows:

```http
POST https://signaldesk.ailabworks.tech/api/posts/daily
Authorization: Bearer <WEBHOOK_TOKEN>
Content-Type: application/json
```

Accepted payload shapes:

```json
[
  {
    "title": "Signal title",
    "summary": "Short clean summary",
    "link": "https://source.example/item",
    "category": "Research",
    "fitScore": 88,
    "publishedAt": "2026-07-31T00:00:00.000Z",
    "tags": ["healthcare-ai", "paper"]
  }
]
```

```json
{
  "items": [
    {
      "title": "Signal title",
      "summary": "Short clean summary",
      "link": "https://source.example/item",
      "category": "AI Products"
    }
  ]
}
```

## MCP Connector

Remote MCP endpoint:

```text
https://signaldesk.ailabworks.tech/mcp
```

Direct container endpoint if no reverse proxy maps `/mcp`:

```text
http://<vps-host>:4174/mcp
```

Required MCP auth:

```http
Authorization: Bearer <MCP_TOKEN>
```

Recommended allowed hosts for this deployment:

```env
MCP_ALLOWED_HOSTS=signaldesk.ailabworks.tech,signaldesk.ailabworks.tech:443,signaldesk.ailabworks.tech:4174,localhost,127.0.0.1
```

### ChatGPT / OpenAI Connector Option

Use the remote MCP server URL after HTTPS and `/mcp` reverse proxy are active:

```json
{
  "type": "mcp",
  "server_label": "ai-signaldesk",
  "server_url": "https://signaldesk.ailabworks.tech/mcp",
  "headers": {
    "Authorization": "Bearer <MCP_TOKEN>"
  },
  "require_approval": "never"
}
```

If the client supports connector-level auth fields instead of raw headers, store `<MCP_TOKEN>` in that connector's secret/auth field.

### Claude Desktop / Local MCP Option

For a local stdio MCP client running from the app directory:

```json
{
  "mcpServers": {
    "ai-signaldesk": {
      "command": "node",
      "args": ["H:\\n8nDailyRashi\\mcp-server.mjs"],
      "env": {
        "AI_SIGNALDESK_PUBLIC_URL": "https://signaldesk.ailabworks.tech",
        "MCP_TOKEN": "<MCP_TOKEN>"
      }
    }
  }
}
```

For another VPS app, replace the `args` path with that app's absolute `mcp-server.mjs` path.

### MCP Resources

| Resource URI | Purpose |
|---|---|
| `ai-signaldesk://feed` | Current normalized opportunity feed |
| `ai-signaldesk://digest/daily` | Daily digest payload with subject, text, HTML, counts, and compact items |
| `ai-signaldesk://assets/manifest` | Public asset manifest with file paths and web URLs |

### MCP Tools

| Tool | Purpose |
|---|---|
| `search_signals` | Search feed by keyword, category, score, and limit |
| `get_top_opportunities` | Return highest-scoring current opportunities |
| `get_daily_digest` | Return digest as JSON, HTML, or text |
| `list_sources` | List configured source families and current feed domains |
| `get_asset_manifest` | List public assets by group |
| `get_asset` | Return metadata and optional base64 for one public asset |
| `get_email_subscribers` | Return subscriber records; requires token argument |
| `trigger_live_update` | Trigger app live update; requires token when configured |

## Asset Access

Public asset base URL:

```text
https://signaldesk.ailabworks.tech/assets/
```

Useful asset paths:

```text
/assets/categories/
/assets/states/
/assets/hero-ai-opportunity-radar.jpg
/assets/hero-ai-opportunity-radar-mobile.jpg
```

MCP asset access:

```text
Resource: ai-signaldesk://assets/manifest
Tool: get_asset_manifest
Tool: get_asset
```

For other VPS apps, prefer MCP asset URLs or public `/assets/...` URLs instead of copying binary files.

## REST API Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/health` | GET | none | Service health and configured feature flags |
| `/api/posts` | GET | none | Current feed |
| `/api/posts/daily` | POST | `WEBHOOK_TOKEN` when set | Publish workflow items |
| `/api/trends` | GET | none | Trending topics, ranked titles, category totals, weekly/monthly buckets |
| `/api/digest/daily` | GET | none | JSON daily digest |
| `/api/digest/daily.html` | GET | none | HTML daily digest |
| `/api/chat` | POST | server-side OpenRouter key | Feed-grounded AI chat |
| `/api/subscribe` | POST | none | Lead signup |
| `/api/admin/summary` | GET | Basic admin auth or webhook bearer | Subscriber/admin summary |
| `/api/admin/subscriber` | PATCH/DELETE | Basic admin auth or webhook bearer | Update/delete subscribers |
| `/api/admin/email-forward` | POST | Basic admin auth or webhook bearer | Record digest/email forward count |
| `/api/leads.csv` | GET | Basic admin auth | CSV export |
| `/api/live-update` | POST | rate-limited | Trigger agentic AI live update |

## Source Families Used By Feed Workflows

These are source families represented by the bundled workflow/MCP source list. Individual live sources may vary by workflow version.

```text
Remotive
Hacker News / Algolia
OpenAlex
GitHub
DEV Community
Hugging Face
Semantic Scholar
arXiv
```

## Docker Compose Service Pattern

```yaml
name: ai-signaldesk

services:
  web:
    image: ai-signaldesk:latest
    container_name: ai-signaldesk-web
    restart: unless-stopped
    ports:
      - "${WEB_PORT:-4173}:4173"
    volumes:
      - ./data:/app/data

  mcp:
    image: ai-signaldesk:latest
    container_name: ai-signaldesk-mcp
    restart: unless-stopped
    command: ["node", "mcp-server.mjs", "--http"]
    ports:
      - "${MCP_PORT:-4174}:4174"
    volumes:
      - ./data:/app/data:ro
```

## Reverse Proxy Notes

For a public connector, route:

```nginx
location / {
  proxy_pass http://127.0.0.1:4173;
}

location /mcp {
  proxy_pass http://127.0.0.1:4174/mcp;
}
```

Use HTTPS before connecting remote MCP clients.

## Secret Handling Rules

- Generate different `WEBHOOK_TOKEN`, `MCP_TOKEN`, and admin password for every VPS app.
- Store real secrets only in `.env`, Hostinger project environment, or a proper secret manager.
- Do not commit `.env`, API keys, private SSH keys, `openrouter.txt`, or live subscriber data.
- Rotate tokens after sharing config files with another app/team.
- Public frontend may call `/api/chat`, but only the server may call OpenRouter.
