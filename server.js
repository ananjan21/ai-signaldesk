const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 4173);
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || "";
const N8N_LIVE_WEBHOOK_URL =
  process.env.N8N_LIVE_WEBHOOK_URL || "https://n8n.ailabworks.tech/webhook/ai-opportunity-real-data-pull-v2";
const N8N_LIVE_WEBHOOK_TOKEN = process.env.N8N_LIVE_WEBHOOK_TOKEN || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "google/gemini-3.5-flash-lite";
const OPENROUTER_SITE_URL = process.env.OPENROUTER_SITE_URL || `http://localhost:${PORT}`;
const OPENROUTER_SITE_NAME = process.env.OPENROUTER_SITE_NAME || "AI SignalDesk";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "news.json");
const LEADS_FILE = path.join(DATA_DIR, "leads.json");
const ANALYTICS_FILE = path.join(DATA_DIR, "analytics.json");
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 1024 * 1024);
const MAX_POSTS_PER_REQUEST = Number(process.env.MAX_POSTS_PER_REQUEST || 50);
const FUTURE_DATE_TOLERANCE_DAYS = Number(process.env.FUTURE_DATE_TOLERANCE_DAYS || 30);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const LIVE_UPDATE_TIMEOUT_MS = Number(process.env.LIVE_UPDATE_TIMEOUT_MS || 25 * 1000);

const rateLimitBuckets = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml; charset=utf-8",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function json(res, status, data) {
  send(res, status, JSON.stringify(data, null, 2), {
    "Content-Type": "application/json; charset=utf-8",
  });
}

function logInfo(message, meta = {}) {
  console.log(JSON.stringify({ level: "info", message, ...meta, at: new Date().toISOString() }));
}

function logError(message, error, meta = {}) {
  console.error(
    JSON.stringify({
      level: "error",
      message,
      error: error?.message || String(error),
      ...meta,
      at: new Date().toISOString(),
    }),
  );
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function isAuthorized(req) {
  if (!WEBHOOK_TOKEN) return false;
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.headers["x-webhook-token"];
  return token === WEBHOOK_TOKEN;
}

function requireWebhookToken(req, res) {
  if (!WEBHOOK_TOKEN) {
    return {
      ok: false,
      handled: true,
      response: json(res, 403, {
        ok: false,
        error: "This action requires WEBHOOK_TOKEN to be configured on the server.",
      }),
    };
  }
  if (!isAuthorized(req)) {
    return {
      ok: false,
      handled: true,
      response: json(res, 401, { ok: false, error: "Unauthorized" }),
    };
  }
  return { ok: true, handled: false };
}

function checkRateLimit(req, res, name, maxRequests) {
  const now = Date.now();
  const key = `${name}:${clientIp(req)}`;
  const bucket = rateLimitBuckets.get(key) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }

  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);

  if (bucket.count > maxRequests) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    send(
      res,
      429,
      JSON.stringify({ ok: false, error: "Too many requests. Try again later.", retryAfter }, null, 2),
      {
        "Content-Type": "application/json; charset=utf-8",
        "Retry-After": String(retryAfter),
      },
    );
    return false;
  }

  return true;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function slugify(value) {
  const slug = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || crypto.randomUUID();
}

function canonicalCategory(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const aliases = {
    job: "Jobs",
    jobs: "Jobs",
    career: "Jobs",
    careers: "Jobs",
    research: "Research",
    paper: "Research",
    papers: "Research",
    startup: "Startup News",
    startups: "Startup News",
    "startup news": "Startup News",
    funding: "Startup News",
    product: "AI Products",
    products: "AI Products",
    "ai product": "AI Products",
    "ai products": "AI Products",
    tool: "AI Products",
    tools: "AI Products",
    prompt: "Prompts",
    prompts: "Prompts",
    prompting: "Prompts",
    "prompt engineering": "Prompts",
    image: "Image Prompts",
    images: "Image Prompts",
    "image prompt": "Image Prompts",
    "image prompts": "Image Prompts",
    "visual prompt": "Image Prompts",
    "visual prompts": "Image Prompts",
    "image generation": "Image Prompts",
    "visual marketing": "Image Prompts",
    news: "News",
    update: "Updates",
    updates: "Updates",
  };
  return aliases[normalized] || String(value || "News").trim() || "News";
}

async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  for (const file of [DATA_FILE, LEADS_FILE, ANALYTICS_FILE]) {
    try {
      await fs.access(file);
    } catch {
      await fs.writeFile(file, "[]\n", "utf8");
    }
  }
}

async function readJsonArray(file, label) {
  await ensureStore();
  const raw = await fs.readFile(file, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw || "[]");
  } catch (error) {
    logError(`${label} JSON is invalid`, error, { file });
    throw new Error(`${label} storage is invalid JSON.`);
  }
  return Array.isArray(parsed) ? parsed : [];
}

async function readItems() {
  const items = await readJsonArray(DATA_FILE, "Post");
  return items.map(sanitizeStoredItem);
}

