const feed = document.querySelector("#alertFeed");
const spotlight = document.querySelector("#spotlightPost");
const searchInput = document.querySelector("#searchInput");
const categoryFilter = document.querySelector("#categoryFilter");
const fitFilter = document.querySelector("#fitFilter");
const refreshButton = document.querySelector("#refreshButton");
const liveUpdateButton = document.querySelector("#liveUpdateButton");
const dailyBriefButton = document.querySelector("#dailyBriefButton");
const paidBetaButton = document.querySelector("#paidBetaButton");
const paidBetaInterest = document.querySelector("#paidBetaInterest");
const emptyTemplate = document.querySelector("#emptyTemplate");
const categoryButtons = [...document.querySelectorAll(".category-button")];
const mixButtons = [...document.querySelectorAll(".mix-card")];
const outputModeButtons = [...document.querySelectorAll(".output-mode-button")];
const leadForm = document.querySelector("#leadForm");
const leadStatus = document.querySelector("#leadStatus");
const tickerText = document.querySelector("#tickerText");
const chatForm = document.querySelector("#chatForm");
const chatInput = document.querySelector("#chatInput");
const chatMessages = document.querySelector("#chatMessages");
const chatStatus = document.querySelector("#chatStatus");
const chatSendButton = document.querySelector("#chatSendButton");
const chatSuggestions = document.querySelector("#chatSuggestions");
const exportChatButton = document.querySelector("#exportChatButton");
const chatDockButton = document.querySelector("#chatDockButton");
const closeChatDockButton = document.querySelector("#closeChatDockButton");
const promptQueueList = document.querySelector("#promptQueueList");
const clearQueueButton = document.querySelector("#clearQueueButton");
const contextButtons = [...document.querySelectorAll(".category-snapshot button")];
const briefingDate = document.querySelector("#briefingDate");
const contextLeadCategory = document.querySelector("#contextLeadCategory");
const contextLeadTitle = document.querySelector("#contextLeadTitle");
const contextLeadSummary = document.querySelector("#contextLeadSummary");
const signalRail = document.querySelector("#signalRail");
const contextPanel = document.querySelector(".context-panel");
const contextEmptyState = document.querySelector("#contextEmptyState");
const digestPreviewBody = document.querySelector("#digestPreviewBody");
const digestEmptyState = document.querySelector("#digestEmptyState");
const syncState = document.querySelector("#syncState");
const syncStateMessage = document.querySelector("#syncStateMessage");
const chatSetupState = document.querySelector("#chatSetupState");

function trackEvent(type, payload = {}) {
  fetch("/api/analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type,
      path: window.location.pathname,
      ...payload,
    }),
  }).catch(() => {});
}

const state = {
  items: [],
  query: "",
  category: "all",
  fit: "all",
  chat: [
    {
      role: "assistant",
      content: "Ask me to compare today's AI jobs, papers, tools, or startup signals.",
      sources: [],
    },
  ],
  suggestions: ["Compare today's top 3 items", "Show best research opportunities", "Create a 5-minute action plan"],
  promptQueue: [],
  processingChat: false,
};

const sampleItems = [
  {
    id: "sample-ai-daily-brief",
    title: "Daily AI Brief: Research, Jobs, Startups",
    company: "Agentic AI preview",
    location: "Remote / Global",
    category: "News",
    fitScore: 92,
    publishedAt: new Date().toISOString(),
    summary: "A preview item showing how daily news, research, job, and startup signals will appear after the agentic AI sync publishes.",
    content:
      "This is a sample daily post. The agentic AI sync can post to /api/posts/daily.\n\nThe same endpoint can receive multiple categories: News, Updates, Jobs, Research, Startup News, Funding, Tools, or any custom label your automation generates.",
    tags: ["Daily Brief", "AI", "agentic-ai"],
    link: "",
    imageUrl: "",
  },
];

