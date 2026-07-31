const paidLoginForm = document.querySelector("#paidLoginForm");
const paidLoginPanel = document.querySelector("#paidLoginPanel");
const paidMemberPanel = document.querySelector("#paidMemberPanel");
const paidLoginStatus = document.querySelector("#paidLoginStatus");

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function trendTotal(series = []) {
  return series.reduce((sum, bucket) => sum + Number(bucket.total || 0), 0);
}

function renderTrendBars(container, series = []) {
  if (!container) return;
  container.replaceChildren();
  const max = Math.max(1, ...series.map((bucket) => Number(bucket.total || 0)));
  for (const bucket of series) {
    const row = document.createElement("div");
    row.className = "trend-row";
    const label = document.createElement("span");
    label.textContent = bucket.label || bucket.key || "-";
    const track = document.createElement("span");
    track.className = "trend-track";
    const fill = document.createElement("i");
    fill.style.width = `${Math.max(4, (Number(bucket.total || 0) / max) * 100)}%`;
    track.append(fill);
    const total = document.createElement("strong");
    total.textContent = Number(bucket.total || 0);
    row.append(label, track, total);
    container.append(row);
  }
}

function renderTrendingTopics(container, topics = []) {
  if (!container) return;
  container.replaceChildren();
  if (!topics.length) {
    const empty = document.createElement("p");
    empty.textContent = "No topics are trending yet.";
    container.append(empty);
    return;
  }
  for (const topic of topics.slice(0, 6)) {
    const row = document.createElement("article");
    row.className = "trend-topic";
    row.innerHTML = `
      <strong>${escapeHtml(topic.label || topic.topic || "Topic")}</strong>
      <span>${Number(topic.count || 0)} signals / ${escapeHtml(topic.leadingCategory || "Signals")}</span>
      <p>${escapeHtml((topic.examples || []).map((item) => item.title).filter(Boolean).slice(0, 2).join(" | "))}</p>
    `;
    container.append(row);
  }
}

function renderTrendingTitles(container, items = []) {
  if (!container) return;
  container.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("p");
    empty.textContent = "No ranked titles yet.";
    container.append(empty);
    return;
  }
  for (const item of items.slice(0, 5)) {
    const row = document.createElement("article");
    row.className = "trend-title";
    row.innerHTML = `
      <span>${Number(item.trendScore || item.fitScore || 0)}</span>
      <div>
        <a href="${escapeHtml(item.link || `/post/${item.id}`)}" target="_blank" rel="noreferrer">${escapeHtml(item.title || "Untitled signal")}</a>
        <small>${escapeHtml(item.category || "Signal")} / ${escapeHtml(item.company || item.source || "Source")}</small>
      </div>
    `;
    container.append(row);
  }
}

function renderPaidTrends(trends = {}) {
  renderTrendingTopics(document.querySelector("#paidWeeklyTrend"), trends.trendingTopics || []);
  renderTrendingTitles(document.querySelector("#paidMonthlyTrend"), trends.trendingItems || []);
  document.querySelector("#paidWeeklyTotal").textContent = `${(trends.trendingTopics || []).length} topics`;
  document.querySelector("#paidMonthlyTotal").textContent = `${(trends.trendingItems || []).length} ranked`;
}

function renderMember(data) {
  const profile = data.profile || {};
  document.querySelector("#memberTitle").textContent = `Welcome, ${profile.name || profile.paidUsername || "member"}`;
  document.querySelector("#memberMeta").textContent = `${profile.plan || "paid-beta"} / ${(profile.interests || []).join(", ") || "personalized AI signals"}`;

  document.querySelector("#featureList").innerHTML = (data.features || [])
    .map((feature, index) => `<article><span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(feature)}</strong></article>`)
    .join("");

  document.querySelector("#briefItems").innerHTML = (data.brief?.items || [])
    .map(
      (item) => `<article>
        <span>${escapeHtml(item.category || "Signal")}</span>
        <strong>${escapeHtml(item.title || "Untitled signal")}</strong>
        <p>${escapeHtml(item.summary || "No summary available.")}</p>
        ${item.link ? `<a href="${escapeHtml(item.link)}" target="_blank" rel="noreferrer">Open source</a>` : ""}
      </article>`,
    )
    .join("");

  document.querySelector("#assetLinks").innerHTML = (data.assets || [])
    .map((asset) => `<a href="${escapeHtml(asset.href)}" target="_blank" rel="noreferrer">${escapeHtml(asset.label)}</a>`)
    .join("");

  renderPaidTrends(data.trends || {});
  paidLoginPanel.hidden = true;
  paidMemberPanel.hidden = false;
}

paidLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  paidLoginStatus.className = "form-status";
  paidLoginStatus.textContent = "Checking paid beta access...";
  const payload = {
    username: document.querySelector("#paidUsername").value.trim(),
    password: document.querySelector("#paidPassword").value,
  };

  try {
    const response = await fetch("/api/paid-beta/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not open paid beta.");
    document.querySelector("#paidPassword").value = "";
    renderMember(data);
  } catch (error) {
    paidLoginStatus.textContent = error.message;
    paidLoginStatus.classList.add("error");
  }
});

document.querySelector("#paidLogout").addEventListener("click", () => {
  paidLoginPanel.hidden = false;
  paidMemberPanel.hidden = true;
});
