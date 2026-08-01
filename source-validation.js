const dns = require("node:dns/promises");
const net = require("node:net");

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_CONCURRENCY = 8;
const MAX_INSPECTION_BYTES = 128 * 1024;

const UNAVAILABLE_PAGE_PATTERNS = [
  /the content you are trying to access is not available at/i,
  /only accessible to subscribing institutions/i,
  /<title[^>]*>\s*(?:404|403|page not found|access denied)/i,
  /sorry, you have been blocked/i,
  /the requested (?:page|resource) (?:could not be found|is not available)/i,
];

function isPrivateAddress(address) {
  const value = String(address || "").toLowerCase().split("%")[0];
  const version = net.isIP(value);
  if (version === 4) {
    const parts = value.split(".").map(Number);
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (version === 6) {
    if (value === "::" || value === "::1") return true;
    if (value.startsWith("fc") || value.startsWith("fd")) return true;
    if (/^fe[89ab]/.test(value)) return true;
    if (value.startsWith("ff")) return true;
    const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  return true;
}

async function isPublicDestination(parsed, lookup = dns.lookup) {
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) return false;
  if (net.isIP(hostname)) return !isPrivateAddress(hostname);
  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.length > 0 && records.every((record) => !isPrivateAddress(record.address));
  } catch {
    return false;
  }
}

async function readResponseSample(response, maxBytes = MAX_INSPECTION_BYTES) {
  if (!response.body?.getReader) return (await response.text()).slice(0, maxBytes);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (bytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (bytes >= maxBytes) break;
    }
    text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text.slice(0, maxBytes);
}

async function validateSourceUrl(value, options = {}) {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const fetchImpl = options.fetchImpl || fetch;
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    return { ok: false, reason: "invalid URL" };
  }
  if (!/^https?:$/.test(parsed.protocol)) return { ok: false, reason: "unsupported URL protocol" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let currentUrl = parsed;
    let response;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      if (!(await isPublicDestination(currentUrl, options.lookup))) {
        return { ok: false, reason: "source does not resolve to a public internet address" };
      }
      response = await fetchImpl(currentUrl, {
        method: "GET",
        redirect: "manual",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/pdf,application/json;q=0.9,*/*;q=0.8",
          Range: `bytes=0-${MAX_INSPECTION_BYTES - 1}`,
          "User-Agent": "AI-SignalDesk-SourceCheck/1.0",
        },
        signal: controller.signal,
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      await response.body?.cancel?.().catch(() => {});
      if (!location) return { ok: false, reason: `source returned an incomplete HTTP ${response.status} redirect` };
      if (redirects === 5) return { ok: false, reason: "source exceeded the redirect limit" };
      currentUrl = new URL(location, currentUrl);
      if (!/^https?:$/.test(currentUrl.protocol)) return { ok: false, reason: "source redirected to an unsupported URL protocol" };
    }
    if (!response.ok) {
      const allowedStatuses = options.allowStatusesByHostname?.[currentUrl.hostname.toLowerCase()] || [];
      if (allowedStatuses.includes(response.status)) {
        await response.body?.cancel?.().catch(() => {});
        return { ok: true, status: response.status, finalUrl: currentUrl.href, warning: "source blocks automated checks" };
      }
      await response.body?.cancel?.().catch(() => {});
      return { ok: false, reason: `source returned HTTP ${response.status}`, status: response.status };
    }
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("text/html") || contentType.includes("text/plain") || !contentType) {
      const sample = await readResponseSample(response);
      const unavailablePattern = UNAVAILABLE_PAGE_PATTERNS.find((pattern) => pattern.test(sample));
      if (unavailablePattern) {
        return { ok: false, reason: "source page reports that the content is unavailable", status: response.status };
      }
    } else {
      await response.body?.cancel?.().catch(() => {});
    }
    return { ok: true, status: response.status, finalUrl: currentUrl.href };
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    return { ok: false, reason: timedOut ? `source check timed out after ${timeoutMs}ms` : `source request failed: ${error?.message || error}` };
  } finally {
    clearTimeout(timer);
  }
}

async function validateReachableSources(items, options = {}) {
  const concurrency = Math.max(1, Number(options.concurrency || DEFAULT_CONCURRENCY));
  const checks = new Map();
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index];
      const link = String(item.link || "").trim();
      if (!checks.has(link)) checks.set(link, validateSourceUrl(link, options));
      results[index] = await checks.get(link);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  const accepted = [];
  const rejected = [];
  results.forEach((result, index) => {
    if (result.ok) accepted.push(items[index]);
    else rejected.push({ index, id: items[index].id, title: items[index].title, link: items[index].link, reason: result.reason });
  });
  return { accepted, rejected };
}

module.exports = {
  isPrivateAddress,
  validateSourceUrl,
  validateReachableSources,
};