const preferredCategories = ["News", "Updates", "AI Products", "Prompts", "Image Prompts", "Jobs", "Research", "Startup News"];

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

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function isToday(value) {
  const date = new Date(value);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function scoreClass(score) {
  if (score >= 80) return "high";
  if (score >= 60) return "medium";
  return "low";
}

function textMatch(item, query) {
  if (!query) return true;
  const haystack = [
    item.title,
    item.company,
    item.location,
    item.category,
    item.summary,
    item.content,
    ...(item.tags || []),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function filteredItems() {
  return state.items.filter((item) => {
    const itemCategory = canonicalCategory(item.category);
    const categoryOk = state.category === "all" || itemCategory === state.category;
    const fitOk = state.fit === "all" || Number(item.fitScore || 0) >= Number(state.fit);
    return categoryOk && fitOk && textMatch(item, state.query);
  });
}

function categoryCounts(items = state.items) {
  return items.reduce((bucket, item) => {
    const category = canonicalCategory(item.category);
    bucket[category] = (bucket[category] || 0) + 1;
    return bucket;
  }, {});
}

function updateCategoryControls(counts = categoryCounts()) {
  for (const button of categoryButtons) {
    const category = button.dataset.category;
    button.hidden = category !== "all" && !counts[category];
  }

  for (const button of contextButtons) {
    button.hidden = !counts[button.dataset.category];
  }

  for (const button of mixButtons) {
    button.hidden = !counts[button.dataset.category];
  }
}

function updateMetrics(items) {
  document.querySelector("#totalAlerts").textContent = state.items.length;
  document.querySelector("#todayAlerts").textContent = state.items.filter((item) => isToday(item.publishedAt)).length;
  document.querySelector("#highFitAlerts").textContent = state.items.filter((item) => Number(item.fitScore || 0) >= 80).length;
  document.querySelector("#lastUpdate").textContent = state.items[0] ? formatDate(state.items[0].receivedAt || state.items[0].publishedAt) : "-";
  document.querySelector("#resultCount").textContent = `${items.length} result${items.length === 1 ? "" : "s"}`;
  document.querySelector("#heroTotalSignals").textContent = state.items.length;
  document.querySelector("#heroTodaySignals").textContent = state.items.filter((item) => isToday(item.publishedAt)).length;
  document.querySelector("#heroHighSignals").textContent = state.items.filter((item) => Number(item.fitScore || 0) >= 80).length;
  updateContextPanel();
}

function updateContextPanel() {
  const counts = categoryCounts();
  updateCategoryControls(counts);

  document.querySelector("#contextTotal").textContent = `${state.items.length} live item${state.items.length === 1 ? "" : "s"}`;
  document.querySelector("#contextNews").textContent = counts.News || 0;
  document.querySelector("#contextUpdates").textContent = counts.Updates || 0;
  document.querySelector("#contextProducts").textContent = counts["AI Products"] || 0;
  document.querySelector("#contextPrompts").textContent = counts.Prompts || 0;
  document.querySelector("#contextImagePrompts").textContent = counts["Image Prompts"] || 0;
  document.querySelector("#contextJobs").textContent = counts.Jobs || 0;
  document.querySelector("#contextResearch").textContent = counts.Research || 0;
  document.querySelector("#mixJobs").textContent = counts.Jobs || 0;
  document.querySelector("#mixResearch").textContent = counts.Research || 0;
  document.querySelector("#mixProducts").textContent = counts["AI Products"] || 0;
  document.querySelector("#mixPrompts").textContent = counts.Prompts || 0;
  document.querySelector("#mixImagePrompts").textContent = counts["Image Prompts"] || 0;
  document.querySelector("#contextLastSync").textContent = state.items[0]
    ? formatDate(state.items[0].receivedAt || state.items[0].publishedAt)
    : "Waiting";

  const leadCategories = new Set(["News", "AI Products", "Startup News", "Updates"]);
  const leadCandidates = state.items.filter((item) => leadCategories.has(canonicalCategory(item.category)));
  const leadingItem = [...(leadCandidates.length ? leadCandidates : state.items)].sort(
    (left, right) => Number(right.fitScore || 0) - Number(left.fitScore || 0),
  )[0];
  if (leadingItem) {
    contextLeadCategory.textContent = `${canonicalCategory(leadingItem.category)} - ${leadingItem.fitScore || "New"}${leadingItem.fitScore ? "% priority" : ""}`;
    contextLeadTitle.textContent = leadingItem.title;
    contextLeadTitle.href = `/post/${encodeURIComponent(leadingItem.id)}`;
    contextLeadSummary.textContent = leadingItem.summary || "Open the signal for the full business context and next action.";
  }

  signalRail.replaceChildren();
  const rankedSignals = [...state.items]
    .sort((left, right) => Number(right.fitScore || 0) - Number(left.fitScore || 0))
    .slice(0, 3);
  rankedSignals.forEach((item, index) => {
    const row = document.createElement("article");
    const rank = document.createElement("span");
    const link = document.createElement("a");
    const score = document.createElement("strong");
    rank.textContent = String(index + 1).padStart(2, "0");
    link.href = `/post/${encodeURIComponent(item.id)}`;
    link.textContent = item.title;
    score.textContent = item.fitScore ? `${item.fitScore}` : "New";
    row.append(rank, link, score);
    signalRail.append(row);
  });
}

function populateCategories() {
  const discovered = state.items.map((item) => canonicalCategory(item.category)).filter(Boolean);
  const counts = categoryCounts();
  const categories = [...new Set([...preferredCategories, ...discovered])].filter((category) => counts[category] > 0);
  const current = categoryFilter.value;
  categoryFilter.innerHTML = '<option value="all">All categories</option>';

  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    categoryFilter.append(option);
  }

  categoryFilter.value = categories.includes(current) ? current : "all";
  state.category = categoryFilter.value;
  updateCategoryControls(counts);
}

function setCategory(category) {
  state.category = category;
  categoryFilter.value = category;
  for (const button of categoryButtons) {
    button.classList.toggle("active", button.dataset.category === category);
  }
  trackEvent("category_filter", { label: category });
  render();
}

function appendMeta(meta, values) {
  for (const value of values) {
    const span = document.createElement("span");
    span.textContent = value;
    meta.append(span);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function stripMarkupNoise(value) {
  const cleaned = String(value ?? "")
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<\s*li\b[^>]*>/gi, "- ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[[^\]]*(?:&|:)[^\]]+\]:[a-z0-9-]+/gi, " ")
    .replace(/\[[^\]]*(?:&|:)[^\]]+\]/g, " ")
    .replace(/--tw-[a-z0-9-]+:\s*[^;]+;?/gi, " ")
    .replace(/\b(?:class|style|data-[\w-]+|aria-[\w-]+)=['"][^'"]*['"]/gi, " ")
    .replace(/\b(?:oklch|rgb|rgba|hsl|hsla)\([^)]*\)/gi, " ")
    .replace(/scrollbar-(?:color|width):\s*[^;]+;?/gi, " ")
    .replace(/[{}]/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned
    .split(/\r?\n/)
    .filter((line, index, lines) => line.trim() || lines[index - 1]?.trim())
    .filter((line, index, lines) => line.trim().toLowerCase() !== lines[index - 1]?.trim().toLowerCase())
    .join("\n")
    .trim();
}

function isMarkdownTableSeparator(line) {
  const cells = line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function markdownTableToHtml(lines) {
  const header = lines[0]
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
  const rows = lines.slice(2).map((line) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim()),
  );

  return `<div class="chat-table-wrap"><table class="chat-table"><thead><tr>${header
    .map((cell) => `<th>${escapeHtml(cell)}</th>`)
    .join("")}</tr></thead><tbody>${rows
    .map(
      (row) =>
        `<tr>${header
          .map((_, index) => `<td>${escapeHtml(row[index] || "")}</td>`)
          .join("")}</tr>`,
    )
    .join("")}</tbody></table></div>`;
}

function renderMarkdownTables(value) {
  const lines = stripMarkupNoise(value).split(/\r?\n/);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    const next = lines[index + 1];
    if (current?.includes("|") && next && isMarkdownTableSeparator(next)) {
      const tableLines = [current, next];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        tableLines.push(lines[index]);
        index += 1;
      }
      index -= 1;
      blocks.push(markdownTableToHtml(tableLines));
    } else {
      blocks.push(escapeHtml(current));
    }
  }
  return blocks.join("\n");
}