async function writeItems(items) {
  await ensureStore();
  await fs.writeFile(DATA_FILE, `${JSON.stringify(items, null, 2)}\n`, "utf8");
}

async function readLeads() {
  return readJsonArray(LEADS_FILE, "Lead");
}

async function writeLeads(leads) {
  await ensureStore();
  await fs.writeFile(LEADS_FILE, `${JSON.stringify(leads, null, 2)}\n`, "utf8");
}

async function readAnalytics() {
  return readJsonArray(ANALYTICS_FILE, "Analytics");
}

async function appendAnalytics(event) {
  const events = await readAnalytics();
  events.unshift(event);
  await fs.writeFile(ANALYTICS_FILE, `${JSON.stringify(events.slice(0, 5000), null, 2)}\n`, "utf8");
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const params = new URLSearchParams(raw);
    return Object.fromEntries(params.entries());
  }
}

function normalizeArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === "string") {
    return value
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function firstValue(source, keys, fallback = "") {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") {
      return source[key];
    }
  }
  return fallback;
}

function cleanText(value, maxLength = 4000) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

function validHttpUrl(value, allowEmpty = true) {
  const text = String(value || "").trim();
  if (!text) return allowEmpty;
  try {
    const parsed = new URL(text);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizePublishedAt(value, warnings) {
  const date = new Date(value || new Date().toISOString());
  if (Number.isNaN(date.getTime())) {
    warnings.push("Invalid publishedAt was replaced with the current time.");
    return new Date().toISOString();
  }

  const maxFuture = Date.now() + FUTURE_DATE_TOLERANCE_DAYS * 24 * 60 * 60 * 1000;
  if (date.getTime() > maxFuture) {
    warnings.push("Future publishedAt was replaced with the current time.");
    return new Date().toISOString();
  }

  return date.toISOString();
}

function normalizeItem(input) {
  const source = input.json && typeof input.json === "object" ? input.json : input;
  const warnings = [];
  const title = cleanText(firstValue(source, ["title", "headline", "jobTitle", "position"], ""), 180);
  const company = cleanText(
    firstValue(source, ["company", "organization", "employer", "source", "publisher"], "Curated by n8n"),
    140,
  );
  const link = cleanText(firstValue(source, ["link", "url", "applyUrl", "sourceUrl"], ""), 900);
  const summary = cleanText(firstValue(source, ["summary", "description", "snippet", "excerpt"], ""), 1200);
  const content = cleanText(firstValue(source, ["content", "body", "article", "fullText"], summary), 12000);
  const location = cleanText(firstValue(source, ["location", "place", "region"], "Remote / Global"), 140);
  const publishedAt = normalizePublishedAt(
    firstValue(source, ["publishedAt", "postedAt", "date", "createdAt"], new Date().toISOString()),
    warnings,
  );
  const category = canonicalCategory(firstValue(source, ["category", "type", "track", "section"], "News"));
  const fitScore = Math.max(0, Math.min(100, Number(firstValue(source, ["fitScore", "score", "match"], 0)) || 0));
  const tags = normalizeArray(firstValue(source, ["tags", "keywords", "skills"], [])).slice(0, 12).map((tag) => cleanText(tag, 40));
  const imageUrl = cleanText(firstValue(source, ["imageUrl", "image", "thumbnail", "coverImage"], ""), 900);
  const id = cleanText(firstValue(source, ["id", "slug"], slugify(`${publishedAt}-${title}`)), 160);

  return {
    id,
    title,
    company,
    link,
    summary,
    content,
    location,
    publishedAt,
    category,
    fitScore,
    tags,
    imageUrl,
    receivedAt: new Date().toISOString(),
    ...(warnings.length ? { dataQualityWarnings: warnings } : {}),
  };
}

function validateItem(item) {
  const errors = [];
  if (!item.id || item.id.length < 3) errors.push("id is required.");
  if (!item.title || item.title.length < 3) errors.push("title is required.");
  if (!item.summary && !item.content) errors.push("summary or content is required.");
  if (!validHttpUrl(item.link)) errors.push("link must be a valid http or https URL.");
  if (!validHttpUrl(item.imageUrl)) errors.push("imageUrl must be a valid http or https URL.");
  if (Number.isNaN(new Date(item.publishedAt).getTime())) errors.push("publishedAt must be a valid date.");
  return errors;
}

async function fetchJson(url, timeoutMs = LIVE_UPDATE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "AI-SignalDesk/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function scoreFor(category, index) {
  const base = {
    Jobs: 88,
    Research: 84,
    "AI Products": 82,
    News: 76,
    Updates: 74,
  }[category] || 72;
  return Math.max(55, base - index * 2);
}

async function fetchFallbackLiveSignals() {
  const tasks = [
    async () => {
      const data = await fetchJson("https://remotive.com/api/remote-jobs?search=artificial%20intelligence&limit=10");
      return (data.jobs || []).slice(0, 8).map((job, index) => ({
        id: `remotive-${job.id}`,
        title: job.title,
        company: job.company_name || "Remotive",
        link: job.url,
        summary: cleanText(job.description || "", 420),
        content: cleanText(job.description || "", 1600),
        location: job.candidate_required_location || "Remote / Global",
        publishedAt: job.publication_date || new Date().toISOString(),
        category: "Jobs",
        fitScore: scoreFor("Jobs", index),
        tags: ["remote", "ai", ...(job.tags || []).slice(0, 5)],
      }));
    },
    async () => {
      const data = await fetchJson("https://hn.algolia.com/api/v1/search_by_date?query=artificial%20intelligence&tags=story");
      return (data.hits || []).slice(0, 8).map((story, index) => ({
        id: `hn-${story.objectID}`,
        title: story.title || story.story_title,
        company: "Hacker News",
        link: story.url || `https://news.ycombinator.com/item?id=${story.objectID}`,
        summary: `${story.points || 0} HN points and ${story.num_comments || 0} comments on an AI-related story.`,
        content: story.title || story.story_title,
        location: "Global",
        publishedAt: story.created_at || new Date().toISOString(),
        category: "News",
        fitScore: scoreFor("News", index),
        tags: ["hacker-news", "ai", "developer-signal"],
      }));
    },
    async () => {
      const data = await fetchJson(
        "https://api.openalex.org/works?search=artificial%20intelligence&sort=publication_date:desc&per-page=8",
      );
      return (data.results || []).slice(0, 8).map((work, index) => ({
        id: `openalex-${work.id}`.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 140),
        title: work.title,
        company: "OpenAlex",
        link: work.doi || work.primary_location?.landing_page_url || work.id,
        summary: cleanText(work.abstract_inverted_index ? "Recent AI research publication indexed by OpenAlex." : "Recent AI research signal from OpenAlex.", 420),
        content: work.title,
        location: "Global",
        publishedAt: work.publication_date || new Date().toISOString(),
        category: "Research",
        fitScore: scoreFor("Research", index),
        tags: ["research", "openalex", "ai"],
      }));
    },
    async () => {
      const data = await fetchJson(
        "https://api.github.com/search/repositories?q=artificial-intelligence&sort=updated&order=desc&per_page=8",
      );
      return (data.items || []).slice(0, 8).map((repo, index) => ({
        id: `github-${repo.id}`,
        title: repo.full_name,
        company: "GitHub",
        link: repo.html_url,
        summary: repo.description || `AI repository with ${repo.stargazers_count || 0} stars.`,
        content: repo.description || repo.full_name,
        location: "Global",
        publishedAt: repo.updated_at || repo.created_at || new Date().toISOString(),
        category: "AI Products",
        fitScore: scoreFor("AI Products", index),
        tags: ["github", "open-source", repo.language || "ai"].filter(Boolean),
      }));
    },
    async () => {
      const data = await fetchJson("https://huggingface.co/api/models?search=ai&sort=trendingScore&direction=-1&limit=8");
      return (Array.isArray(data) ? data : []).slice(0, 8).map((model, index) => ({
        id: `hf-${model.id}`.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 140),
        title: model.id,
        company: "Hugging Face",
        link: `https://huggingface.co/${model.id}`,
        summary: `Trending AI model with ${model.downloads || 0} downloads and ${model.likes || 0} likes.`,
        content: model.id,
        location: "Global",
        publishedAt: model.lastModified || new Date().toISOString(),
        category: "AI Products",
        fitScore: scoreFor("AI Products", index),
        tags: ["hugging-face", "model", ...(model.tags || []).slice(0, 4)],
      }));
    },
  ];

  const settled = await Promise.allSettled(tasks.map((task) => task()));
  const items = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const failures = settled
    .map((result, index) => (result.status === "rejected" ? { index, error: result.reason?.message || String(result.reason) } : null))
    .filter(Boolean);
  return { items, failures };
}

