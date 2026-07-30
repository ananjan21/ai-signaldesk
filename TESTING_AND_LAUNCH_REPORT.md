# AI SignalDesk Testing And Launch Report

Last updated: 2026-07-28

## Recommended Testing Outcome

Use the current phase to validate that users want a daily AI opportunity digest before adding heavy production features such as Stripe, user accounts, admin dashboards, or a database migration.

## Product Focus

Primary target for the current test:

- AI job seekers, early-career researchers, and builders who want a daily ranked brief of jobs, research, AI products, prompts, and useful market signals.

Validation question:

- Will visitors subscribe and show paid-beta interest for a source-backed daily AI opportunity digest?

Main conversion action:

- Subscribe to the daily email.

Secondary validation action:

- Click "Join paid beta waitlist" and submit the form with the Paid Beta interest selected.

## What Was Added For Testing

| Area | Added |
|---|---|
| Health | `GET /api/health` reports service status, uptime, config flags, and counts. |
| Environment | `.env.example` documents safe environment setup without real secrets. |
| Security | Shared token checks, body-size limit, protected destructive feed deletion, protected exports. |
| Rate limits | In-memory limits for subscribe, chat, live update, analytics, and webhook publishing. |
| Validation | Post title/content/date/URL validation; lead email/channel/frequency/digest validation. |
| Data quality | Future `publishedAt` values beyond tolerance are replaced with current time and flagged. |
| Analytics | Local `data/analytics.json` captures page, category, post, chat, live update, subscribe, and beta events. |
| Export | `GET /api/leads.csv` exports subscribers for email workflows. |
| Product testing | Paid beta CTA added to measure willingness-to-pay intent. |
| n8n quality | v3 workflow helper now classifies HN signals and clamps impossible future publication dates. |

## Required Local QA

Run the app:

```powershell
npm start
```

Open:

```text
http://localhost:4173
```

Manual checks:

- Homepage loads without console errors.
- Feed renders from `data/news.json`.
- Empty feed shows the sample preview state.
- Category filter works.
- Search works.
- Priority filter works.
- Latest Dispatch opens a post page.
- Post source links open in a new tab.
- Email signup accepts a valid email.
- Email signup rejects an invalid email.
- Paid beta button scrolls to the form and selects Paid Beta interest.
- Digest preview opens at `/api/digest/daily.html`.
- Chat shows a useful setup error when `OPENROUTER_API_KEY` is missing.
- Chat replies when `OPENROUTER_API_KEY` is configured.
- Live update shows setup/failure clearly when n8n is unavailable.

## API Smoke Tests

Health:

```powershell
Invoke-RestMethod "http://localhost:4173/api/health"
```

Post ingestion:

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

Invalid post rejection:

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:4173/api/posts/daily" -ContentType "application/json" -Body '{"title":"","summary":"","link":"not-a-url"}'
```

Lead signup:

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:4173/api/subscribe" -ContentType "application/json" -Body '{"email":"test@example.com","interests":["AI Jobs","Paid Beta"]}'
```

Digest:

```powershell
Invoke-RestMethod "http://localhost:4173/api/digest/daily"
```

Protected lead export:

```powershell
Invoke-RestMethod "http://localhost:4173/api/leads.csv" -Headers @{ Authorization = "Bearer change-me" }
```

## Security Checklist Before VPS

- Set `WEBHOOK_TOKEN` to a long random value.
- Set `OPENROUTER_API_KEY` only on the server.
- Do not commit `.env`, `openrouter.txt`, `data/news.json`, `data/leads.json`, or `data/analytics.json`.
- Put the app behind HTTPS.
- Restrict server firewall ports to SSH, HTTP, and HTTPS.
- Back up the `data/` directory daily.
- Review logs for repeated 401, 413, 422, and 429 responses.
- Add an unsubscribe flow before sending real marketing email at scale.

## VPS Deployment Outline

1. Copy the project to the VPS.
2. Install Node.js 18 or newer.
3. Configure environment variables from `.env.example`.
4. Run the app with a process manager such as PM2 or systemd.
5. Put Nginx in front of the app.
6. Add HTTPS with Certbot.
7. Update n8n publish URL to:

```text
https://your-domain.com/api/posts/daily
```

8. Add the webhook token header in n8n:

```text
Authorization: Bearer <WEBHOOK_TOKEN>
```

## Backup Plan

Until the app moves to SQLite or Postgres, back up:

- `data/news.json`
- `data/leads.json`
- `data/analytics.json`

Suggested daily backup target:

```text
backups/YYYY-MM-DD-data.zip
```

Keep at least 14 daily backups.

## Known Risks

| Risk | Impact | Mitigation |
|---|---|---|
| JSON storage | Can corrupt or become slow as data grows. | Move to SQLite before paid launch. |
| No user accounts | Cannot personalize securely yet. | Add auth before paid personalization. |
| Local-only analytics | Useful for MVP, weak for scale. | Move to PostHog/Plausible or database events later. |
| No unsubscribe route | Not ready for broad email marketing. | Add unsubscribe token before production email campaigns. |
| Remote n8n cannot post to localhost | Live production publishing fails from remote n8n. | Deploy publicly or use a tunnel during testing. |

## Next Build Phase

1. Run local QA for 3-7 days.
2. Fix any real data-quality problems from n8n runs.
3. Move storage from JSON to SQLite.
4. Add admin dashboard and source controls.
5. Add authentication.
6. Add Stripe only after paid-beta interest is proven.

## n8n Market Workflow Test - 2026-07-29

| Test | Result | Evidence |
|---|---|---|
| Local workflow syntax | PASS | v1, v2, and v3 pass `node --check`. |
| n8n Workflow SDK validation | PASS | v1: 7 nodes, v2: 19 nodes, v3: 13 nodes. |
| Free-source response shapes | PASS WITH CONDITIONS | Remotive, GitHub, DEV Community, Hugging Face, arXiv, and OpenAlex returned usable data. Semantic Scholar returned HTTP 429 during one anonymous request. |
| Remote n8n execution | PASS | Execution `263` completed successfully. The production pull webhook returned 36 normalized records. |
| Webhook authorization | PASS | Missing token returned 401. |
| Post validation | PASS | Malformed post returned 422. |
| Valid publish and feed read | PASS | Authenticated test post returned 201 and appeared in `/api/news`. Test data and analytics were restored afterward. |
| Homepage HTTP smoke test | PASS | `/` returned 200 with the application title and feed container. |

V2 and v3 source requests now retry up to three times and continue with the remaining sources after a source-specific failure. Publishing still fails normally when the webapp cannot save data.

All three local workflows now use the n8n Header Auth credential `AI SignalDesk Webhook` for publishing. Configure it as `Authorization: Bearer <WEBHOOK_TOKEN>` before running an imported workflow against a protected webapp.

The active remote workflow tested above is the earlier three-source pull workflow. The expanded six-source local workflows must be imported or used to update the remote n8n workflow before their complete graph can be executed remotely.