function renderRichText(value) {
  let html = renderMarkdownTables(value);
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
  );
  html = html.replace(
    /(^|[\s(])(https?:\/\/[^\s<)]+)/g,
    '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>',
  );
  html = html.replace(/^### (.+)$/gm, "<strong>$1</strong>");
  html = html.replace(/^\d+\.\s+/gm, "");
  html = html.replace(/^- /gm, "- ");
  return html;
}

function renderTags(item) {
  const tags = document.createElement("div");
  tags.className = "tags";
  for (const tag of item.tags || []) {
    const chip = document.createElement("span");
    chip.className = "tag";
    chip.textContent = tag;
    tags.append(chip);
  }
  return tags;
}

function renderActions(item) {
  const actions = document.createElement("div");
  actions.className = "card-actions";

  const readPost = document.createElement("a");
  readPost.className = "read-link";
  readPost.href = `/post/${encodeURIComponent(item.id)}`;
  readPost.textContent = "View brief";
  readPost.addEventListener("click", () => trackEvent("post_view", { label: item.id }));
  actions.append(readPost);

  if (item.link) {
    const source = document.createElement("a");
    source.className = "source-link";
    source.href = item.link;
    source.target = "_blank";
    source.rel = "noreferrer";
    source.textContent = "Source";
    actions.append(source);
  }

  return actions;
}

