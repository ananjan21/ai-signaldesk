const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 4173);
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || "";
const N8N_LIVE_WEBHOOK_URL = process.env.N8N_LIVE_WEBHOOK_URL || "";
const N8N_LIVE_WEBHOOK_TOKEN = process.env.N8N_LIVE_WEBHOOK_TOKEN || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "google/gemini-3.5-flash-lite";
const OPENROUTER_SITE_URL = process.env.OPENROUTER_SITE_URL || `http://localhost:${PORT}`;
const OPENROUTER_SITE_NAME = process.env.OPENROUTER_SITE_NAME || "AI SignalDesk";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "news.json");
const LEADS_FILE = path.join(DATA_DIR, "leads.json");
const ANALYTICS_FILE = path.join(DATA_DIR, "analytics.json");
const ARCHIVE_DIR = path.join(DATA_DIR, "archive");
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

const storageWriteQueues = new Map();
let itemMergeQueue = Promise.resolve();

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

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, storedHash = "") {
  const [scheme, salt, hash] = String(storedHash).split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function basicAdminCredentials(req) {
  const header = String(req.headers.authorization || "");
  if (!header.toLowerCase().startsWith("basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator === -1) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function isAdminAuthorized(req) {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) return false;
  const credentials = basicAdminCredentials(req);
  return credentials?.username === ADMIN_USERNAME && credentials?.password === ADMIN_PASSWORD;
}

function requireAdminAuth(req, res) {
  if (isAdminAuthorized(req) || isAuthorized(req)) return { ok: true, handled: false };
  res.setHeader("WWW-Authenticate", 'Basic realm="AI SignalDesk Admin"');
  return {
    ok: false,
    handled: true,
    response: json(res, 401, { ok: false, error: "Unauthorized" }),
  };
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
  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
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
    const backupFile = `${file}.invalid-${Date.now()}.bak`;
    try {
      await fs.copyFile(file, backupFile);
      logInfo(`${label} JSON backup created`, { file: backupFile });
    } catch (backupError) {
      logError(`${label} JSON backup failed`, backupError, { file });
    }
    return [];
  }
  return Array.isArray(parsed) ? parsed : [];
}

async function writeJsonArray(file, items) {
  await ensureStore();
  const tmpFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  const payload = `${JSON.stringify(items, null, 2)}\n`;
  const previous = storageWriteQueues.get(file) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      await fs.writeFile(tmpFile, payload, "utf8");
      await fs.rename(tmpFile, file);
    })
    .finally(() => {
      if (storageWriteQueues.get(file) === next) storageWriteQueues.delete(file);
    });
  storageWriteQueues.set(file, next);
  return next;
}

async function readItems() {
  const items = await readJsonArray(DATA_FILE, "Post");
  return items.map(sanitizeStoredItem);
}

async function writeItems(items) {
  await writeJsonArray(DATA_FILE, items);
}

function monthKey(value = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 7);
  return date.toISOString().slice(0, 7);
}

function archiveFileFor(value = new Date()) {
  return path.join(ARCHIVE_DIR, `${monthKey(value)}.json`);
}

async function appendMonthlyArchive(items, source = "publish") {
  if (!items.length) return { month: monthKey(), saved: 0, total: 0 };
  const file = archiveFileFor(new Date());
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(file, "[]\n", "utf8");
  }
  const archive = await readJsonArray(file, "Monthly archive");
  const byId = new Map(archive.map((item) => [item.id, item]));
  const archivedAt = new Date().toISOString();
  for (const item of items) {
    byId.set(item.id, {
      ...sanitizeStoredItem(item),
      archiveSource: source,
      archivedAt,
    });
  }
  const next = Array.from(byId.values()).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  await writeJsonArray(file, next);
  return { month: monthKey(), saved: items.length, total: next.length };
}

async function mergeAndStoreItems(normalized, archiveSource = "publish") {
  const run = itemMergeQueue.catch(() => {}).then(async () => {
    const existing = await readItems();
    const byId = new Map(existing.map((item) => [item.id, item]));
    for (const item of normalized) byId.set(item.id, item);
    const next = Array.from(byId.values()).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    await writeItems(next);
    const archive = await appendMonthlyArchive(normalized, archiveSource);
    return { next, total: next.length, archive };
  });
  itemMergeQueue = run.catch(() => {});
  return run;
}

async function readLeads() {
  return readJsonArray(LEADS_FILE, "Lead");
}

async function writeLeads(leads) {
  await writeJsonArray(LEADS_FILE, leads);
}

