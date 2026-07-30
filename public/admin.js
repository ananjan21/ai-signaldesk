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
  const haystack = [
    lead.email,
    lead.name,
    lead.role,
    lead.channel,
    lead.frequency,
    lead.digestFormat,
    lead.plan,
    lead.adminNotes,
    ...(lead.interests || []),
    ...(lead.adminTags || []),
  ]
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
    const adminTags = (lead.adminTags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
    const activity = (lead.activity || [])
      .slice(0, 3)
      .map((event) => `<small>${escapeHtml(event.type || "activity")} - ${formatDate(event.at)}</small>`)
      .join("");
    row.innerHTML = `
      <td>
        <strong>${escapeHtml(lead.email || "-")}</strong>
        <small>${lead.subscribed ? "Subscribed" : "Inactive"}${lead.bounced ? " / Bounced" : ""}</small>
        <small>${escapeHtml(lead.plan || "free-preview")}</small>
      </td>
      <td>
        <label>Name<input data-field="name" data-id="${escapeHtml(lead.id)}" value="${escapeHtml(lead.name || "")}" /></label>
        <label>Role<input data-field="role" data-id="${escapeHtml(lead.id)}" value="${escapeHtml(lead.role || "")}" /></label>
      </td>
      <td><div class="admin-tags">${interests || "<span>No interests</span>"}</div></td>
      <td>
        <label>Channel
          <select data-field="channel" data-id="${escapeHtml(lead.id)}">
            ${["email", "telegram", "whatsapp"].map((value) => `<option value="${value}" ${lead.channel === value ? "selected" : ""}>${value}</option>`).join("")}
          </select>
        </label>
        <label>Frequency
          <select data-field="frequency" data-id="${escapeHtml(lead.id)}">
            ${["daily", "weekly"].map((value) => `<option value="${value}" ${lead.frequency === value ? "selected" : ""}>${value}</option>`).join("")}
          </select>
        </label>
      </td>
      <td>
        <small>Joined ${formatDate(lead.createdAt)}</small>
        <small>Updated ${formatDate(lead.updatedAt)}</small>
        <div class="admin-activity">${activity || "<small>No tracked activity yet</small>"}</div>
      </td>
      <td>
        <strong>${lead.emailForwardCount || 0}</strong>
        <small>${escapeHtml(lead.lastEmailSubject || "No recorded sends")}</small>
        <small>${formatDate(lead.lastEmailForwardedAt)}</small>
        <button type="button" data-forward="${escapeHtml(lead.id)}">Record forward</button>
      </td>
      <td class="admin-row-actions">
        <label>Interests<input data-field="interests" data-id="${escapeHtml(lead.id)}" value="${escapeHtml((lead.interests || []).join(", "))}" /></label>
        <label>Tags<input data-field="adminTags" data-id="${escapeHtml(lead.id)}" value="${escapeHtml((lead.adminTags || []).join(", "))}" /></label>
        <label>Notes<textarea data-field="adminNotes" data-id="${escapeHtml(lead.id)}">${escapeHtml(lead.adminNotes || "")}</textarea></label>
        <div class="admin-tags">${adminTags}</div>
        <div class="admin-button-grid">
          <button type="button" data-toggle-subscribe="${escapeHtml(lead.id)}">${lead.subscribed ? "Unsubscribe" : "Resubscribe"}</button>
          <button type="button" data-toggle-bounced="${escapeHtml(lead.id)}">${lead.bounced ? "Clear bounce" : "Mark bounced"}</button>
          <button type="button" data-toggle-paid="${escapeHtml(lead.id)}">${lead.plan === "paid-beta" ? "Mark free" : "Mark paid beta"}</button>
          <button type="button" data-save="${escapeHtml(lead.id)}">Save edits</button>
          <button type="button" class="danger" data-delete="${escapeHtml(lead.id)}">Delete</button>
        </div>
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

function leadById(id) {
  return state.leads.find((item) => item.id === id);
}

function fieldValue(id, field) {
  return document.querySelector(`[data-id="${CSS.escape(id)}"][data-field="${field}"]`)?.value || "";
}

async function updateSubscriber(id, patch) {
  adminStatus.textContent = "Saving subscriber...";
  const response = await fetch("/api/admin/subscriber", {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...patch }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Could not update subscriber.");
  }
  await loadSummary();
}

async function saveSubscriberEdits(id) {
  await updateSubscriber(id, {
    name: fieldValue(id, "name"),
    role: fieldValue(id, "role"),
    channel: fieldValue(id, "channel"),
    frequency: fieldValue(id, "frequency"),
    interests: fieldValue(id, "interests"),
    adminTags: fieldValue(id, "adminTags"),
    adminNotes: fieldValue(id, "adminNotes"),
  });
}

async function deleteSubscriber(id) {
  const lead = leadById(id);
  if (!lead || !confirm(`Delete ${lead.email}? This removes the subscriber record.`)) return;
  adminStatus.textContent = "Deleting subscriber...";
  const response = await fetch("/api/admin/subscriber", {
    method: "DELETE",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!response.ok) throw new Error("Could not delete subscriber.");
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
  const target = event.target;
  const lead = target?.dataset?.toggleSubscribe || target?.dataset?.toggleBounced || target?.dataset?.togglePaid || target?.dataset?.save || target?.dataset?.delete;
  const forward = target?.dataset?.forward;
  if (forward) recordForward(forward).catch((error) => (adminStatus.textContent = error.message));
  if (target?.dataset?.toggleSubscribe) {
    const current = leadById(lead);
    updateSubscriber(lead, { subscribed: !current.subscribed }).catch((error) => (adminStatus.textContent = error.message));
  }
  if (target?.dataset?.toggleBounced) {
    const current = leadById(lead);
    updateSubscriber(lead, { bounced: !current.bounced }).catch((error) => (adminStatus.textContent = error.message));
  }
  if (target?.dataset?.togglePaid) {
    const current = leadById(lead);
    updateSubscriber(lead, { plan: current.plan === "paid-beta" ? "free-preview" : "paid-beta" }).catch((error) => (adminStatus.textContent = error.message));
  }
  if (target?.dataset?.save) saveSubscriberEdits(lead).catch((error) => (adminStatus.textContent = error.message));
  if (target?.dataset?.delete) deleteSubscriber(lead).catch((error) => (adminStatus.textContent = error.message));
});

if (state.auth) {
  openDashboard("", "", state.auth).catch(() => {
    sessionStorage.removeItem(AUTH_KEY);
    loginPanel.hidden = false;
    dashboardPanel.hidden = true;
  });
}
