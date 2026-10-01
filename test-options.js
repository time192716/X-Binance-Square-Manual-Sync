const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

class Element {
  constructor() { this.value = ""; this.checked = true; this.textContent = ""; this.className = ""; this.handlers = {}; }
  addEventListener(type, fn) { this.handlers[type] = fn; }
  async click() { return this.handlers.click(); }
}

(async () => {
  const ids = ["key", "keyState", "enabled", "blockKeywords", "bound", "status", "save", "reset", "clear"];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const store = {squareApiKey: "existing-secret-value-123", enabled: true};
  const chrome = {storage: {local: {
    async get(keys) {
      if (typeof keys === "string") return {[keys]: store[keys]};
      const out = {};
      for (const key of keys) out[key] = store[key];
      return out;
    },
    async set(values) { Object.assign(store, values); },
    async remove(key) { delete store[key]; }
  }}};
  const context = {chrome, document: {getElementById: id => elements[id]}, console};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("options.js", "utf8"), context);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(elements.key.value, "", "saved key must never be restored into the DOM");
  assert.match(elements.keyState.textContent, /已安全保存/);
  assert.match(elements.blockKeywords.value, /OKX/);

  elements.key.value = "replacement-secret-value-456";
  elements.blockKeywords.value = "OKX, 欧易\n自定义词\nokx";
  await elements.save.click();
  assert.equal(store.squareApiKey, "replacement-secret-value-456");
  assert.equal(elements.key.value, "", "input must be cleared immediately after saving");
  assert.match(elements.status.textContent, /隐藏/);
  assert.equal(JSON.stringify(store.blockKeywords), JSON.stringify(["OKX", "欧易", "自定义词"]));

  await elements.clear.click();
  assert.equal(store.squareApiKey, undefined);
  assert.equal(elements.key.value, "");
  console.log("secret options UI: PASS");
})().catch(error => { console.error(error); process.exit(1); });
