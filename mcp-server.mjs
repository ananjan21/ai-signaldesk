import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { z } from "zod";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, "data");
const PUBLIC_DIR = path.join(ROOT, "public");
const ASSETS_DIR = path.join(PUBLIC_DIR, "assets");
const NEWS_FILE = path.join(DATA_DIR, "news.json");
const LEADS_FILE = path.join(DATA_DIR, "leads.json");

const PORT = Number(process.env.MCP_PORT || 4174);
const WEB_BASE_URL = (process.env.AI_SIGNALDESK_PUBLIC_URL || `http://localhost:${process.env.PORT || 4173}`).replace(
  /\/$/,
  "",
);
const MCP_TOKEN = process.env.MCP_TOKEN || process.env.WEBHOOK_TOKEN || "";
const MCP_HOST = process.env.MCP_HOST || "0.0.0.0";
const MCP_ALLOWED_HOSTS = csvList(
  process.env.MCP_ALLOWED_HOSTS ||
    `localhost,127.0.0.1,localhost:${PORT},127.0.0.1:${PORT},187.127.189.102,187.127.189.102:${PORT},srv1800336.hstgr.cloud,srv1800336.hstgr.cloud:${PORT}`,
);

const CATEGORY_ALIASES = {
  news: "News",
  updates: "Updates",
  jobs: "Jobs",
  job: "Jobs",
  research: "Research",
  paper: "Research",
  papers: "Research",
  startup: "Startup News",
  startups: "Startup News",
  funding: "Funding",
  tools: "AI Products",
  "ai products": "AI Products",
  products: "AI Products",
  prompts: "Prompts",
  "image prompts": "Image Prompts",
};

function canonicalCategory(value = "") {
  const key = String(value).trim().toLowerCase();
  return CATEGORY_ALIASES[key] || String(value || "News").trim() || "News";
}