async function readAnalytics() {
  return readJsonArray(ANALYTICS_FILE, "Analytics");
}

async function appendAnalytics(event) {
  const events = await readAnalytics();
  events.unshift(event);
  await writeJsonArray(ANALYTICS_FILE, events.slice(0, 5000));
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
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<\s*li\b[^>]*>/gi, "- ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => {
      const value = Number(code);
      return Number.isFinite(value) ? String.fromCodePoint(value) : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => {
      const value = Number.parseInt(code, 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : " ";
    })
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

function plainFeedText(value, maxLength = 1200) {
  return cleanText(value, maxLength)
    .replace(/\[[^\]]*(?:&|:)[^\]]+\]:[a-z0-9-]+/gi, " ")
    .replace(/\[[^\]]*(?:&|:)[^\]]+\]/g, " ")
    .replace(/--tw-[a-z0-9-]+:\s*[^;]+;?/gi, " ")
    .replace(/\b(?:class|style|data-[\w-]+|aria-[\w-]+)=['"][^'"]*['"]/gi, " ")
    .replace(/\b(?:oklch|rgb|rgba|hsl|hsla)\([^)]*\)/gi, " ")
    .replace(/[{}]/g, " ")
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
    firstValue(source, ["company", "organization", "employer", "source", "publisher"], "Curated by agentic AI"),
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

  const saved = await mergeAndStoreItems(normalized, analyticsType);
  await appendAnalytics({
    id: crypto.randomUUID(),
    type: analyticsType,
    received: normalized.length,
    total: saved.total,
    archive: saved.archive,
    at: new Date().toISOString(),
    ...analyticsMeta,
  });
  return { ok: true, normalized, total: saved.total, archive: saved.archive };
}

