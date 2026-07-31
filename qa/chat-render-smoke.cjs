const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const noop = () => {};
const classList = { add: noop, remove: noop, toggle: noop, contains: () => false };
const element = new Proxy(noop, {
  get(_target, property) {
    if (property === "classList") return classList;
    if (property === "dataset") return {};
    if (property === "content") return { cloneNode: () => element };
    if (property === "value" || property === "textContent") return "";
    return noop;
  },
  set: () => true,
  apply: () => element,
});

const sandbox = {
  Blob,
  URL,
  console,
  crypto,
  document: {
    body: element,
    documentElement: { dataset: {} },
    createElement: () => element,
    querySelector: () => element,
    querySelectorAll: () => [],
    addEventListener: noop,
  },
  fetch: () => new Promise(() => {}),
  navigator: {},
  sessionStorage: { getItem: () => null, setItem: noop },
  setInterval: noop,
  setTimeout: noop,
  window: { location: { href: "http://localhost/" } },
};

vm.createContext(sandbox);
const appSource = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
vm.runInContext(appSource, sandbox);

const sample = `#### Key Elements to Include
The Core Contrast: Compare the paper (https://openalex.org/W7165701127).

#### Prompt Idea
> *A professional minimalist editorial illustration.*

#### 5-Minute Next Action
1. Generate the visual.
2. Publish the insight.`;

const rendered = sandbox.renderRichText(sample);
assert.doesNotMatch(rendered, /####/);
assert.match(rendered, /class="chat-heading">Key Elements to Include/);
assert.match(rendered, /<blockquote><em>A professional minimalist editorial illustration\.<\/em><\/blockquote>/);
assert.match(rendered, /<ol><li>Generate the visual\.<\/li><li>Publish the insight\.<\/li><\/ol>/);
assert.match(rendered, /<a href="https:\/\/openalex\.org\/W7165701127"/);

const unsafe = sandbox.renderRichText("#### <script>alert('x')</script>");
assert.doesNotMatch(unsafe, /<script>/);
assert.equal(unsafe, "");

console.log("Chat formatting smoke test passed.");