function csvList(value = "") {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function readJsonArray(file) {
  const raw = await fs.readFile(file, "utf8");
  const parsed = JSON.parse(raw || "[]");
  return Array.isArray(parsed) ? parsed : [];
}

async function readItems() {
  const items = await readJsonArray(NEWS_FILE);
  return items.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
}

async function readLeads() {
  return readJsonArray(LEADS_FILE);
}

function compactItem(item) {
  return {
    id: item.id,
    title: item.title,
    source: item.company,
    category: item.category,
    fitScore: item.fitScore,
    publishedAt: item.publishedAt,
    summary: item.summary,
    link: item.link,
    tags: item.tags || [],
  };
}

function filterItems(items, { query = "", category = "", limit = 10, minScore = 0 } = {}) {
  const q = String(query || "").trim().toLowerCase();
  const wantedCategory = category ? canonicalCategory(category) : "";
  return items
    .filter((item) => {
      const text = [item.title, item.company, item.category, item.summary, item.content, ...(item.tags || [])]
        .join(" ")
        .toLowerCase();
      const score = Number(item.fitScore || 0);
      return (!q || text.includes(q)) && (!wantedCategory || item.category === wantedCategory) && score >= minScore;
    })
    .slice(0, Math.max(1, Math.min(Number(limit) || 10, 50)));
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

function renderDailyDigestHtml(items) {
  const topItems = items.slice(0, 24);
  const counts = digestCounts(topItems);
  const countLine = ["Jobs", "Research", "AI Products", "Prompts", "Image Prompts"]
    .map((category) => `${category}: ${counts[category] || 0}`)
    .join(" | ");
  const sections = groupDigestItems(topItems)
    .map(
      ([category, groupItems]) => `<h2>${escapeHtml(category)}</h2>
${groupItems
  .slice(0, 5)
  .map(
    (item) => `<article>
  <strong>${escapeHtml(item.title)}</strong>
  <p>${escapeHtml(item.summary || "No summary was provided.")}</p>
  ${item.link ? `<a href="${escapeHtml(item.link)}">Open source</a>` : ""}
</article>`,
  )
  .join("\n")}`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Daily AI Opportunity Intelligence</title></head>
  <body>
    <h1>Daily AI Opportunity Intelligence</h1>
    <p>${escapeHtml(formatEmailDate())} | ${escapeHtml(countLine)}</p>
    ${sections || "<p>No digest items are available yet.</p>"}
  </body>
</html>`;
}

async function walkAssets(dir = ASSETS_DIR) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkAssets(absolutePath)));
    } else {
      const stats = await fs.stat(absolutePath);
      const relativePath = path.relative(PUBLIC_DIR, absolutePath).replaceAll("\\", "/");
      files.push({
        name: path.basename(absolutePath),
        relativePath,
        filePath: absolutePath,
        webUrl: `${WEB_BASE_URL}/${relativePath}`,
        bytes: stats.size,
        mimeType: mimeTypeFor(absolutePath),
      });
    }
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function mimeTypeFor(file) {
  const ext = path.extname(file).toLowerCase();
  return (
    {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".json": "application/json",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }[ext] || "application/octet-stream"
  );
}

function textResult(data) {
  return {
    content: [
      {
        type: "text",
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function isInside(basePath, candidatePath) {
  const relative = path.relative(basePath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function unauthorizedResult() {
  return {
    isError: true,
    content: [{ type: "text", text: "Unauthorized. Set MCP_TOKEN or WEBHOOK_TOKEN and pass the same token." }],
  };
}

function tokenIsValid(token) {
  return Boolean(MCP_TOKEN) && token === MCP_TOKEN;
}

async function buildServer() {
  const server = new McpServer({
    name: "ai-signaldesk",
    version: "1.0.0",
  });

  server.registerResource(
    "feed",
    "ai-signaldesk://feed",
    {
      title: "AI SignalDesk Feed",
      description: "Current normalized AI opportunity feed from data/news.json.",
      mimeType: "application/json",
    },
    async (uri) => {
      const items = await readItems();
      return {
        contents: [{ uri: String(uri), mimeType: "application/json", text: JSON.stringify(items.map(compactItem), null, 2) }],
      };
    },
  );

  server.registerResource(
    "daily-digest",
    "ai-signaldesk://digest/daily",
    {
      title: "Daily Digest",
      description: "Email-ready daily digest payload with subject, text, HTML, counts, and compact feed items.",
      mimeType: "application/json",
    },
    async (uri) => {
      const items = (await readItems()).slice(0, 24);
      const payload = {
        subject: `Daily AI Opportunity Intelligence - ${formatEmailDate()}`,
        preheader: "Jobs, research, products, prompts, and visual marketing trends worth acting on.",
        html: renderDailyDigestHtml(items),
        text: renderDailyDigestText(items),
        counts: digestCounts(items),
        items: items.map(compactItem),
      };
      return { contents: [{ uri: String(uri), mimeType: "application/json", text: JSON.stringify(payload, null, 2) }] };
    },
  );

  server.registerResource(
    "asset-manifest",
    "ai-signaldesk://assets/manifest",
    {
      title: "Asset Manifest",
      description: "All public AI SignalDesk assets with local paths and web URLs.",
      mimeType: "application/json",
    },
    async (uri) => {
      const assets = await walkAssets();
      return { contents: [{ uri: String(uri), mimeType: "application/json", text: JSON.stringify({ assets }, null, 2) }] };
    },
  );

  server.registerTool(
    "search_signals",
    {
      title: "Search Signals",
      description: "Search AI SignalDesk opportunities by keyword, category, score, and limit.",
      inputSchema: {
        query: z.string().optional().describe("Keyword to search in title, summary, content, source, category, and tags."),
        category: z.string().optional().describe("Optional category such as Jobs, Research, AI Products, Prompts, or News."),
        minScore: z.number().min(0).max(100).optional().describe("Minimum fit score from 0 to 100."),
        limit: z.number().int().min(1).max(50).optional().describe("Maximum number of results."),
      },
    },
    async ({ query = "", category = "", minScore = 0, limit = 10 }) => {
      const items = filterItems(await readItems(), { query, category, minScore, limit }).map(compactItem);
      return textResult({ count: items.length, items });
    },
  );

  server.registerTool(
    "get_top_opportunities",
    {
      title: "Get Top Opportunities",
      description: "Return the highest-scoring current opportunities, optionally filtered by category.",
      inputSchema: {
        category: z.string().optional().describe("Optional category filter."),
        limit: z.number().int().min(1).max(50).optional().describe("Maximum number of results."),
      },
    },
    async ({ category = "", limit = 10 }) => {
      const items = filterItems(await readItems(), { category, limit: 50 })
        .sort((a, b) => Number(b.fitScore || 0) - Number(a.fitScore || 0))
        .slice(0, limit)
        .map(compactItem);
      return textResult({ count: items.length, items });
    },
  );

  server.registerTool(
    "get_daily_digest",
    {
      title: "Get Daily Digest",
      description: "Return the daily email digest payload. Use html for email clients or text for plain text.",
      inputSchema: {
        format: z.enum(["json", "html", "text"]).optional().describe("Response format."),
      },
    },
    async ({ format = "json" }) => {
      const items = (await readItems()).slice(0, 24);
      const payload = {
        subject: `Daily AI Opportunity Intelligence - ${formatEmailDate()}`,
        preheader: "Jobs, research, products, prompts, and visual marketing trends worth acting on.",
        html: renderDailyDigestHtml(items),
        text: renderDailyDigestText(items),
        counts: digestCounts(items),
        items: items.map(compactItem),
      };
      if (format === "html") return textResult(payload.html);
      if (format === "text") return textResult(payload.text);
      return textResult(payload);
    },
  );

  server.registerTool(
    "list_sources",
    {
      title: "List Sources",
      description: "List source platforms and domains currently represented in the feed.",
      inputSchema: {},
    },
    async () => {
      const items = await readItems();
      const domains = [...new Set(items.map((item) => safeHostname(item.link)).filter(Boolean))].sort();
      const sourceLabels = [...new Set(items.map((item) => item.company).filter(Boolean))].sort();
      return textResult({
        workflowSources: ["Remotive", "Hacker News / Algolia", "OpenAlex", "GitHub", "DEV Community", "Hugging Face", "Semantic Scholar", "arXiv"],
        currentFeedDomains: domains,
        currentFeedSourceLabels: sourceLabels,
      });
    },
  );

  server.registerTool(
    "get_asset_manifest",
    {
      title: "Get Asset Manifest",
      description: "Return available public assets, including category covers, state illustrations, hero images, and document templates.",
      inputSchema: {
        kind: z.enum(["all", "categories", "states", "hero", "documents"]).optional().describe("Optional asset group."),
      },
    },
    async ({ kind = "all" }) => {
      const assets = await walkAssets();
      const filtered = assets.filter((asset) => {
        if (kind === "all") return true;
        if (kind === "categories") return asset.relativePath.startsWith("assets/categories/");
        if (kind === "states") return asset.relativePath.startsWith("assets/states/");
        if (kind === "hero") return asset.relativePath.includes("hero-");
        if (kind === "documents") return asset.relativePath.endsWith(".docx");
        return true;
      });
      return textResult({ count: filtered.length, assets: filtered });
    },
  );

  server.registerTool(
    "get_asset",
    {
      title: "Get Asset",
      description: "Return metadata for a specific public asset, with optional base64 content for small assets.",
      inputSchema: {
        relativePath: z.string().describe("Path like assets/categories/category-news.webp."),
        includeBase64: z.boolean().optional().describe("Include base64 file content. Refuses files over 1 MB."),
      },
    },
    async ({ relativePath, includeBase64 = false }) => {
      const normalized = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
      const filePath = path.resolve(PUBLIC_DIR, normalized);
      if (!isInside(PUBLIC_DIR, filePath)) {
        return { isError: true, content: [{ type: "text", text: "Asset path is outside public directory." }] };
      }
      const stats = await fs.stat(filePath);
      const payload = {
        name: path.basename(filePath),
        relativePath: path.relative(PUBLIC_DIR, filePath).replaceAll("\\", "/"),
        filePath,
        webUrl: `${WEB_BASE_URL}/${path.relative(PUBLIC_DIR, filePath).replaceAll("\\", "/")}`,
        bytes: stats.size,
        mimeType: mimeTypeFor(filePath),
      };
      if (includeBase64) {
        if (stats.size > 1024 * 1024) {
          return { isError: true, content: [{ type: "text", text: "Asset is larger than 1 MB; use filePath or webUrl instead." }] };
        }
        payload.base64 = await fs.readFile(filePath, "base64");
      }
      return textResult(payload);
    },
  );

  server.registerTool(
    "get_email_subscribers",
    {
      title: "Get Email Subscribers",
      description: "Return subscriber records for sending digests. Requires token argument matching MCP_TOKEN or WEBHOOK_TOKEN.",
      inputSchema: {
        token: z.string().describe("MCP_TOKEN or WEBHOOK_TOKEN value."),
        subscribedOnly: z.boolean().optional().describe("Only include active subscribers."),
      },
    },
    async ({ token, subscribedOnly = true }) => {
      if (!tokenIsValid(token)) return unauthorizedResult();
      const leads = await readLeads();
      const filtered = subscribedOnly ? leads.filter((lead) => lead.subscribed !== false) : leads;
      return textResult({ count: filtered.length, subscribers: filtered });
    },
  );

  server.registerTool(
    "trigger_live_update",
    {
      title: "Trigger Live Update",
      description: "Trigger the web app live-update endpoint, if configured. Requires token when MCP_TOKEN or WEBHOOK_TOKEN is set.",
      inputSchema: {
        token: z.string().optional().describe("MCP_TOKEN or WEBHOOK_TOKEN value, if configured."),
      },
    },
    async ({ token = "" }) => {
      if (MCP_TOKEN && !tokenIsValid(token)) return unauthorizedResult();
      const response = await fetch(`${WEB_BASE_URL}/api/live-update`, { method: "POST" });
      const text = await response.text();
      let payload = text;
      try {
        payload = JSON.parse(text);
      } catch {
        // Keep non-JSON response text.
      }
      return textResult({ status: response.status, ok: response.ok, response: payload });
    },
  );

  return server;
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

async function runStdio() {
  const server = await buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("AI SignalDesk MCP server running on stdio.");
}

async function runHttp() {
  const app = createMcpExpressApp({ host: MCP_HOST, allowedHosts: MCP_ALLOWED_HOSTS });
  app.post("/mcp", async (req, res) => {
    const server = await buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        transport.close();
        server.close();
      });
    } catch (error) {
      console.error("MCP request failed:", error);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });
  app.get("/mcp", (_req, res) => {
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  });
  app.delete("/mcp", (_req, res) => {
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  });
  app.listen(PORT, MCP_HOST, () => {
    console.error(`AI SignalDesk MCP HTTP server running at http://${MCP_HOST}:${PORT}/mcp`);
  });
}

const mode = process.argv.includes("--http") ? "http" : "stdio";
if (mode === "http") {
  runHttp().catch((error) => {
    console.error("MCP HTTP server failed:", error);
    process.exit(1);
  });
} else {
  runStdio().catch((error) => {
    console.error("MCP stdio server failed:", error);
    process.exit(1);
  });
}