function sanitizeStoredItem(item) {
  const warnings = Array.isArray(item.dataQualityWarnings) ? [...item.dataQualityWarnings] : [];
  const publishedAt = normalizePublishedAt(item.publishedAt, warnings);
  return {
    ...item,
    title: cleanText(item.title, 180),
    company: cleanText(item.company, 140),
    link: cleanText(item.link, 900),
    summary: cleanText(item.summary, 1200),
    content: cleanText(item.content, 12000),
    location: cleanText(item.location || "Remote / Global", 140),
    imageUrl: cleanText(item.imageUrl, 900),
    category: canonicalCategory(item.category),
    fitScore: Math.max(0, Math.min(100, Number(item.fitScore || 0))),
    tags: normalizeArray(item.tags).slice(0, 12).map((tag) => cleanText(tag, 40)),
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
  const requestedPlan = cleanText(input.plan || "", 80);
  const plan = requestedPlan === "paid-beta" || interests.includes("Paid Beta") ? "paid-beta" : "free-preview";

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
    plan,
    emailForwardCount: Math.max(0, Number(input.emailForwardCount || input.emailForwards || 0) || 0),
    lastEmailForwardedAt: cleanText(input.lastEmailForwardedAt || "", 60) || null,
    lastEmailSubject: cleanText(input.lastEmailSubject || "", 180),
    adminNotes: cleanText(input.adminNotes || "", 1000),
    adminTags: normalizeArray(input.adminTags).map((tag) => cleanText(tag, 60)),
    bounced: input.bounced === true,
    paidAccessEnabled: input.paidAccessEnabled === true,
    paidUsername: cleanText(input.paidUsername || "", 120),
    paidPasswordHash: cleanText(input.paidPasswordHash || "", 240),
    paidPasswordUpdatedAt: cleanText(input.paidPasswordUpdatedAt || "", 60) || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function sanitizeLead(lead) {
  return {
    ...lead,
    id: cleanText(lead.id, 80),
    email: cleanText(lead.email, 254).toLowerCase(),
    name: cleanText(lead.name, 120),
    role: cleanText(lead.role, 80),
    channel: cleanText(lead.channel || "email", 30).toLowerCase(),
    interests: normalizeArray(lead.interests).map((interest) => cleanText(interest, 80)),
    frequency: cleanText(lead.frequency || "daily", 30).toLowerCase(),
    digestFormat: cleanText(lead.digestFormat || "html", 30).toLowerCase(),
    subscribed: lead.subscribed !== false,
    plan: cleanText(lead.plan || "free-preview", 80),
    emailForwardCount: Math.max(0, Number(lead.emailForwardCount || lead.emailForwards || 0) || 0),
    lastEmailForwardedAt: cleanText(lead.lastEmailForwardedAt || "", 60) || null,
    lastEmailSubject: cleanText(lead.lastEmailSubject || "", 180),
    adminNotes: cleanText(lead.adminNotes || "", 1000),
    adminTags: normalizeArray(lead.adminTags).map((tag) => cleanText(tag, 60)),
    bounced: lead.bounced === true,
    paidAccessEnabled: lead.paidAccessEnabled === true,
    paidUsername: cleanText(lead.paidUsername || "", 120),
    paidPasswordSet: Boolean(lead.paidPasswordHash),
    paidPasswordUpdatedAt: cleanText(lead.paidPasswordUpdatedAt || "", 60) || null,
    paidPasswordHash: undefined,
    createdAt: cleanText(lead.createdAt || "", 60),
    updatedAt: cleanText(lead.updatedAt || "", 60),
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
    title: plainFeedText(item.title, 180),
    source: plainFeedText(item.company, 140),
    category: canonicalCategory(item.category),
    score: item.fitScore,
    date: item.publishedAt,
    summary: plainFeedText(item.summary || item.content, 700),
    link: item.link,
    tags: normalizeArray(item.tags).map((tag) => plainFeedText(tag, 40)).filter(Boolean),
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
  byId.set(
    lead.id,
    existing
      ? {
          ...existing,
          ...lead,
          plan: existing.plan || lead.plan,
          paidAccessEnabled: existing.paidAccessEnabled === true || lead.paidAccessEnabled === true,
          paidUsername: existing.paidUsername || lead.paidUsername,
          paidPasswordHash: existing.paidPasswordHash || lead.paidPasswordHash,
          paidPasswordUpdatedAt: existing.paidPasswordUpdatedAt || lead.paidPasswordUpdatedAt,
          emailForwardCount: existing.emailForwardCount || 0,
          lastEmailForwardedAt: existing.lastEmailForwardedAt || null,
          lastEmailSubject: existing.lastEmailSubject || "",
          createdAt: existing.createdAt,
        }
      : lead,
  );
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
  const contextItems = items.slice(0, 24).map(compactChatItem);
  const systemPrompt = [
    "You are the AI SignalDesk Copilot, an engaging opportunity strategist for Dr. Ananjan Maiti's AI SignalDesk.",
    "Your job is to help the user notice the best opportunities, understand why they matter, and leave with a concrete next move.",
    "Use the provided opportunity feed context whenever relevant. Every source item includes title, source, category, score, date, summary, link, and tags.",
    `The public app URL is ${OPENROUTER_SITE_URL}. Do not mention or link to other SignalDesk domains.`,
    "Answer like a sharp copilot, not a generic chatbot: decisive, curious, practical, and a little energizing.",
    "Prefer specific recommendations over summaries. Rank, compare, and explain tradeoffs when the feed gives you enough evidence.",
    "When the user asks for an output mode, format the answer as the requested asset: LinkedIn Post, Newsletter Brief, Client Report, Prompt Pack, Image Creative Brief, Research Digest, Job Action Plan, or Founder Brief.",
    "Never include raw HTML tags, CSS classes, inline styles, Tailwind class names, escaped HTML, or source markup. Convert source descriptions into clean plain English.",
    "Keep markdown clean: short paragraphs, bullets, and compact tables only when they improve comparison. Do not repeat duplicate headings.",
    "For prompt requests, give reusable prompt templates with variables, expected output, and one way to test the prompt.",
    "For image and visual marketing requests, include prompt ideas, best use case, visual style, model suggestion, campaign angle, and source-backed context.",
    "For job requests, include fit, why it matches, one portfolio angle, and one application step.",
    "For research requests, include research fit, method/read angle, possible paper/project use, and next reading action.",
    "For startup/news/tool requests, include market signal, who should care, risk/uncertainty, and next action.",
    "Default response shape:",
    "1. Start with the answer in one confident sentence.",
    "2. Give the top 3 ranked options or a compact comparison.",
    "3. Add a 5-minute next action.",
    "4. Add one smart follow-up question only if it would materially improve the next answer.",
    "Include markdown source links when you mention specific feed items.",
    "Do not invent source facts. If the feed lacks evidence, say what is missing and suggest a live update.",
    "Tone: warm, expert, concise, action-oriented, not salesy.",
    "Keep answers under 260 words unless the user asks for a deep report.",
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
        item.company || "Curated by agentic AI",
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
                ${sections || `<p style="color:#647080">No digest items are available yet. Run the live agentic AI update to refresh the feed.</p>`}
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
      error: "Live agentic AI update is not configured.",
      setup: "Set the live update webhook URL for the production agentic AI workflow.",
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
    const saved = await saveIncomingItems(incoming, "live_update_success", { provider: "agentic-ai" });
    if (!saved.ok) return json(res, 422, { ok: false, error: "Agentic AI returned invalid posts.", validationErrors: saved.validationErrors });

    return json(res, 202, {
      ok: true,
      status: response.status,
      message: "Live update finished and saved real agentic AI data.",
      provider: "agentic-ai",
      received: saved.normalized.length,
      total: saved.total,
      counts: payload?.counts || null,
    });
  }

  if (response.ok && payload?.ok) {
    await appendAnalytics({
      id: crypto.randomUUID(),
      type: "live_update_success",
      provider: "agentic-ai",
      received: Number(payload.received || 0),
      total: Number(payload.total || 0),
      at: new Date().toISOString(),
    });
    return json(res, 202, {
      ok: true,
      status: response.status,
      provider: "agentic-ai",
      message: "Live update finished and the agentic AI workflow published fresh data.",
      received: Number(payload.received || 0),
      total: Number(payload.total || 0),
    });
  }

  const fallback = await fetchFallbackLiveSignals();
  if (fallback.items.length) {
    const saved = await saveIncomingItems(fallback.items, "live_update_fallback_success", {
      provider: "direct-public-sources",
      agenticAiStatus: response.status,
      agenticAiResponse: text.slice(0, 500),
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
        ? "Live update saved direct public-source data because agentic AI returned no posts."
        : "Agentic AI live update failed, so SignalDesk saved direct public-source data.",
      received: saved.normalized.length,
      total: saved.total,
      agenticAiResponse: text.slice(0, 500),
      sourceFailures: fallback.failures,
    });
  }

  return json(res, 502, {
    ok: false,
    status: response.status,
    message: "Agentic AI live update failed and fallback public sources returned no posts.",
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
  const saved = await mergeAndStoreItems(normalized, "webhook_publish_success");
  await appendAnalytics({
    id: crypto.randomUUID(),
    type: "webhook_publish_success",
    received: normalized.length,
    total: saved.total,
    archive: saved.archive,
    authorized: Boolean(WEBHOOK_TOKEN),
    at: new Date().toISOString(),
  });

  return json(res, 201, { ok: true, received: normalized.length, total: saved.total, archive: saved.archive });
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function leadsToCsv(leads) {
  const exportLeads = leads.map(sanitizeLead);
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
    "emailForwardCount",
    "lastEmailForwardedAt",
    "lastEmailSubject",
    "adminNotes",
    "adminTags",
    "bounced",
    "paidAccessEnabled",
    "paidUsername",
    "paidPasswordSet",
    "paidPasswordUpdatedAt",
    "createdAt",
    "updatedAt",
  ];
  const rows = exportLeads.map((lead) =>
    headers
      .map((header) => csvCell(Array.isArray(lead[header]) ? lead[header].join("; ") : lead[header]))
      .join(","),
  );
  return `${headers.join(",")}\n${rows.join("\n")}\n`;
}

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayKey(value) {
  const date = parseDate(value) || new Date();
  return date.toISOString().slice(0, 10);
}

function shortDayLabel(value) {
  const date = parseDate(value);
  if (!date) return "Today";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

function shortMonthLabel(value) {
  const date = parseDate(`${value}-01T00:00:00.000Z`);
  if (!date) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }).format(date);
}

function addCategoryCount(bucket, category, amount = 1) {
  const safeCategory = canonicalCategory(category);
  bucket.total += amount;
  bucket.categories[safeCategory] = (bucket.categories[safeCategory] || 0) + amount;
}

const TREND_STOP_WORDS = new Set([
  "about",
  "after",
  "and",
  "agent",
  "agentic",
  "ai",
  "also",
  "analysis",
  "based",
  "build",
  "data",
  "daily",
  "developer",
  "developer-signal",
  "engineer",
  "engineering",
  "github",
  "for",
  "from",
  "global",
  "have",
  "hacker",
  "hackernews",
  "hugging",
  "hugging-face",
  "huggingface",
  "into",
  "latest",
  "launch",
  "machine",
  "model",
  "news",
  "opportunity",
  "openalex",
  "platform",
  "product",
  "remote",
  "remotive",
  "research",
  "signal",
  "signals",
  "software",
  "startup",
  "system",
  "team",
  "the",
  "their",
  "this",
  "today",
  "tool",
  "tools",
  "trend",
  "update",
  "using",
  "with",
  "work",
  "world",
  "your",
]);

function normalizeTopicLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&[a-z]+;/g, " ")
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trendTokens(item) {
  const text = [
    item.title,
    item.summary,
    item.company,
    item.category,
    ...(item.tags || []),
  ]
    .join(" ")
    .toLowerCase();
  return text
    .replace(/&[a-z]+;/g, " ")
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^-+|-+$/g, ""))
    .filter((token) => token.length > 2 && !TREND_STOP_WORDS.has(token) && !/^\d+$/.test(token));
}

function trendPhrases(item) {
  const titleTokens = trendTokens({ title: item.title, summary: "", company: "", category: "", tags: [] });
  const phrases = [];
  for (let index = 0; index < titleTokens.length - 1; index += 1) {
    phrases.push(`${titleTokens[index]} ${titleTokens[index + 1]}`);
  }
  for (const tag of item.tags || []) {
    const label = normalizeTopicLabel(tag);
    if (label && label.length > 2 && !TREND_STOP_WORDS.has(label)) phrases.push(label);
  }
  return phrases.filter((phrase) => phrase.split(" ").some((part) => !TREND_STOP_WORDS.has(part)));
}

function buildTrendingTopics(items = []) {
  const topics = new Map();
  function recordTopic(rawTopic, item, score) {
    const topicKey = normalizeTopicLabel(rawTopic);
    if (!topicKey || topicKey.length < 3) return;
    const current = topics.get(topicKey) || {
      topic: topicKey,
      count: 0,
      score: 0,
      categories: {},
      examples: [],
    };
    current.count += 1;
    current.score += score;
    current.categories[canonicalCategory(item.category)] = (current.categories[canonicalCategory(item.category)] || 0) + 1;
    if (current.examples.length < 3) current.examples.push({ title: item.title, category: canonicalCategory(item.category), link: item.link || "" });
    topics.set(topicKey, current);
  }

  for (const item of items) {
    const baseScore = Math.max(1, Number(item.fitScore || 50) / 25);
    for (const phrase of new Set(trendPhrases(item))) recordTopic(phrase, item, baseScore * 1.8);
    for (const token of new Set(trendTokens(item))) recordTopic(token, item, baseScore);
  }
  return Array.from(topics.values())
    .map((topic) => ({
      ...topic,
      label: topic.topic.replace(/\b\w/g, (char) => char.toUpperCase()),
      score: Math.round(topic.score * 10) / 10,
      leadingCategory: Object.entries(topic.categories).sort((a, b) => b[1] - a[1])[0]?.[0] || "Signals",
    }))
    .sort((a, b) => b.score - a.score || b.count - a.count || a.topic.localeCompare(b.topic))
    .slice(0, 8);
}

function buildTrendingItems(items = []) {
  const now = Date.now();
  return [...items]
    .map((item) => {
      const date = parseDate(item.publishedAt || item.receivedAt || item.updatedAt || item.createdAt);
      const ageHours = date ? Math.max(1, (now - date.getTime()) / 36e5) : 72;
      const recencyBoost = Math.max(0, 32 - ageHours) / 32;
      const fitScore = Number(item.fitScore || 50);
      const trendScore = Math.round(fitScore * 0.74 + recencyBoost * 26);
      return {
        id: item.id,
        title: item.title,
        category: canonicalCategory(item.category),
        company: item.company,
        summary: item.summary,
        link: item.link || `/post/${item.id}`,
        source: item.source || item.company || canonicalCategory(item.category),
        fitScore,
        trendScore,
        publishedAt: item.publishedAt,
        tags: (item.tags || []).slice(0, 4),
      };
    })
    .sort((a, b) => b.trendScore - a.trendScore || new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, 6);
}

function buildTrendSeries(items = [], analytics = []) {
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const weekly = [];
  const weeklyMap = new Map();
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(todayUtc - offset * 24 * 60 * 60 * 1000);
    const key = dayKey(date);
    const bucket = { key, label: shortDayLabel(date), total: 0, categories: {} };
    weekly.push(bucket);
    weeklyMap.set(key, bucket);
  }

  const monthly = [];
  const monthlyMap = new Map();
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const key = monthKey(date);
    const bucket = { key, label: shortMonthLabel(key), total: 0, categories: {} };
    monthly.push(bucket);
    monthlyMap.set(key, bucket);
  }

  const categoryTotals = {};
  for (const item of items) {
    const category = canonicalCategory(item.category);
    const date = parseDate(item.receivedAt || item.publishedAt || item.updatedAt || item.createdAt) || now;
    categoryTotals[category] = (categoryTotals[category] || 0) + 1;
    if (weeklyMap.has(dayKey(date))) addCategoryCount(weeklyMap.get(dayKey(date)), category);
    if (monthlyMap.has(monthKey(date))) addCategoryCount(monthlyMap.get(monthKey(date)), category);
  }

  const activity = weekly.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    total: analytics.filter((event) => dayKey(event.at) === bucket.key).length,
  }));
  const rawBytes = Buffer.byteLength(JSON.stringify(items), "utf8");
  const averageItemBytes = Math.round(rawBytes / Math.max(1, items.length));
  const weeklyTotal = weekly.reduce((sum, bucket) => sum + bucket.total, 0);
  const activeDays = weekly.filter((bucket) => bucket.total > 0).length || 7;
  const estimatedDailyPosts = Math.max(1, Math.ceil(weeklyTotal / activeDays));
  const estimatedMonthlyBytes = estimatedDailyPosts * 30 * Math.max(averageItemBytes, 800);

  return {
    generatedAt: new Date().toISOString(),
    weekly,
    monthly,
    activity,
    categoryTotals,
    trendingTopics: buildTrendingTopics(items),
    trendingItems: buildTrendingItems(items),
    topCategories: Object.entries(categoryTotals)
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6),
    storage: {
      currentPosts: items.length,
      currentBytes: rawBytes,
      averageItemBytes,
      estimatedDailyPosts,
      estimatedMonthlyBytes,
      estimatedMonthlyMb: Number((estimatedMonthlyBytes / 1024 / 1024).toFixed(3)),
      archivePath: "data/archive/YYYY-MM.json",
    },
  };
}