async function saveIncomingItems(incoming, analyticsType, analyticsMeta = {}) {
  const normalized = incoming.map(normalizeItem);
  const validationErrors = normalized
    .map((item, index) => ({ index, errors: validateItem(item) }))
    .filter((result) => result.errors.length);
  if (validationErrors.length) return { ok: false, validationErrors };

  const existing = await readItems();
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of normalized) byId.set(item.id, item);
  const next = Array.from(byId.values()).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  await writeItems(next);
  await appendAnalytics({
    id: crypto.randomUUID(),
    type: analyticsType,
    received: normalized.length,
    total: next.length,
    at: new Date().toISOString(),
    ...analyticsMeta,
  });
  return { ok: true, normalized, total: next.length };
}

function sanitizeStoredItem(item) {
  const warnings = Array.isArray(item.dataQualityWarnings) ? [...item.dataQualityWarnings] : [];
  const publishedAt = normalizePublishedAt(item.publishedAt, warnings);
  return {
    ...item,
    category: canonicalCategory(item.category),
    fitScore: Math.max(0, Math.min(100, Number(item.fitScore || 0))),
    tags: normalizeArray(item.tags).slice(0, 12),
    publishedAt,
    ...(warnings.length ? { dataQualityWarnings: [...new Set(warnings)] } : {}),
  };
}