function bestForLabel(item) {
  const tags = item.tags || [];
  if (tags.some((tag) => /job|career|remote|intern/i.test(tag))) return "Best for job seekers";
  if (tags.some((tag) => /paper|research|llm|model/i.test(tag))) return "Best for researchers";
  if (tags.some((tag) => /image|visual|creative|brand/i.test(tag))) return "Best for visual marketers";
  if (tags.some((tag) => /prompt|prompting/i.test(tag))) return "Best for prompt testing";
  if (tags.some((tag) => /product|tool|launch|api|sdk/i.test(tag))) return "Best for builders";
  if (tags.some((tag) => /grant|funding|startup/i.test(tag))) return "Best for builders";
  return "Best for AI learners";
}

function categoryCode(category) {
  const codes = {
    News: "NW",
    Updates: "UP",
    "AI Products": "AI",
    Prompts: "PR",
    "Image Prompts": "IM",
    Jobs: "JB",
    Research: "RX",
    "Startup News": "ST",
  };
  return codes[category] || "SG";
}

const categoryCoverImages = {
  News: "/assets/categories/category-news.webp",
  Updates: "/assets/categories/category-updates.webp",
  "AI Products": "/assets/categories/category-ai-products.webp",
  Prompts: "/assets/categories/category-prompts.webp",
  "Image Prompts": "/assets/categories/category-image-prompts.webp",
  Jobs: "/assets/categories/category-jobs.webp",
  Research: "/assets/categories/category-research.webp",
  "Startup News": "/assets/categories/category-startup-news.webp",
};

function categoryCover(category) {
  return categoryCoverImages[category] || categoryCoverImages.News;
}

function sourceLabel(item) {
  return item.publisher || item.company || "Curated by agentic AI";
}

function renderCardVisual(item) {
  const category = canonicalCategory(item.category);
  const visual = document.createElement("div");
  visual.className = "card-visual";
  visual.dataset.category = category;

  const fallbackImage = categoryCover(category);
  const image = document.createElement("img");
  image.src = item.imageUrl || fallbackImage;
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  image.addEventListener("error", () => {
    if (image.src.endsWith(fallbackImage)) {
      image.remove();
      visual.classList.remove("has-image");
      return;
    }
    image.src = fallbackImage;
  });
  visual.classList.add("has-image");
  visual.append(image);

  const code = document.createElement("strong");
  code.textContent = categoryCode(category);
  const bars = document.createElement("span");
  bars.className = "visual-bars";
  bars.setAttribute("aria-hidden", "true");
  bars.innerHTML = "<i></i><i></i><i></i><i></i>";
  const label = document.createElement("small");
  label.textContent = category;
  visual.append(code, bars, label);
  return visual;
}

function itemText(item) {
  return [item.title, item.summary, item.content, ...(item.tags || [])].join(" ").toLowerCase();
}

function pickByText(item, options) {
  const text = itemText(item);
  const match = options.find((option) => option.keywords.some((keyword) => text.includes(keyword)));
  return match ? match.value : options[0].value;
}

function imagePromptDetails(item) {
  const useCase = pickByText(item, [
    { value: "landing hero", keywords: ["landing", "hero", "website", "homepage"] },
    { value: "ad", keywords: ["ad", "advertising", "campaign", "conversion"] },
    { value: "thumbnail", keywords: ["thumbnail", "youtube", "video"] },
    { value: "product mockup", keywords: ["product", "mockup", "saas", "app"] },
    { value: "carousel", keywords: ["carousel", "linkedin", "instagram", "thread"] },
  ]);
  const style = pickByText(item, [
    { value: "premium editorial with crisp product lighting", keywords: ["brand", "premium", "editorial"] },
    { value: "cinematic launch visual with high-contrast composition", keywords: ["launch", "news", "trend"] },
    { value: "clean SaaS product mockup with realistic UI depth", keywords: ["product", "tool", "saas", "app"] },
    { value: "bold social carousel visual with clear focal hierarchy", keywords: ["carousel", "social", "linkedin"] },
    { value: "modern marketing image with sharp detail and usable copy space", keywords: ["image", "visual", "creative"] },
  ]);
  const model = pickByText(item, [
    { value: "Flux", keywords: ["text", "poster", "ad", "typography", "brand"] },
    { value: "Midjourney", keywords: ["cinematic", "editorial", "premium", "mood"] },
    { value: "DALL-E", keywords: ["mockup", "product", "clean", "website"] },
    { value: "SDXL", keywords: ["batch", "variant", "style", "template"] },
  ]);
  const promptIdea = `Create a ${style} for a ${useCase} about "${item.title}". Keep the subject specific, composition polished, and leave practical negative space for marketing copy.`;

  return { promptIdea, useCase, style, model };
}

