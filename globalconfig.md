# Global VPS App Connector Config

Use this as a simple reusable template for any new VPS app that needs:

- OpenRouter API for AI chat
- A protected API/webhook for external automation
- An optional MCP server for ChatGPT, Claude, Cursor, Codex, or other MCP clients
- Optional public asset access

Do not put real secrets in this file. Keep real values in `.env`, the VPS provider environment panel, or a secret manager.

## Replace These Placeholders

| Placeholder | Meaning | Example |
|---|---|---|
| `<APP_NAME>` | Human-readable app name | My Dashboard |
| `<APP_SLUG>` | Lowercase Docker/project name | my-dashboard |
| `<APP_DOMAIN>` | Public HTTPS domain | app.example.com |
| `<APP_PUBLIC_URL>` | Full public URL | https://app.example.com |
| `<WEB_PORT>` | Web app port | 4173 |
| `<MCP_PORT>` | MCP server port | 4174 |
| `<MCP_SERVER_LABEL>` | MCP connector label | my-dashboard |

## Basic Production `.env`

```env
COMPOSE_PROJECT_NAME=<APP_SLUG>

NODE_ENV=production
PORT=<WEB_PORT>
WEB_PORT=<WEB_PORT>
APP_PUBLIC_URL=<APP_PUBLIC_URL>

WEBHOOK_TOKEN=<set-long-random-webhook-token>
ADMIN_USERNAME=<set-admin-username>
ADMIN_PASSWORD=<set-admin-password>

MCP_PORT=<MCP_PORT>
MCP_HOST=0.0.0.0
MCP_ALLOWED_HOSTS=<APP_DOMAIN>,<APP_DOMAIN>:443,<APP_DOMAIN>:<MCP_PORT>,localhost,127.0.0.1
MCP_TOKEN=<set-long-random-mcp-token>

OPENROUTER_API_KEY=<set-openrouter-api-key>
OPENROUTER_MODEL=qwen/qwen3.7-flash
OPENROUTER_SITE_URL=<APP_PUBLIC_URL>
OPENROUTER_SITE_NAME=<APP_NAME>

SMTP_HOST=<set-smtp-host>
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<set-smtp-username>
SMTP_PASS=<set-smtp-password>
SMTP_FROM=<set-from-email>
SMTP_REPLY_TO=<set-reply-to-email-or-empty>

LIVE_WEBHOOK_URL=<set-external-automation-webhook-url-or-empty>
LIVE_WEBHOOK_TOKEN=<set-external-automation-token-or-empty>

N8N_EMAIL_WEBHOOK_URL=<set-n8n-gmail-email-webhook-url-or-empty>
N8N_EMAIL_WEBHOOK_TOKEN=<set-n8n-email-token-or-empty>

MAX_BODY_BYTES=1048576
MAX_POSTS_PER_REQUEST=50
RATE_LIMIT_WINDOW_MS=900000
LIVE_UPDATE_TIMEOUT_MS=25000
```

## OpenRouter API Setup

OpenRouter is used server-side for AI chat. The browser should call your own backend endpoint, and your backend should call OpenRouter. Never expose `OPENROUTER_API_KEY` in frontend JavaScript.

| Item | Value |
|---|---|
| API endpoint | `https://openrouter.ai/api/v1/chat/completions` |
| Required key env | `OPENROUTER_API_KEY` |
| Model env | `OPENROUTER_MODEL` |
| Recommended low-cost model | `qwen/qwen3.7-flash` |
| Alternative low-cost model | `google/gemini-3.5-flash-lite` |
| Site URL header | `HTTP-Referer: <APP_PUBLIC_URL>` |
| Site name header | `X-OpenRouter-Title: <APP_NAME>` |

Server request example:

```http
POST https://openrouter.ai/api/v1/chat/completions
Authorization: Bearer <OPENROUTER_API_KEY>
Content-Type: application/json
HTTP-Referer: <APP_PUBLIC_URL>
X-OpenRouter-Title: <APP_NAME>
```

Example body:

```json
{
  "model": "qwen/qwen3.7-flash",
  "temperature": 0.3,
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant for this app. Answer using only the app data provided."
    },
    {
      "role": "user",
      "content": "Summarize today's top items."
    }
  ]
}
```