function adminSummary({ leads, analytics, items }) {
  const sanitizedLeads = leads.map(sanitizeLead);
  const activeSubscribers = sanitizedLeads.filter((lead) => lead.subscribed);
  const totalEmailForwards = sanitizedLeads.reduce((sum, lead) => sum + Number(lead.emailForwardCount || 0), 0);
  const latestForward = sanitizedLeads
    .map((lead) => lead.lastEmailForwardedAt)
    .filter(Boolean)
    .sort()
    .at(-1);

  return {
    ok: true,
    counts: {
      subscribers: sanitizedLeads.length,
      activeSubscribers: activeSubscribers.length,
      totalEmailForwards,
      posts: items.length,
      analytics: analytics.length,
    },
    latestForward: latestForward || null,
    leads: sanitizedLeads.map((lead) => {
      const emailHash = crypto.createHash("sha256").update(lead.email).digest("hex").slice(0, 18);
      return {
        ...lead,
        activity: analytics
          .filter((event) => event.leadId === lead.id || event.emailHash === lead.id || event.emailHash === emailHash)
          .slice(0, 10),
      };
    }),
    recentAnalytics: analytics.slice(0, 50),
    trends: buildTrendSeries(items, analytics),
    checkedAt: new Date().toISOString(),
  };
}

