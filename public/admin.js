const AUTH_KEY = "aiSignalDeskAdminAuth";
const loginPanel = document.querySelector("#loginPanel");
const dashboardPanel = document.querySelector("#dashboardPanel");
const loginForm = document.querySelector("#adminLoginForm");
const usernameInput = document.querySelector("#adminUsername");
const passwordInput = document.querySelector("#adminPassword");
const loginStatus = document.querySelector("#loginStatus");
const adminStatus = document.querySelector("#adminStatus");
const rows = document.querySelector("#subscriberRows");
const searchInput = document.querySelector("#subscriberSearch");
const statusFilter = document.querySelector("#subscriberStatus");
const csvDownload = document.querySelector("#csvDownload");

let state = { auth: sessionStorage.getItem(AUTH_KEY) || "", leads: [], summary: null };

function authHeaders() {
  return { Authorization: `Basic ${state.auth}` };
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function textMatch(lead, query) {
  const haystack = [lead.email, lead.name, lead.role, lead.channel, lead.frequency, lead.digestFormat, ...(lead.interests || [])]
    .join(" ")
    .toLowerCase();
  return !query || haystack.includes(query);
}

function filteredLeads() {
  const query = searchInput.value.trim().toLowerCase();
  const status = statusFilter.value;
  return state.leads.filter((lead) => {
    const statusOk = status === "all" || (status === "active" ? lead.subscribed : !lead.subscribed);
    return statusOk && textMatch(lead, query);
  });
}

function renderMetrics() {
  const counts = state.summary?.counts || {};
  document.querySelector("#metricSubscribers").textContent = counts.subscribers || 0;
  document.querySelector("#metricActive").textContent = counts.activeSubscribers || 0;
  document.querySelector("#metricForwards").textContent = counts.totalEmailForwards || 0;
  document.querySelector("#metricLatest").textContent = formatDate(state.summary?.latestForward);
}

function renderRows() {
  const leads = filteredLeads();
  rows.replaceChildren();
  if (!leads.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="6" class="admin-empty">No subscribers match this view.</td>`;
    rows.append(row);
    return;
  }

  for (const lead of leads) {
    const row = document.createElement("tr");
    const interests = (lead.interests || []).map((interest) => `<span>${escapeHtml(interest)}</span>`).join("");
    row.innerHTML = `
      <td><strong>${escapeHtml(lead.email || "-")}</strong><small>${lead.subscribed ? "Subscribed" : "Inactive"}</small></td>
      <td><strong>${escapeHtml(lead.name || "Unnamed")}</strong><small>${escapeHtml(lead.role || "-")}</small></td>
      <td><div class="admin-tags">${interests || "<span>No interests</span>"}</div></td>
      <td><strong>${escapeHtml(lead.channel || "email")}</strong><small>${escapeHtml(lead.frequency || "daily")} / ${escapeHtml(
        lead.digestFormat || "html",
      )}</small></td>
      <td><small>Joined ${formatDate(lead.createdAt)}</small><small>Updated ${formatDate(lead.updatedAt)}</small></td>
      <td>
        <strong>${lead.emailForwardCount || 0}</strong>
        <small>${escapeHtml(lead.lastEmailSubject || "No recorded sends")}</small>
        <small>${formatDate(lead.lastEmailForwardedAt)}</small>
        <button type="button" data-forward="${escapeHtml(lead.id)}">Record forward</button>
      </td>
    `;
    rows.append(row);
  }
}

async function loadSummary() {
  adminStatus.textContent = "Loading...";
  const response = await fetch("/api/admin/summary", { headers: authHeaders() });
  if (!response.ok) throw new Error(response.status === 401 ? "Invalid admin login." : "Could not load admin data.");
  const data = await response.json();
  state.summary = data;
  state.leads = data.leads || [];
  renderMetrics();
  renderRows();
  adminStatus.textContent = `Updated ${formatDate(data.checkedAt)}`;
}

async function downloadCsv(event) {
  event.preventDefault();
  adminStatus.textContent = "Preparing CSV...";
  const response = await fetch("/api/leads.csv", { headers: authHeaders() });
  if (!response.ok) throw new Error("Could not download CSV.");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ai-signaldesk-leads.csv";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  adminStatus.textContent = "CSV downloaded.";
}

async function recordForward(id) {
  const lead = state.leads.find((item) => item.id === id);
  if (!lead) return;
  adminStatus.textContent = "Recording forward...";
  const response = await fetch("/api/admin/email-forward", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id, subject: "Daily AI Opportunity Intelligence" }),
  });
  if (!response.ok) throw new Error("Could not record email forward.");
  await loadSummary();
}

async function openDashboard(username, password, existingAuth = "") {
  state.auth = existingAuth || btoa(`${username}:${password}`);
  sessionStorage.setItem(AUTH_KEY, state.auth);
  loginPanel.hidden = true;
  dashboardPanel.hidden = false;
  await loadSummary();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginStatus.textContent = "Checking login...";
  try {
    await openDashboard(usernameInput.value.trim(), passwordInput.value);
    passwordInput.value = "";
    loginStatus.textContent = "";
  } catch (error) {
    sessionStorage.removeItem(AUTH_KEY);
    loginPanel.hidden = false;
    dashboardPanel.hidden = true;
    loginStatus.textContent = error.message;
  }
});

document.querySelector("#refreshAdmin").addEventListener("click", () => loadSummary().catch((error) => (adminStatus.textContent = error.message)));
csvDownload.addEventListener("click", (event) => downloadCsv(event).catch((error) => (adminStatus.textContent = error.message)));
document.querySelector("#logoutAdmin").addEventListener("click", () => {
  sessionStorage.removeItem(AUTH_KEY);
  state = { auth: "", leads: [], summary: null };
  loginPanel.hidden = false;
  dashboardPanel.hidden = true;
});
searchInput.addEventListener("input", renderRows);
statusFilter.addEventListener("change", renderRows);
rows.addEventListener("click", (event) => {
  const id = event.target?.dataset?.forward;
  if (id) recordForward(id).catch((error) => (adminStatus.textContent = error.message));
});

if (state.auth) {
  openDashboard("", "", state.auth).catch(() => {
    sessionStorage.removeItem(AUTH_KEY);
    loginPanel.hidden = false;
    dashboardPanel.hidden = true;
  });
}