function normalizeLead(input) {
  const email = cleanText(input.email || "", 254).toLowerCase();
  const name = cleanText(input.name || "", 120);
  const role = cleanText(input.role || "", 80);
  const channel = cleanText(input.channel || "email", 30).toLowerCase();
  const interests = normalizeArray(input.interests);
  const frequency = cleanText(input.frequency || "daily", 30).toLowerCase();
  const digestFormat = cleanText(input.digestFormat || "html", 30).toLowerCase();
  const subscribed = input.subscribed !== false;

  return {
    id: crypto.createHash("sha256").update(email).digest("hex").slice(0, 18),
    email,
    name,
    role,
    channel,
    interests,
    frequency,
    digestFormat,
    subscribed,
    plan: "free-preview",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function validateLead(lead) {
  const errors = [];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) errors.push("A valid email is required.");
  if (!["email", "telegram", "whatsapp"].includes(lead.channel)) errors.push("Unsupported delivery channel.");
  if (!["daily", "weekly"].includes(lead.frequency)) errors.push("Unsupported digest frequency.");
  if (!["html", "text"].includes(lead.digestFormat)) errors.push("Unsupported digest format.");
  return errors;
}

function compactChatItem(item) {
  return {
    title: item.title,
    source: item.company,
    category: item.category,
    score: item.fitScore,
    date: item.publishedAt,
    summary: item.summary,
    link: item.link,
    tags: item.tags,
  };
}

function normalizeChatHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((message) => ["user", "assistant"].includes(message?.role) && message?.content)
    .slice(-8)
    .map((message) => ({
      role: message.role,
      content: String(message.content).slice(0, 1800),
    }));
}

function buildChatSuggestions(message, items) {
  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))];
  const lower = String(message || "").toLowerCase();
  if (/job|career|apply|role/.test(lower)) {
    return ["Compare the top 3 job matches", "Draft an application action plan", "Show only remote AI roles"];
  }
  if (/paper|research|study|publication/.test(lower)) {
    return ["Compare the top 3 papers", "Find healthcare or agriculture AI links", "Turn this into a research brief"];
  }
  if (/image|visual|creative|marketing|brand|ad|campaign|thumbnail|hero/.test(lower)) {
    return ["Expand into an ad campaign", "Create 3 image prompts", "Build a visual creative brief"];
  }
  if (/linkedin|newsletter|client report|prompt pack|digest/.test(lower)) {
    return ["Make it more premium", "Add stronger hooks", "Include source-backed links"];
  }
  if (/news|update|tool|agent|startup/.test(lower)) {
    return ["Summarize today's AI updates", "Rank the most useful tools", "Find startup signals worth posting"];
  }
  if (categories.length) {
    return [`Show best ${categories[0]} items`, "What should I act on first?", "Create a 5-minute daily brief"];
  }
  return ["Run a live update", "Explain how this desk works", "What can I ask you?"];
}

async function handleLeadSignup(req, res) {
  if (!checkRateLimit(req, res, "subscribe", 8)) return;
  const body = await readBody(req);
  const lead = normalizeLead(body);
  const errors = validateLead(lead);

  if (errors.length) {
    return json(res, 400, { ok: false, error: errors[0], errors });
  }

  const leads = await readLeads();
  const byId = new Map(leads.map((item) => [item.id, item]));
  const existing = byId.get(lead.id);
  byId.set(lead.id, existing ? { ...existing, ...lead, createdAt: existing.createdAt } : lead);
  const next = Array.from(byId.values()).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  await writeLeads(next);
  await appendAnalytics({
    id: crypto.randomUUID(),
    type: "subscribe_success",
    emailHash: lead.id,
    role: lead.role,
    interests: lead.interests,
    at: new Date().toISOString(),
  });

  return json(res, 201, {
    ok: true,
    message: "Subscribed to the daily formatted AI opportunity email.",
    lead: {
      id: lead.id,
      email: lead.email,
      interests: lead.interests,
      channel: lead.channel,
      frequency: lead.frequency,
      digestFormat: lead.digestFormat,
      subscribed: lead.subscribed,
      plan: lead.plan,
    },
  });
}