async function handleAdminSummary(req, res) {
  const auth = requireAdminAuth(req, res);
  if (!auth.ok) return auth.response;
  const [items, leads, analytics] = await Promise.all([readItems(), readLeads(), readAnalytics()]);
  return json(res, 200, adminSummary({ items, leads, analytics }));
}

async function handleEmailForward(req, res) {
  const auth = requireAdminAuth(req, res);
  if (!auth.ok) return auth.response;
  const body = await readBody(req);
  const email = cleanText(body.email || "", 254).toLowerCase();
  const id = cleanText(body.id || "", 80);
  const subject = cleanText(body.subject || body.lastEmailSubject || "Daily AI Opportunity Intelligence", 180);
  const increment = Math.max(1, Number(body.count || body.increment || 1) || 1);
  if (!email && !id) return json(res, 400, { ok: false, error: "Provide subscriber email or id." });

  const leads = await readLeads();
  const index = leads.findIndex((lead) => (id && lead.id === id) || (email && String(lead.email).toLowerCase() === email));
  if (index === -1) return json(res, 404, { ok: false, error: "Subscriber not found." });

  const now = new Date().toISOString();
  const lead = {
    ...sanitizeLead(leads[index]),
    paidPasswordHash: cleanText(leads[index].paidPasswordHash || "", 240),
  };
  leads[index] = {
    ...lead,
    emailForwardCount: Number(lead.emailForwardCount || 0) + increment,
    lastEmailForwardedAt: now,
    lastEmailSubject: subject,
    updatedAt: now,
  };
  await writeLeads(leads.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)));
  await appendAnalytics({
    id: crypto.randomUUID(),
    type: "email_forward_recorded",
    leadId: leads[index].id,
    emailHash: crypto.createHash("sha256").update(leads[index].email).digest("hex").slice(0, 18),
    subject,
    increment,
    at: now,
  });
  return json(res, 200, { ok: true, lead: sanitizeLead(leads[index]) });
}

