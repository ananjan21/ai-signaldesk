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

function renderPaidTrends(trends = {}) {
  renderTrendBars(document.querySelector("#paidWeeklyTrend"), trends.weekly || []);
  renderTrendBars(document.querySelector("#paidMonthlyTrend"), trends.monthly || []);
  document.querySelector("#paidWeeklyTotal").textContent = `${trendTotal(trends.weekly || [])} signals`;
  document.querySelector("#paidMonthlyTotal").textContent = `${trendTotal(trends.monthly || [])} signals`;
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