function askChatbot(prompt) {
  document.querySelector("#aiChat").scrollIntoView({ behavior: "smooth", block: "start" });
  enqueueChatPrompt(prompt);
}

function renderImagePromptBrief(item) {
  const details = imagePromptDetails(item);
  const panel = document.createElement("div");
  panel.className = "image-prompt-brief";

  const heading = document.createElement("strong");
  heading.textContent = "Premium visual asset";

  const specs = document.createElement("dl");
  specs.className = "creative-specs";
  const rows = [
    ["Prompt idea", details.promptIdea],
    ["Best use case", details.useCase],
    ["Suggested style", details.style],
    ["Model suggestion", details.model],
  ];

  for (const [label, value] of rows) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    specs.append(term, description);
  }

  const campaignButton = document.createElement("button");
  campaignButton.className = "campaign-button";
  campaignButton.type = "button";
  campaignButton.textContent = "Ask chatbot to expand this into a campaign";
  campaignButton.addEventListener("click", () => {
    askChatbot(
      `Expand this Image Prompts item into a professional visual marketing campaign:\n\nTitle: ${item.title}\nPrompt idea: ${details.promptIdea}\nBest use case: ${details.useCase}\nSuggested style: ${details.style}\nModel suggestion: ${details.model}\n\nGive me campaign angles, 3 creative prompts, copy hooks, channels, and source links from the feed.`,
    );
  });

  panel.append(heading, specs, campaignButton);
  return panel;
}

function renderSpotlight(items) {
  spotlight.replaceChildren();
  const item = items[0] || state.items[0];
  document.querySelector("#spotlightDate").textContent = item ? formatDate(item.publishedAt) : "Waiting for agentic AI";

  if (!item) {
    spotlight.className = "spotlight-post empty";
    const empty = emptyTemplate.content.cloneNode(true);
    empty.querySelector("img")?.remove();
    spotlight.append(empty);
    return;
  }

  spotlight.className = "spotlight-post";

  const content = document.createElement("div");
  const title = document.createElement("a");
  title.className = "spotlight-title";
  title.href = `/post/${encodeURIComponent(item.id)}`;
  title.textContent = item.title;

  const meta = document.createElement("div");
  meta.className = "alert-meta";
  appendMeta(meta, [
    item.company || "Curated by agentic AI",
    item.location || "Remote / Global",
    canonicalCategory(item.category),
    formatDate(item.publishedAt),
  ]);

  const summary = document.createElement("p");
  summary.className = "spotlight-summary";
  summary.textContent = item.summary || "No summary was provided by the workflow.";

  content.append(title, meta, summary, renderTags(item), renderActions(item));

  const panel = document.createElement("aside");
  panel.className = "spotlight-panel";

  const number = document.createElement("div");
  number.className = "panel-number";
  number.textContent = item.fitScore ? `${item.fitScore}%` : "Live";

  const label = document.createElement("div");
  label.className = "panel-label";
  label.textContent = bestForLabel(item);

  panel.append(number, label);
  spotlight.append(content, panel);
}