async function handleAdminSubscriberUpdate(req, res) {
  const auth = requireAdminAuth(req, res);
  if (!auth.ok) return auth.response;
  const body = await readBody(req);
  const email = cleanText(body.email || "", 254).toLowerCase();
  const id = cleanText(body.id || "", 80);
  if (!email && !id) return json(res, 400, { ok: false, error: "Provide subscriber email or id." });

  const leads = await readLeads();
  const index = leads.findIndex((lead) => (id && lead.id === id) || (email && String(lead.email).toLowerCase() === email));
  if (index === -1) return json(res, 404, { ok: false, error: "Subscriber not found." });

  const existingRaw = leads[index];
  const existing = {
    ...sanitizeLead(existingRaw),
    paidPasswordHash: cleanText(existingRaw.paidPasswordHash || "", 240),
  };
  const next = {
    ...existing,
    ...(body.name !== undefined ? { name: cleanText(body.name, 120) } : {}),
    ...(body.role !== undefined ? { role: cleanText(body.role, 80) } : {}),
    ...(body.channel !== undefined ? { channel: cleanText(body.channel, 30).toLowerCase() } : {}),
    ...(body.frequency !== undefined ? { frequency: cleanText(body.frequency, 30).toLowerCase() } : {}),
    ...(body.digestFormat !== undefined ? { digestFormat: cleanText(body.digestFormat, 30).toLowerCase() } : {}),
    ...(body.interests !== undefined ? { interests: normalizeArray(body.interests).map((interest) => cleanText(interest, 80)) } : {}),
    ...(body.subscribed !== undefined ? { subscribed: body.subscribed === true } : {}),
    ...(body.plan !== undefined ? { plan: cleanText(body.plan, 80) } : {}),
    ...(body.adminNotes !== undefined ? { adminNotes: cleanText(body.adminNotes, 1000) } : {}),
    ...(body.adminTags !== undefined ? { adminTags: normalizeArray(body.adminTags).map((tag) => cleanText(tag, 60)) } : {}),
    ...(body.bounced !== undefined ? { bounced: body.bounced === true } : {}),
    ...(body.paidAccessEnabled !== undefined ? { paidAccessEnabled: body.paidAccessEnabled === true } : {}),
    ...(body.paidUsername !== undefined ? { paidUsername: cleanText(body.paidUsername, 120) } : {}),
    updatedAt: new Date().toISOString(),
  };
  if (body.paidPassword) {
    next.paidPasswordHash = hashPassword(cleanText(body.paidPassword, 200));
    next.paidPasswordUpdatedAt = next.updatedAt;
    next.paidAccessEnabled = true;
  }

  const errors = validateLead(next);
  if (next.plan === "paid") next.plan = "paid-beta";
  if (errors.length) return json(res, 400, { ok: false, error: errors[0], errors });
  leads[index] = next;
  await writeLeads(leads.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)));
  await appendAnalytics({
    id: crypto.randomUUID(),
    type: "admin_subscriber_updated",
    leadId: next.id,
    emailHash: crypto.createHash("sha256").update(next.email).digest("hex").slice(0, 18),
    at: next.updatedAt,
  });
  return json(res, 200, { ok: true, lead: sanitizeLead(next) });
}