async function handleChat(req, res) {
  if (!checkRateLimit(req, res, "chat", 20)) return;
  if (!OPENROUTER_API_KEY) {
    return json(res, 503, {
      ok: false,
      error: "OpenRouter is not configured. Set OPENROUTER_API_KEY before using the chatbot.",
    });
  }

  const body = await readBody(req);
  const message = String(body.message || "").trim();
  if (!message) return json(res, 400, { ok: false, error: "Message is required." });
  if (message.length > 3000) return json(res, 400, { ok: false, error: "Message is too long." });

  const items = await readItems();
  const contextItems = items.slice(0, 15).map(compactChatItem);
  const systemPrompt = [
    "You are the AI SignalDesk Copilot. Your role is to keep the user engaged and help them act quickly.",
    "Use the provided opportunity feed context whenever relevant. Every source item includes title, category, score, summary, and link.",
    `The public app URL is ${OPENROUTER_SITE_URL}. Do not mention or link to other SignalDesk domains.`,
    "Answer in a polished, skimmable markdown style.",
    "When the user asks for an output mode, format the answer as the requested asset: LinkedIn Post, Newsletter Brief, Client Report, Prompt Pack, Image Creative Brief, or Research Digest.",
    "For image and visual marketing requests, include prompt ideas, best use case, suggested style, model suggestion, campaign angle, and source-backed context.",
    "Default response structure:",
    "1. A one-sentence direct answer.",
    "2. A short ranked list or compact comparison table when useful.",
    "3. Clear next actions.",
    "4. Include source links using markdown links when you mention specific opportunities.",
    "Tone: energetic, practical, concise, expert, not salesy.",
    "Do not invent source facts. If the feed does not contain enough information, say what is missing and suggest using Live update.",
    "Keep answers under 220 words unless the user asks for a deep report.",
    "",
    "Current feed context JSON:",
    JSON.stringify(contextItems),
  ].join("\n");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": OPENROUTER_SITE_URL,
      "X-OpenRouter-Title": OPENROUTER_SITE_NAME,
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      temperature: 0.3,
      messages: [
        { role: "system", content: systemPrompt },
        ...normalizeChatHistory(body.history),
        { role: "user", content: message.slice(0, 3000) },
      ],
    }),
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    return json(res, 502, {
      ok: false,
      error: payload?.error?.message || payload?.message || "OpenRouter request failed.",
      status: response.status,
    });
  }

  const reply = payload?.choices?.[0]?.message?.content || "";
  await appendAnalytics({
    id: crypto.randomUUID(),
    type: "chat_success",
    model: payload?.model || OPENROUTER_MODEL,
    itemCount: contextItems.length,
    at: new Date().toISOString(),
  });
  return json(res, 200, {
    ok: true,
    reply,
    model: payload?.model || OPENROUTER_MODEL,
    suggestions: buildChatSuggestions(message, contextItems),
    sources: contextItems
      .filter((item) => item.link)
      .slice(0, 5)
      .map((item) => ({ title: item.title, link: item.link, source: item.source })),
  });
}

function digestCounts(items) {
  return items.reduce((bucket, item) => {
    const category = canonicalCategory(item.category);
    bucket[category] = (bucket[category] || 0) + 1;
    return bucket;
  }, {});
}