function renderCard(item) {
  const article = document.createElement("article");
  article.className = "alert-card";
  article.dataset.category = canonicalCategory(item.category);

  const visual = renderCardVisual(item);
  const content = document.createElement("div");
  content.className = "card-content";
  const kicker = document.createElement("div");
  kicker.className = "card-kicker";
  const category = document.createElement("span");
  category.textContent = canonicalCategory(item.category);
  const publisher = document.createElement("strong");
  publisher.textContent = sourceLabel(item);
  kicker.append(category, publisher);
  const title = document.createElement("a");
  title.className = "alert-title";
  title.textContent = item.title;
  title.href = `/post/${encodeURIComponent(item.id)}`;

  const meta = document.createElement("div");
  meta.className = "alert-meta";
  appendMeta(meta, [
    item.location || "Remote / Global",
    formatDate(item.publishedAt),
  ]);

  const summary = document.createElement("p");
  summary.className = "alert-summary";
  summary.textContent = item.summary || "No summary was provided by the workflow.";

  const bestFor = document.createElement("p");
  bestFor.className = "best-for";
  bestFor.textContent = bestForLabel(item);

  content.append(kicker, title, meta, summary, bestFor);
  if (canonicalCategory(item.category) === "Image Prompts") {
    content.append(renderImagePromptBrief(item));
  }
  content.append(renderTags(item), renderActions(item));

  const score = document.createElement("div");
  score.className = `score ${scoreClass(Number(item.fitScore || 0))}`;
  const scoreLabel = document.createElement("span");
  scoreLabel.textContent = "Priority";
  const scoreValue = document.createElement("strong");
  scoreValue.textContent = item.fitScore ? `${item.fitScore}%` : "New";
  const scoreTrack = document.createElement("span");
  scoreTrack.className = "score-track";
  const scoreFill = document.createElement("i");
  scoreFill.style.width = `${Math.max(6, Math.min(100, Number(item.fitScore || 0)))}%`;
  scoreTrack.append(scoreFill);
  score.append(scoreLabel, scoreValue, scoreTrack);
  score.title = "Priority score";

  article.append(visual, content, score);
  return article;
}

function render() {
  const items = filteredItems();
  const hasSourceItems = state.items.length > 0;
  contextPanel.classList.toggle("is-empty", !hasSourceItems);
  contextEmptyState.hidden = hasSourceItems;
  digestPreviewBody.hidden = !hasSourceItems;
  digestEmptyState.hidden = hasSourceItems;
  updateMetrics(items);
  updateTicker();
  renderSpotlight(items);
  feed.replaceChildren();

  if (!items.length) {
    const empty = emptyTemplate.content.cloneNode(true);
    if (hasSourceItems) {
      empty.querySelector("h2").textContent = "No matching signals";
      empty.querySelector("p").textContent = "Adjust the search, category, or priority filters to see more results.";
    }
    feed.append(empty);
    return;
  }

  for (const item of items) {
    feed.append(renderCard(item));
  }
}

function renderChat() {
  chatMessages.replaceChildren();
  for (const message of state.chat) {
    const bubble = document.createElement("article");
    bubble.className = `chat-message ${message.role}`;
    if (message.pending) bubble.classList.add("pending");

    const text = document.createElement("div");
    text.className = "chat-message-body";
    text.innerHTML = renderRichText(message.content);
    bubble.append(text);

    if (message.sources?.length) {
      const sources = document.createElement("div");
      sources.className = "chat-sources";
      for (const source of message.sources) {
        const link = document.createElement("a");
        link.href = source.link;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = source.title || source.source || "Source";
        sources.append(link);
      }
      bubble.append(sources);
    }

    chatMessages.append(bubble);
  }

  chatSuggestions.replaceChildren();
  for (const suggestion of state.suggestions.slice(0, 3)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = suggestion;
    button.addEventListener("click", () => enqueueChatPrompt(suggestion));
    chatSuggestions.append(button);
  }

  renderPromptQueue();
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderPromptQueue() {
  promptQueueList.replaceChildren();
  if (!state.promptQueue.length) {
    const empty = document.createElement("p");
    empty.textContent = state.processingChat ? "Reply in progress..." : "Queue is empty";
    promptQueueList.append(empty);
    return;
  }

  state.promptQueue.forEach((prompt, index) => {
    const item = document.createElement("article");
    item.className = "queue-item";
    const label = document.createElement("span");
    label.textContent = index === 0 && state.processingChat ? "Next" : `#${index + 1}`;
    const text = document.createElement("p");
    text.textContent = prompt;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      state.promptQueue.splice(index, 1);
      renderPromptQueue();
    });
    item.append(label, text, remove);
    promptQueueList.append(item);
  });
}

function updateTicker() {
  const headlines = state.items
    .slice(0, 6)
    .map((item) => `${canonicalCategory(item.category)}: ${item.title}`);
  tickerText.textContent = headlines.length
    ? headlines.join("   |   ")
    : "AI jobs, papers, grants, tools, and funding signals refresh every day at 7:00 AM.";
}

async function loadItems() {
  document.querySelector("#syncStatus").textContent = "Syncing";
  try {
    const response = await fetch("/api/posts");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load the intelligence feed.");
    const items = Array.isArray(data.items) ? data.items : sampleItems;
    state.items = items.map((item) => ({
      ...item,
      category: canonicalCategory(item.category),
    }));
    populateCategories();
    render();
    syncState.hidden = true;
    document.querySelector("#syncStatus").textContent = "Live";
  } catch (error) {
    state.items = sampleItems;
    populateCategories();
    render();
    syncStateMessage.textContent = error.message || "Showing the latest available intelligence while the connection recovers.";
    syncState.hidden = false;
    document.querySelector("#syncStatus").textContent = "Offline";
  }
}