function paidBetaFeaturesFor(lead, items) {
  const interests = new Set((lead.interests || []).map((item) => item.toLowerCase()));
  const personalized = items
    .filter((item) => {
      const text = [item.category, item.title, item.summary, ...(item.tags || [])].join(" ").toLowerCase();
      return !interests.size || [...interests].some((interest) => text.includes(interest.replace(" papers", "").replace("ai ", "")));
    })
    .slice(0, 8);
  const sourceItems = personalized.length ? personalized : items.slice(0, 8);
  return {
    profile: {
      name: lead.name,
      email: lead.email,
      role: lead.role,
      plan: lead.plan,
      interests: lead.interests,
      paidUsername: lead.paidUsername,
    },
    features: [
      "Personalized daily AI opportunity brief",
      "Premium job, research, model, and product alerts",
      "Private copilot prompts for LinkedIn, newsletters, and client reports",
      "Early MCP connector and asset access",
      "Founder feedback channel for feature requests",
    ],
    brief: {
      title: "Paid Beta Daily Priority Brief",
      generatedAt: new Date().toISOString(),
      items: sourceItems.map(compactChatItem),
    },
    trends: buildTrendSeries(items, []),
    assets: [
      { label: "Daily digest", href: "/api/digest/daily.html" },
      { label: "Live dashboard", href: "/" },
      { label: "MCP endpoint", href: "/mcp" },
    ],
  };
}