function formatEmailDate(value = new Date()) {
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function groupDigestItems(items) {
  const order = ["Jobs", "Research", "AI Products", "Prompts", "Image Prompts", "News", "Updates", "Startup News"];
  const groups = new Map(order.map((category) => [category, []]));
  for (const item of items) {
    const category = canonicalCategory(item.category);
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(item);
  }
  return [...groups.entries()].filter(([, groupItems]) => groupItems.length);
}

function renderDigestItem(item) {
  const source = item.link
    ? `<a href="${escapeHtml(item.link)}" style="color:#007f73;font-weight:800;text-decoration:none">Open source</a>`
    : "";
  const tags = (item.tags || [])
    .slice(0, 4)
    .map(
      (tag) =>
        `<span style="display:inline-block;margin:4px 6px 0 0;padding:4px 8px;border:1px solid #d9e2ea;border-radius:999px;color:#647080;font-size:12px">${escapeHtml(tag)}</span>`,
    )
    .join("");

  return `<tr>
    <td style="padding:16px 0;border-top:1px solid #d9e2ea">
      <div style="font-size:12px;color:#647080;font-weight:800;text-transform:uppercase">${escapeHtml(
        item.company || "Curated by n8n",
      )} · ${escapeHtml(item.location || "Remote / Global")} · ${escapeHtml(String(item.fitScore || "New"))}${item.fitScore ? "% priority" : ""}</div>
      <h3 style="margin:7px 0 8px;color:#111827;font-size:18px;line-height:1.25">${escapeHtml(item.title)}</h3>
      <p style="margin:0 0 10px;color:#334155;font-size:14px;line-height:1.55">${escapeHtml(
        item.summary || "No summary was provided by the workflow.",
      )}</p>
      <div>${tags}</div>
      <div style="margin-top:10px">${source}</div>
    </td>
  </tr>`;
}

function renderDailyDigestHtml(items) {
  const topItems = items.slice(0, 24);
  const counts = digestCounts(topItems);
  const countLine = ["Jobs", "Research", "AI Products", "Prompts", "Image Prompts"]
    .map((category) => `${category}: ${counts[category] || 0}`)
    .join(" · ");
  const sections = groupDigestItems(topItems)
    .map(
      ([category, groupItems]) => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:22px">
        <tr>
          <td>
            <h2 style="margin:0 0 4px;color:#17324d;font-size:20px">${escapeHtml(category)}</h2>
            <p style="margin:0;color:#647080;font-size:13px">${groupItems.length} curated signal${groupItems.length === 1 ? "" : "s"}</p>
          </td>
        </tr>
        ${groupItems.slice(0, 5).map(renderDigestItem).join("")}
      </table>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Daily AI Opportunity Intelligence</title>
  </head>
  <body style="margin:0;background:#f5f7f9;font-family:Inter,Segoe UI,Arial,sans-serif;color:#111827">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7f9;padding:24px 12px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:760px;background:#ffffff;border:1px solid #d9e2ea;border-radius:8px;overflow:hidden">
            <tr>
              <td style="padding:28px;background:#17324d;color:#ffffff">
                <div style="font-size:12px;font-weight:900;text-transform:uppercase;color:#8ee8dd">Daily AI Opportunity Intelligence</div>
                <h1 style="margin:8px 0 10px;font-size:30px;line-height:1.08">Jobs, research, products, prompts, and visual marketing trends worth acting on.</h1>
                <p style="margin:0;color:#d8eef0;font-size:15px;line-height:1.55">${escapeHtml(formatEmailDate())} · ${escapeHtml(countLine)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px">
                <p style="margin:0 0 18px;color:#334155;font-size:15px;line-height:1.6">Here is today's formatted AI opportunity brief, ranked for action and grouped by market signal.</p>
                ${sections || `<p style="color:#647080">No digest items are available yet. Run the live n8n update to refresh the feed.</p>`}
                <div style="margin-top:28px;padding:16px;border:1px solid #d9e2ea;border-radius:8px;background:#f3fbfb">
                  <strong style="color:#075f56">Next action</strong>
                  <p style="margin:6px 0 0;color:#334155;line-height:1.55">Pick one opportunity, turn it into a LinkedIn post, research digest, prompt pack, or image creative brief, and link back to the original source.</p>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderDailyDigestText(items) {
  const lines = ["Daily AI Opportunity Intelligence", formatEmailDate(), ""];
  for (const [category, groupItems] of groupDigestItems(items.slice(0, 24))) {
    lines.push(category);
    for (const item of groupItems.slice(0, 5)) {
      lines.push(`- ${item.title} (${item.fitScore || "New"}${item.fitScore ? "% priority" : ""})`);
      if (item.summary) lines.push(`  ${item.summary}`);
      if (item.link) lines.push(`  Source: ${item.link}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function handleDailyDigest(req, res, htmlOnly = false) {
  const items = await readItems();
  const topItems = items.slice(0, 24);
  const html = renderDailyDigestHtml(topItems);
  if (htmlOnly) {
    return send(res, 200, html, { "Content-Type": "text/html; charset=utf-8" });
  }
  return json(res, 200, {
    ok: true,
    subject: `Daily AI Opportunity Intelligence - ${formatEmailDate()}`,
    preheader: "Jobs, research, products, prompts, and visual marketing trends worth acting on.",
    html,
    text: renderDailyDigestText(topItems),
    counts: digestCounts(topItems),
    items: topItems.map(compactChatItem),
  });
}

async function handleLiveUpdate(req, res) {
  if (!checkRateLimit(req, res, "live-update", 6)) return;
  if (!N8N_LIVE_WEBHOOK_URL) {
    return json(res, 503, {
      ok: false,
      error: "Live n8n webhook is not configured.",
      setup: "Set N8N_LIVE_WEBHOOK_URL to the production webhook URL from the n8n workflow.",
    });
  }

  let response = { ok: false, status: 0 };
  let text = "";
  try {
    response = await fetch(N8N_LIVE_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(N8N_LIVE_WEBHOOK_TOKEN ? { "x-live-update-token": N8N_LIVE_WEBHOOK_TOKEN } : {}),
      },
      body: JSON.stringify({
        source: "webapp-live-button",
        requestedAt: new Date().toISOString(),
      }),
    });
    text = await response.text();
  } catch (error) {
    text = JSON.stringify({ error: error.message || String(error) });
  }

  let payload = null;
  try {
    payload = JSON.parse(text);
    if (typeof payload === "string") payload = JSON.parse(payload);
  } catch {
    payload = null;
  }

  const incoming = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];
  if (response.ok && incoming.length) {
    const saved = await saveIncomingItems(incoming, "live_update_success", { provider: "n8n" });
    if (!saved.ok) return json(res, 422, { ok: false, error: "n8n returned invalid posts.", validationErrors: saved.validationErrors });

    return json(res, 202, {
      ok: true,
      status: response.status,
      message: "Live update finished and saved real n8n data.",
      provider: "n8n",
      received: saved.normalized.length,
      total: saved.total,
      counts: payload?.counts || null,
    });
  }

  const fallback = await fetchFallbackLiveSignals();
  if (fallback.items.length) {
    const saved = await saveIncomingItems(fallback.items, "live_update_fallback_success", {
      provider: "direct-public-sources",
      n8nStatus: response.status,
      n8nResponse: text.slice(0, 500),
      sourceFailures: fallback.failures,
    });
    if (!saved.ok) {
      return json(res, 422, { ok: false, error: "Fallback sources returned invalid posts.", validationErrors: saved.validationErrors });
    }
    return json(res, 202, {
      ok: true,
      status: response.status,
      provider: "direct-public-sources",
      message: response.ok
        ? "Live update saved direct public-source data because n8n returned no posts."
        : "n8n live update failed, so SignalDesk saved direct public-source data.",
      received: saved.normalized.length,
      total: saved.total,
      n8nResponse: text.slice(0, 500),
      sourceFailures: fallback.failures,
    });
  }

  return json(res, 502, {
    ok: false,
    status: response.status,
    message: "n8n live update failed and fallback public sources returned no posts.",
    response: text.slice(0, 1000),
    sourceFailures: fallback.failures,
  });
}

async function handleWebhook(req, res) {
  if (!checkRateLimit(req, res, "webhook", 60)) return;
  if (WEBHOOK_TOKEN && !isAuthorized(req)) {
    return json(res, 401, { ok: false, error: "Unauthorized" });
  }

  const body = await readBody(req);
  const incoming = Array.isArray(body) ? body : Array.isArray(body.items) ? body.items : [body];
  if (!incoming.length) return json(res, 400, { ok: false, error: "At least one post is required." });
  if (incoming.length > MAX_POSTS_PER_REQUEST) {
    return json(res, 413, {
      ok: false,
      error: `Too many posts in one request. Maximum is ${MAX_POSTS_PER_REQUEST}.`,
    });
  }
  const normalized = incoming.map(normalizeItem);
  const validationErrors = normalized
    .map((item, index) => ({ index, errors: validateItem(item) }))
    .filter((result) => result.errors.length);
  if (validationErrors.length) {
    return json(res, 422, { ok: false, error: "One or more posts are invalid.", validationErrors });
  }
  const existing = await readItems();
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of normalized) byId.set(item.id, item);
  const next = Array.from(byId.values()).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  await writeItems(next);
  await appendAnalytics({
    id: crypto.randomUUID(),
    type: "webhook_publish_success",
    received: normalized.length,
    total: next.length,
    authorized: Boolean(WEBHOOK_TOKEN),
    at: new Date().toISOString(),
  });

  return json(res, 201, { ok: true, received: normalized.length, total: next.length });
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function leadsToCsv(leads) {
  const headers = [
    "id",
    "email",
    "name",
    "role",
    "channel",
    "interests",
    "frequency",
    "digestFormat",
    "subscribed",
    "plan",
    "createdAt",
    "updatedAt",
  ];
  const rows = leads.map((lead) =>
    headers
      .map((header) => csvCell(Array.isArray(lead[header]) ? lead[header].join("; ") : lead[header]))
      .join(","),
  );
  return `${headers.join(",")}\n${rows.join("\n")}\n`;
}

async function handleHealth(req, res) {
  const [items, leads, analytics] = await Promise.all([readItems(), readLeads(), readAnalytics()]);
  return json(res, 200, {
    ok: true,
    service: "AI SignalDesk",
    uptimeSeconds: Math.round(process.uptime()),
    environment: process.env.NODE_ENV || "development",
    configured: {
      webhookToken: Boolean(WEBHOOK_TOKEN),
      openRouter: Boolean(OPENROUTER_API_KEY),
      n8nLiveWebhook: Boolean(N8N_LIVE_WEBHOOK_URL),
    },
    counts: {
      posts: items.length,
      leads: leads.length,
      analytics: analytics.length,
    },
    checkedAt: new Date().toISOString(),
  });
}

async function handleAnalytics(req, res) {
  if (!checkRateLimit(req, res, "analytics", 120)) return;
  const body = await readBody(req);
  const type = cleanText(body.type || "", 60);
  const allowedTypes = new Set([
    "page_load",
    "category_filter",
    "post_view",
    "digest_preview",
    "paid_beta_click",
    "chat_export",
  ]);
  if (!allowedTypes.has(type)) return json(res, 400, { ok: false, error: "Unsupported analytics event." });

  await appendAnalytics({
    id: crypto.randomUUID(),
    type,
    path: cleanText(body.path || "", 400),
    label: cleanText(body.label || "", 120),
    metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
    at: new Date().toISOString(),
  });
  return json(res, 202, { ok: true });
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/health" && req.method === "GET") {
    return handleHealth(req, res);
  }

  if ((url.pathname === "/api/news" || url.pathname === "/api/posts") && req.method === "GET") {
    return json(res, 200, { items: await readItems() });
  }

  if (
    (url.pathname === "/api/news" || url.pathname === "/api/posts" || url.pathname === "/api/posts/daily") &&
    req.method === "POST"
  ) {
    return handleWebhook(req, res);
  }

  if ((url.pathname === "/api/news" || url.pathname === "/api/posts") && req.method === "DELETE") {
    const auth = requireWebhookToken(req, res);
    if (!auth.ok) return auth.response;
    await writeItems([]);
    return json(res, 200, { ok: true });
  }

  if ((url.pathname === "/api/leads" || url.pathname === "/api/subscribe") && req.method === "POST") {
    return handleLeadSignup(req, res);
  }

  if (url.pathname === "/api/leads" && req.method === "GET") {
    const auth = requireWebhookToken(req, res);
    if (!auth.ok) return auth.response;
    return json(res, 200, { leads: await readLeads() });
  }

  if (url.pathname === "/api/leads.csv" && req.method === "GET") {
    const auth = requireWebhookToken(req, res);
    if (!auth.ok) return auth.response;
    const csv = leadsToCsv(await readLeads());
    return send(res, 200, csv, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"ai-signaldesk-leads.csv\"",
    });
  }

  if (url.pathname === "/api/live-update" && req.method === "POST") {
    return handleLiveUpdate(req, res);
  }

  if (url.pathname === "/api/digest/daily.html" && req.method === "GET") {
    return handleDailyDigest(req, res, true);
  }

  if (url.pathname === "/api/digest/daily" && req.method === "GET") {
    return handleDailyDigest(req, res, false);
  }

  if (url.pathname === "/api/chat" && req.method === "POST") {
    return handleChat(req, res);
  }

  if (url.pathname === "/api/analytics" && req.method === "POST") {
    return handleAnalytics(req, res);
  }

  if (url.pathname === "/api/analytics" && req.method === "GET") {
    const auth = requireWebhookToken(req, res);
    if (!auth.ok) return auth.response;
    return json(res, 200, { events: await readAnalytics() });
  }

  return json(res, 404, { ok: false, error: "Not found" });
}

function renderParagraphs(text) {
  const paragraphs = String(text || "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (!paragraphs.length) return "<p>No article content was provided by the workflow.</p>";
  return paragraphs.map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br>")}</p>`).join("\n");
}

function renderPostPage(item) {
  const imageMarkup = item.imageUrl
    ? `<img class="post-cover" src="${escapeHtml(item.imageUrl)}" alt="">`
    : `<div class="post-cover post-cover-fallback"><span>AI SignalDesk</span></div>`;
  const tags = (item.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  const source = item.link
    ? `<a class="source-link" href="${escapeHtml(item.link)}" target="_blank" rel="noreferrer">Open source</a>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(item.title)} | Dr. Maiti AI Intelligence Desk</title>
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body>
    <header class="topbar">
      <div>
        <p class="eyebrow">Daily published post</p>
        <h1>${escapeHtml(item.title)}</h1>
      </div>
      <a class="nav-button" href="/">All posts</a>
    </header>
    <main class="post-layout">
      ${imageMarkup}
      <article class="post-article">
        <div class="alert-meta">
          <span>${escapeHtml(item.company || "Curated by n8n")}</span>
          <span>${escapeHtml(item.location || "Remote / Global")}</span>
          <span>${escapeHtml(canonicalCategory(item.category))}</span>
          <span>${escapeHtml(new Date(item.publishedAt).toLocaleString())}</span>
        </div>
        <div class="tags">${tags}</div>
        <div class="article-body">${renderParagraphs(item.content || item.summary)}</div>
        ${source}
      </article>
    </main>
  </body>
</html>`;
}

async function servePost(req, res, url) {
  const id = decodeURIComponent(url.pathname.replace(/^\/post\//, ""));
  const items = await readItems();
  const item = items.find((candidate) => candidate.id === id);
  if (!item) {
    return send(res, 404, "Post not found", { "Content-Type": "text/plain; charset=utf-8" });
  }
  return send(res, 200, renderPostPage(item), { "Content-Type": mimeTypes[".html"] });
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return send(res, 403, "Forbidden", { "Content-Type": "text/plain; charset=utf-8" });
  }

  try {
    const body = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    return send(res, 200, body, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
  } catch {
    const fallback = await fs.readFile(path.join(PUBLIC_DIR, "index.html"));
    return send(res, 200, fallback, { "Content-Type": mimeTypes[".html"] });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
    if (url.pathname.startsWith("/post/")) return servePost(req, res, url);
    return serveStatic(req, res, url);
  } catch (error) {
    logError("Request failed", error, { method: req.method, url: req.url });
    return json(res, error.status || 500, { ok: false, error: error.status ? error.message : "Internal server error" });
  }
});

server.listen(PORT, () => {
  logInfo("AI Intelligence Desk website running", { url: `http://localhost:${PORT}` });
  logInfo("n8n daily POST endpoint ready", {
    endpoint: "/api/posts/daily",
    webhookProtected: Boolean(WEBHOOK_TOKEN),
  });
});
