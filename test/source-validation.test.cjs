const test = require("node:test");
const assert = require("node:assert/strict");
const { isPrivateAddress, validateSourceUrl, validateReachableSources } = require("../source-validation");

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("rejects private and loopback destinations", async () => {
  assert.equal(isPrivateAddress("127.0.0.1"), true);
  assert.equal(isPrivateAddress("192.168.1.20"), true);
  assert.equal(isPrivateAddress("93.184.216.34"), false);

  const result = await validateSourceUrl("http://localhost/private", {
    fetchImpl: async () => assert.fail("private destinations must not be fetched"),
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /public internet address/);
});

test("accepts a reachable public source", async () => {
  const result = await validateSourceUrl("https://example.com/article", {
    lookup: publicLookup,
    fetchImpl: async () => new Response("<html><title>Useful article</title></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
  });
  assert.equal(result.ok, true);
});

test("rejects HTTP errors and unavailable placeholder pages", async () => {
  const forbidden = await validateSourceUrl("https://example.com/blocked", {
    lookup: publicLookup,
    fetchImpl: async () => new Response("Forbidden", { status: 403 }),
  });
  assert.equal(forbidden.ok, false);
  assert.match(forbidden.reason, /HTTP 403/);

  const unavailable = await validateSourceUrl("https://example.com/paywall-placeholder", {
    lookup: publicLookup,
    fetchImpl: async () => new Response(
      "Sorry. The content you are trying to access is not available at this address. Some pages are only accessible to subscribing institutions.",
      { status: 200, headers: { "content-type": "text/html" } },
    ),
  });
  assert.equal(unavailable.ok, false);
  assert.match(unavailable.reason, /unavailable/);
});

test("allows a configured provider that blocks automated checks", async () => {
  const result = await validateSourceUrl("https://remotive.com/remote-jobs/example", {
    lookup: publicLookup,
    allowStatusesByHostname: { "remotive.com": [403] },
    fetchImpl: async () => new Response("Forbidden", { status: 403 }),
  });
  assert.equal(result.ok, true);
  assert.match(result.warning, /blocks automated checks/);
});

test("keeps reachable items and reports rejected sources", async () => {
  let requests = 0;
  const items = [
    { id: "good", title: "Good", link: "https://example.com/good" },
    { id: "bad", title: "Bad", link: "https://example.com/bad" },
  ];
  const result = await validateReachableSources(items, {
    lookup: publicLookup,
    fetchImpl: async (url) => {
      requests += 1;
      return String(url).endsWith("/good")
        ? new Response("Useful source", { status: 200, headers: { "content-type": "text/plain" } })
        : new Response("Missing", { status: 404 });
    },
  });
  assert.equal(requests, 2);
  assert.deepEqual(result.accepted.map((item) => item.id), ["good"]);
  assert.equal(result.rejected[0].id, "bad");
});