async function submitLead(event) {
  event.preventDefault();
  leadStatus.textContent = "Saving your preview profile...";
  leadStatus.className = "form-status";

  const formData = new FormData(leadForm);
  const interests = formData.getAll("interests");
  const payload = {
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    channel: formData.get("channel"),
    interests,
    frequency: formData.get("frequency") || "daily",
    digestFormat: formData.get("digestFormat") || "html",
    subscribed: true,
  };

  try {
    const response = await fetch("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not save your profile.");
    leadStatus.textContent = "Subscribed. Your daily formatted AI opportunity email profile is ready.";
    leadStatus.classList.add("success");
    trackEvent("paid_beta_click", {
      label: interests.includes("Paid Beta") ? "lead_with_paid_beta_interest" : "lead_without_paid_beta_interest",
    });
    leadForm.reset();
  } catch (error) {
    leadStatus.textContent = error.message;
    leadStatus.classList.add("error");
  }
}

async function requestLiveUpdate() {
  liveUpdateButton.disabled = true;
  liveUpdateButton.textContent = "Starting...";
  document.querySelector("#syncStatus").textContent = "Updating";

  try {
    syncState.hidden = true;
    const response = await fetch("/api/live-update", { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || data.message || "Live update failed.");

    liveUpdateButton.textContent = "Running";
    setTimeout(loadItems, 5000);
    setTimeout(loadItems, 15000);
  } catch (error) {
    liveUpdateButton.textContent = "Setup needed";
    document.querySelector("#syncStatus").textContent = "Live setup";
    syncStateMessage.textContent = error.message || "The live update could not reach its configured sources.";
    syncState.hidden = false;
    alert(error.message);
  } finally {
    setTimeout(() => {
      liveUpdateButton.disabled = false;
      liveUpdateButton.textContent = "Live update";
    }, 2500);
  }
}

async function processChatPrompt(message) {
  chatSetupState.hidden = true;
  state.chat.push({ role: "user", content: message, sources: [] });
  const thinkingMessage = {
    role: "assistant",
    content: "Thinking through the feed, checking source links, and shaping the next useful step...",
    sources: [],
    pending: true,
  };
  state.chat.push(thinkingMessage);
  chatInput.value = "";
  chatStatus.textContent = `Processing reply${state.promptQueue.length ? ` - ${state.promptQueue.length} queued` : ""}`;
  chatSendButton.disabled = true;
  renderChat();

  try {
    const history = state.chat
      .filter((item) => ["user", "assistant"].includes(item.role) && !item.pending)
      .slice(-8)
      .map((item) => ({ role: item.role, content: item.content }));
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Chatbot request failed.");

    thinkingMessage.content = data.reply || "I could not generate a response.";
    thinkingMessage.sources = data.sources || [];
    thinkingMessage.pending = false;
    state.suggestions = data.suggestions?.length ? data.suggestions.slice(0, 3) : state.suggestions;
    chatSetupState.hidden = true;
    chatStatus.textContent = data.model ? `Model: ${data.model}` : "";
  } catch (error) {
    thinkingMessage.content = error.message;
    thinkingMessage.pending = false;
    state.suggestions = ["Check OpenRouter setup", "Run a live update", "Try a shorter question"];
    chatSetupState.hidden = false;
    chatStatus.textContent = "Chat setup needed";
  } finally {
    chatInput.focus();
    renderChat();
  }
}

function enqueueChatPrompt(message) {
  const prompt = String(message || "").trim();
  if (!prompt) return;
  state.promptQueue.push(prompt);
  chatInput.value = "";
  chatStatus.textContent = state.processingChat ? `${state.promptQueue.length} prompt${state.promptQueue.length === 1 ? "" : "s"} queued` : "Queued";
  renderPromptQueue();
  processPromptQueue();
}

async function processPromptQueue() {
  if (state.processingChat) return;
  state.processingChat = true;
  chatSendButton.disabled = true;
  try {
    while (state.promptQueue.length) {
      const nextPrompt = state.promptQueue.shift();
      renderPromptQueue();
      await processChatPrompt(nextPrompt);
    }
  } finally {
    state.processingChat = false;
    chatSendButton.disabled = false;
    chatStatus.textContent = chatStatus.textContent.startsWith("Model:") ? chatStatus.textContent : "Ready";
    renderPromptQueue();
  }
}

async function submitChat(event) {
  event.preventDefault();
  enqueueChatPrompt(chatInput.value);
}

function exportChatHtml() {
  const rows = state.chat
    .map((message) => {
      const sources = (message.sources || [])
        .map((source) => `<li><a href="${escapeHtml(source.link)}">${escapeHtml(source.title || source.source || "Source")}</a></li>`)
        .join("");
      return `<section class="message ${message.role}">
        <h2>${message.role === "user" ? "You" : "AI SignalDesk Copilot"}</h2>
        <div>${renderRichText(message.content).replace(/\n/g, "<br>")}</div>
        ${sources ? `<ul>${sources}</ul>` : ""}
      </section>`;
    })
    .join("\n");
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI SignalDesk Chat Export</title>
  <style>
    body{font-family:Inter,Segoe UI,Arial,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#111827;background:#f5f7f9}
    header,.message{background:#fff;border:1px solid #d9e2ea;border-radius:8px;padding:20px;margin-bottom:14px}
    h1{margin:0 0 8px;font-size:28px}.message h2{font-size:14px;text-transform:uppercase;color:#007f73;margin:0 0 10px}
    .user{border-left:5px solid #007f73}.assistant{border-left:5px solid #17324d}
    a{color:#007f73;font-weight:700}ul{margin-bottom:0}
  </style>
</head>
<body>
  <header>
    <h1>AI SignalDesk Chat</h1>
    <p>Exported ${escapeHtml(new Date().toLocaleString())}</p>
  </header>
  ${rows}
</body>
</html>`;
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ai-desk-chat-${new Date().toISOString().slice(0, 10)}.html`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function setChatDock(open) {
  document.body.classList.toggle("chat-dock-open", open);
  chatDockButton.setAttribute("aria-expanded", String(open));
  if (open) {
    setTimeout(() => chatInput.focus(), 220);
    trackEvent("chat_dock_open");
  }
}

searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});

categoryFilter.addEventListener("change", (event) => {
  setCategory(event.target.value);
});

fitFilter.addEventListener("change", (event) => {
  state.fit = event.target.value;
  render();
});

refreshButton.addEventListener("click", loadItems);
liveUpdateButton.addEventListener("click", requestLiveUpdate);
dailyBriefButton.addEventListener("click", () => {
  askChatbot(
    "Generate my daily brief across Jobs, Research, AI Products, Prompts, and Image Prompts. Rank the most useful signals, include source links, and give clear next actions.",
  );
});
chatForm.addEventListener("submit", submitChat);
exportChatButton.addEventListener("click", exportChatHtml);
chatDockButton.addEventListener("click", () => setChatDock(!document.body.classList.contains("chat-dock-open")));
closeChatDockButton.addEventListener("click", () => setChatDock(false));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.body.classList.contains("chat-dock-open")) setChatDock(false);
});
paidBetaButton.addEventListener("click", () => {
  paidBetaInterest.checked = true;
  document.querySelector("#joinPreview").scrollIntoView({ behavior: "smooth", block: "start" });
  trackEvent("paid_beta_click", { label: "hero_beta_button" });
  leadStatus.textContent = "Paid beta interest selected. Add your email to join the waitlist.";
});
clearQueueButton.addEventListener("click", () => {
  state.promptQueue = [];
  renderPromptQueue();
  chatStatus.textContent = state.processingChat ? "Current reply will finish" : "Queue cleared";
});

for (const button of categoryButtons) {
  button.addEventListener("click", () => setCategory(button.dataset.category));
}

for (const button of mixButtons) {
  button.addEventListener("click", () => {
    setCategory(button.dataset.category);
    document.querySelector("#dailyFeed").scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

for (const button of outputModeButtons) {
  button.addEventListener("click", () => {
    askChatbot(
      `Create a ${button.dataset.mode} from today's AI opportunity feed. Make it polished, marketable, engaging, and link-backed. Cover Jobs, Research, AI Products, Prompts, and Image Prompts when relevant.`,
    );
  });
}

for (const button of contextButtons) {
  button.addEventListener("click", () => {
    setCategory(button.dataset.category);
    document.querySelector("#dailyFeed").scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

leadForm.addEventListener("submit", submitLead);

briefingDate.textContent = `${new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
}).format(new Date())} - AI market briefing`;

renderChat();
trackEvent("page_load");
loadItems();
setInterval(loadItems, 60000);