async function handlePaidBetaLogin(req, res) {
  if (!checkRateLimit(req, res, "paid-beta-login", 20)) return;
  const body = await readBody(req);
  const username = cleanText(body.username || "", 120);
  const password = cleanText(body.password || "", 200);
  if (!username || !password) return json(res, 400, { ok: false, error: "Username and password are required." });

  const leads = await readLeads();
  const rawLead = leads.find((lead) => lead.paidUsername === username && lead.plan === "paid-beta" && lead.paidAccessEnabled === true);
  if (!rawLead || !verifyPassword(password, rawLead.paidPasswordHash)) {
    return json(res, 401, { ok: false, error: "Invalid paid beta login." });
  }

  const lead = sanitizeLead(rawLead);
  const items = await readItems();
  await appendAnalytics({
    id: crypto.randomUUID(),
    type: "paid_beta_login_success",
    leadId: lead.id,
    emailHash: crypto.createHash("sha256").update(lead.email).digest("hex").slice(0, 18),
    at: new Date().toISOString(),
  });
  return json(res, 200, { ok: true, ...paidBetaFeaturesFor(lead, items) });
}

async function handleAdminSubscriberDelete(req, res) {
  const auth = requireAdminAuth(req, res);
  if (!auth.ok) return auth.response;
  const body = await readBody(req);
  const email = cleanText(body.email || "", 254).toLowerCase();
  const id = cleanText(body.id || "", 80);
  if (!email && !id) return json(res, 400, { ok: false, error: "Provide subscriber email or id." });

  const leads = await readLeads();
  const index = leads.findIndex((lead) => (id && lead.id === id) || (email && String(lead.email).toLowerCase() === email));
  if (index === -1) return json(res, 404, { ok: false, error: "Subscriber not found." });
  const [removed] = leads.splice(index, 1);
  await writeLeads(leads.map(sanitizeLead).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)));
  await appendAnalytics({
    id: crypto.randomUUID(),
    type: "admin_subscriber_deleted",
    leadId: removed.id,
    emailHash: crypto.createHash("sha256").update(String(removed.email || "")).digest("hex").slice(0, 18),
    at: new Date().toISOString(),
  });
  return json(res, 200, { ok: true, deleted: sanitizeLead(removed) });
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
      agenticAiLiveUpdate: Boolean(N8N_LIVE_WEBHOOK_URL),
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

  if (url.pathname === "/api/trends" && req.method === "GET") {
    const [items, analytics] = await Promise.all([readItems(), readAnalytics()]);
    return json(res, 200, { ok: true, ...buildTrendSeries(items, analytics) });
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
    const auth = requireAdminAuth(req, res);
    if (!auth.ok) return auth.response;
    const csv = leadsToCsv(await readLeads());
    return send(res, 200, csv, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"ai-signaldesk-leads.csv\"",
    });
  }

  if (url.pathname === "/api/admin/summary" && req.method === "GET") {
    return handleAdminSummary(req, res);
  }

  if (url.pathname === "/api/admin/email-forward" && req.method === "POST") {
    return handleEmailForward(req, res);
  }

  if (url.pathname === "/api/admin/subscriber" && req.method === "PATCH") {
    return handleAdminSubscriberUpdate(req, res);
  }

  if (url.pathname === "/api/admin/subscriber" && req.method === "DELETE") {
    return handleAdminSubscriberDelete(req, res);
  }

  if (url.pathname === "/api/paid-beta/login" && req.method === "POST") {
    return handlePaidBetaLogin(req, res);
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
        <p class="creator-credit">Created by Dr. Ananjan Maiti</p>
      </div>
      <a class="nav-button" href="/">All posts</a>
    </header>
    <main class="post-layout">
      ${imageMarkup}
      <article class="post-article">
        <div class="alert-meta">
          <span>${escapeHtml(item.company || "Curated by agentic AI")}</span>
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
  const requested =
    url.pathname === "/"
      ? "/index.html"
      : url.pathname === "/admin"
        ? "/admin.html"
        : url.pathname === "/paid-beta"
          ? "/paid-beta.html"
          : url.pathname === "/paid-login"
            ? "/paid-login.html"
          : decodeURIComponent(url.pathname);
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
  logInfo("agentic AI daily POST endpoint ready", {
    endpoint: "/api/posts/daily",
    webhookProtected: Boolean(WEBHOOK_TOKEN),
  });
});
