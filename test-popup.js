const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

class Element {
  constructor() {
    this.innerHTML = "";
    this.textContent = "";
    this.className = "";
    this.disabled = false;
    this.onclick = null;
  }
}

(async () => {
  const ids = ["status", "toggleSync", "settings", "retry"];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const store = {
    squareApiKey: "existing-secret-value-123",
    enabled: true,
    boundUsername: "alice",
    queue: {},
    lastStatus: {
      ok: false,
      status: "skipped_keyword",
      matched_keyword: "OKX",
      at: Date.now()
    }
  };
  const chrome = {
    storage: {local: {
      async get(keys) {
        if (typeof keys === "string") return {[keys]: store[keys]};
        const out = {};
        for (const key of keys) out[key] = store[key];
        return out;
      },
      async set(values) { Object.assign(store, values); }
    }},
    runtime: {
      async openOptionsPage() {},
      async sendMessage() { return {ok: true}; }
    }
  };
  const context = {
    chrome,
    document: {getElementById: id => elements[id]},
    window: {confirm: () => true, alert() {}},
    console,
    Date,
    Number,
    Object,
    String
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("popup.js", "utf8"), context);
  await new Promise(resolve => setTimeout(resolve, 10));

  assert.equal(elements.toggleSync.textContent, "暂停同步");
  assert.match(elements.status.innerHTML, /命中不同步关键词：OKX/);

  await elements.toggleSync.onclick();
  assert.equal(store.enabled, false);
  assert.equal(elements.toggleSync.textContent, "恢复同步");
  assert.match(elements.status.innerHTML, /手动同步已暂停/);

  await elements.toggleSync.onclick();
  assert.equal(store.enabled, true);
  assert.equal(elements.toggleSync.textContent, "暂停同步");

  console.log("popup pause and keyword status: PASS");
})().catch(error => { console.error(error); process.exit(1); });