Minimal Node.js example:

```js
async function callOpenRouter(messages) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL || process.env.APP_PUBLIC_URL,
      "X-OpenRouter-Title": process.env.OPENROUTER_SITE_NAME || process.env.APP_NAME || "VPS App",
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || "qwen/qwen3.7-flash",
      temperature: 0.3,
      messages,
    }),
  });

  if (!response.ok) throw new Error(`OpenRouter failed: ${response.status}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}
```

## Protected Webhook/API Pattern

Use this pattern when an external automation tool needs to publish data into your app.

```http
POST <APP_PUBLIC_URL>/api/items/daily
Authorization: Bearer <WEBHOOK_TOKEN>
Content-Type: application/json
```

Recommended payload shape:

```json
{
  "items": [
    {
      "title": "Item title",
      "summary": "Short clean summary",
      "link": "https://source.example/item",
      "category": "News",
      "score": 88,
      "publishedAt": "2026-07-31T00:00:00.000Z",
      "tags": ["topic", "source"]
    }
  ]
}
```

## SMTP Email Setup

Use either an n8n Gmail webhook or SMTP for subscription welcome emails, admin test emails, and digest delivery.

Preferred n8n Gmail pattern:

```env
N8N_EMAIL_WEBHOOK_URL=https://n8n.example.com/webhook/<private-email-webhook-path>
N8N_EMAIL_WEBHOOK_TOKEN=<optional-shared-token>
```

The app posts this payload to n8n:

```json
{
  "to": "subscriber@example.com",
  "subject": "Email subject",
  "html": "<p>Email body</p>",
  "text": "Email body"
}
```

Fallback SMTP pattern:

| Env | Purpose |
|---|---|
| `SMTP_HOST` | SMTP server host |
| `SMTP_PORT` | Usually `587` for STARTTLS or `465` for SSL |
| `SMTP_SECURE` | `true` for port `465`, otherwise `false` |
| `SMTP_USER` | SMTP login username |
| `SMTP_PASS` | SMTP login password |
| `SMTP_FROM` | Sender address shown to recipients |
| `SMTP_REPLY_TO` | Optional reply-to address |

Example:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=mailer@example.com
SMTP_PASS=<smtp-password>
SMTP_FROM="App Name <mailer@example.com>"
SMTP_REPLY_TO=support@example.com
```

Backend should send email only from the server. Frontend should call your own API, such as:

```http
POST <APP_PUBLIC_URL>/api/admin/send-test-email
Authorization: Basic <admin-credentials>
Content-Type: application/json
```

## Optional Live Update Connector

Use this when your app has a button or scheduled job that triggers an external automation workflow.

```env
LIVE_WEBHOOK_URL=<external-workflow-url>
LIVE_WEBHOOK_TOKEN=<optional-shared-token>
```

Backend request pattern:

```http
POST <LIVE_WEBHOOK_URL>
Content-Type: application/json
x-live-update-token: <LIVE_WEBHOOK_TOKEN>
```

Expected workflow response:

```json
{
  "items": []
}
```

## MCP Connector Setup

Use MCP when you want ChatGPT, Claude, Cursor, Codex, or another client to access your app data and tools.

Remote MCP endpoint:

```text
<APP_PUBLIC_URL>/mcp
```

Direct VPS endpoint if no reverse proxy is configured:

```text
http://<VPS_HOST>:<MCP_PORT>/mcp
```

MCP auth header:

```http
Authorization: Bearer <MCP_TOKEN>
```

### ChatGPT / OpenAI Remote MCP Example

```json
{
  "type": "mcp",
  "server_label": "<MCP_SERVER_LABEL>",
  "server_url": "<APP_PUBLIC_URL>/mcp",
  "headers": {
    "Authorization": "Bearer <MCP_TOKEN>"
  },
  "require_approval": "never"
}
```

### Claude Desktop Local MCP Example

```json
{
  "mcpServers": {
    "<MCP_SERVER_LABEL>": {
      "command": "node",
      "args": ["<ABSOLUTE_PATH_TO_APP>/mcp-server.mjs"],
      "env": {
        "APP_PUBLIC_URL": "<APP_PUBLIC_URL>",
        "MCP_TOKEN": "<MCP_TOKEN>"
      }
    }
  }
}
```

