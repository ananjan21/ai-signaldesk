# AI SignalDesk Hostinger VPS Deployment

Docker display name: **AI SignalDesk**

Docker Compose project name:

```text
ai-signaldesk
```

Docker project names should stay lowercase and hyphenated. Use **AI SignalDesk** as the public/product name and `ai-signaldesk` as the Docker project name.

## What Runs

- `ai-signaldesk-web` serves the dashboard and API on port `4173`.
- `ai-signaldesk-mcp` serves HTTP MCP on port `4174`.
- Both containers use the same `./data` folder.
- `data/news.json`, `data/leads.json`, and `data/analytics.json` persist on the VPS.

## VPS Setup

Install Docker and Compose if the VPS image does not already include them:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

Log out and back in after adding your user to the Docker group.

## Upload Or Clone

Put this project on the VPS, for example:

```bash
cd /opt
sudo mkdir -p ai-signaldesk
sudo chown "$USER:$USER" ai-signaldesk
cd ai-signaldesk
```

Then upload the project files or clone your GitHub repo into this folder.

## Configure Environment

```bash
cp .env.production.example .env
nano .env
```

Set:

- `WEBHOOK_TOKEN`
- `MCP_TOKEN`
- `MCP_ALLOWED_HOSTS` with your domain/IP values, for example `your-domain.com,your-domain.com:443,your-domain.com:4174`
- `AI_SIGNALDESK_PUBLIC_URL`
- `OPENROUTER_API_KEY`, if using chatbot
- `N8N_LIVE_WEBHOOK_URL`, if using live update

## Start

```bash
docker compose up -d --build
docker compose ps
```

Health checks:

```bash
curl http://127.0.0.1:4173/api/health
curl http://127.0.0.1:4173/api/digest/daily
curl -X POST http://127.0.0.1:4174/mcp \
  -H "Authorization: Bearer <MCP_TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1.0.0"}}}'
```

The MCP endpoint expects POST requests from MCP clients:

```text
https://your-domain.com/mcp
```

## Nginx Reverse Proxy

Install Nginx and Certbot:

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Example Nginx site:

```nginx
server {
    server_name your-domain.com;

    client_max_body_size 5m;

    location /mcp {
        proxy_pass http://127.0.0.1:4174/mcp;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
    }

    location / {
        proxy_pass http://127.0.0.1:4173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable HTTPS:

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d your-domain.com
```

## DNS

Point your domain DNS to the VPS public IP:

```text
A     @     <VPS IPv4>
CNAME www   your-domain.com
```

## n8n Changes

In the n8n workflow, update the publish node URL:

```text
https://your-domain.com/api/posts/daily
```

Add header auth:

```text
Authorization: Bearer <WEBHOOK_TOKEN>
```

For email sending, n8n should read:

```text
https://your-domain.com/api/digest/daily
https://your-domain.com/api/leads
```

Use the same `Authorization: Bearer <WEBHOOK_TOKEN>` header for `/api/leads`.

## ChatGPT / OpenAI Remote MCP

After HTTPS is live, use this as the remote MCP server URL:

```text
https://your-domain.com/mcp
```

Recommended allowed tools:

```text
search_signals
get_top_opportunities
get_daily_digest
list_sources
get_asset_manifest
get_asset
```

Keep protected tools approval-gated:

```text
get_email_subscribers
trigger_live_update
```

## Claude Desktop Local MCP

For local testing before VPS deployment:

```json
{
  "mcpServers": {
    "ai-signaldesk": {
      "command": "node",
      "args": ["H:\\n8nDailyRashi\\mcp-server.mjs"],
      "env": {
        "AI_SIGNALDESK_PUBLIC_URL": "http://localhost:4173",
        "MCP_TOKEN": "replace-with-token"
      }
    }
  }
}
```

## Updates

```bash
docker compose down
docker compose up -d --build
docker image prune -f
```