## MCP Tool Ideas For Any App

| Tool | Purpose |
|---|---|
| `search_items` | Search app records by keyword, category, score, or date |
| `get_top_items` | Return the highest priority records |
| `get_daily_summary` | Return a compact daily summary |
| `list_sources` | Show where current data came from |
| `get_asset_manifest` | List available public assets |
| `get_asset` | Return metadata or base64 for one asset |
| `trigger_live_update` | Ask the app to refresh data through automation |

## MCP Resource Ideas For Any App

| Resource URI Pattern | Purpose |
|---|---|
| `<app>://feed` | Current app feed or records |
| `<app>://summary/daily` | Daily summary payload |
| `<app>://assets/manifest` | Public asset list |
| `<app>://config/public` | Non-secret public app config |

## Public Asset Access

If the app has static assets, expose them through the web server and optionally through MCP.

Public URL pattern:

```text
<APP_PUBLIC_URL>/assets/<file-name>
```

MCP asset access pattern:

```text
Resource: <app>://assets/manifest
Tool: get_asset_manifest
Tool: get_asset
```

Do not expose private files, `.env`, logs, uploads with personal data, or subscriber/user records as public assets.

## Generic REST Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/health` | GET | none | Health check |
| `/api/items` | GET | optional | Current app records |
| `/api/items/daily` | POST | `WEBHOOK_TOKEN` | Publish automation results |
| `/api/trends` | GET | optional | Trending topics, ranked items, category totals |
| `/api/chat` | POST | server-side OpenRouter key | AI chat grounded in app data |
| `/api/subscribe` | POST | none or app auth | User signup |
| `/api/admin/summary` | GET | admin auth | Admin dashboard data |
| `/api/live-update` | POST | rate-limited | Trigger external automation |

## Docker Compose Pattern

```yaml
name: <APP_SLUG>

services:
  web:
    build:
      context: .
    image: <APP_SLUG>:latest
    container_name: <APP_SLUG>-web
    restart: unless-stopped
    environment:
      NODE_ENV: production
      PORT: <WEB_PORT>
      WEBHOOK_TOKEN: ${WEBHOOK_TOKEN:?Set WEBHOOK_TOKEN}
      OPENROUTER_API_KEY: ${OPENROUTER_API_KEY:-}
      OPENROUTER_MODEL: ${OPENROUTER_MODEL:-qwen/qwen3.7-flash}
      OPENROUTER_SITE_URL: ${OPENROUTER_SITE_URL:-${APP_PUBLIC_URL}}
      OPENROUTER_SITE_NAME: ${OPENROUTER_SITE_NAME:-VPS App}
    ports:
      - "${WEB_PORT:-4173}:<WEB_PORT>"
    volumes:
      - ./data:/app/data

  mcp:
    image: <APP_SLUG>:latest
    container_name: <APP_SLUG>-mcp
    restart: unless-stopped
    command: ["node", "mcp-server.mjs", "--http"]
    environment:
      MCP_PORT: <MCP_PORT>
      MCP_HOST: 0.0.0.0
      MCP_ALLOWED_HOSTS: ${MCP_ALLOWED_HOSTS:-localhost,127.0.0.1}
      MCP_TOKEN: ${MCP_TOKEN:?Set MCP_TOKEN}
      APP_PUBLIC_URL: ${APP_PUBLIC_URL}
    ports:
      - "${MCP_PORT:-4174}:<MCP_PORT>"
    volumes:
      - ./data:/app/data:ro
```

## Reverse Proxy Pattern

```nginx
location / {
  proxy_pass http://127.0.0.1:<WEB_PORT>;
}

location /mcp {
  proxy_pass http://127.0.0.1:<MCP_PORT>/mcp;
}
```

Use HTTPS before connecting remote MCP clients.

## Secret Handling Rules

- Generate a different `WEBHOOK_TOKEN`, `MCP_TOKEN`, admin password, and API key for every app.
- Keep real secrets in `.env`, VPS environment variables, or a secret manager.
- Do not commit `.env`, API keys, private SSH keys, token files, logs, or user data.
- Never send OpenRouter requests directly from the browser.
- Rotate tokens after sharing any config with another app or team.
