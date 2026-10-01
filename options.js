const DEFAULT_BLOCK_KEYWORDS = ["OKX", "OKEx", "欧易"];
const keyEl = document.getElementById("key");
const keyStateEl = document.getElementById("keyState");
const enabledEl = document.getElementById("enabled");
const blockKeywordsEl = document.getElementById("blockKeywords");
const boundEl = document.getElementById("bound");
const statusEl = document.getElementById("status");

function status(text, ok = true) {
  statusEl.textContent = text;
  statusEl.className = `status ${ok ? "ok" : "bad"}`;
}
function renderKeyState(configured) {
  keyStateEl.textContent = configured ? "● 已安全保存（内容已隐藏）" : "○ 尚未配置";
  keyStateEl.className = `key-state ${configured ? "ok" : "bad"}`;
}
function parseKeywords(value) {
  const seen = new Set();
  const result = [];
  for (const part of String(value || "").split(/[\n,，]+/)) {
    const keyword = part.trim();
    const normalized = keyword.toLowerCase();
    if (!keyword || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(keyword);
  }
  return result;
}
async function load() {
  const values = await chrome.storage.local.get([
    "squareApiKey", "enabled", "boundUsername", "blockKeywords"
  ]);
  // Deliberately never place an existing key back into the DOM.
  keyEl.value = "";
  renderKeyState(Boolean(values.squareApiKey));
  enabledEl.checked = values.enabled !== false;
  blockKeywordsEl.value = (Array.isArray(values.blockKeywords)
    ? values.blockKeywords
    : DEFAULT_BLOCK_KEYWORDS).join("\n");
  boundEl.textContent = values.boundUsername ? `@${values.boundUsername}` : "尚未绑定；首次成功检测到推文时自动绑定";
}

document.getElementById("save").addEventListener("click", async () => {
  const newKey = keyEl.value.trim();
  const current = await chrome.storage.local.get("squareApiKey");
  if (newKey && newKey.length < 16) {
    status("OpenAPI Key 看起来过短，请检查。", false);
    return;
  }
  if (!newKey && !current.squareApiKey) {
    status("请先填写币安广场 OpenAPI Key。", false);
    return;
  }
  const update = {
    enabled: enabledEl.checked,
    blockKeywords: parseKeywords(blockKeywordsEl.value)
  };
  if (newKey) update.squareApiKey = newKey;
  await chrome.storage.local.set(update);
  keyEl.value = "";
  renderKeyState(true);
  status(newKey ? "密钥已保存并从输入框隐藏。回到 x.com 刷新一次即可使用。" : "设置已保存。");
});

document.getElementById("reset").addEventListener("click", async () => {
  await chrome.storage.local.remove("boundUsername");
  boundEl.textContent = "尚未绑定；首次成功同步本人推文时自动绑定";
  status("X 账号绑定已重置。");
});

document.getElementById("clear").addEventListener("click", async () => {
  await chrome.storage.local.remove("squareApiKey");
  keyEl.value = "";
  renderKeyState(false);
  status("密钥已从浏览器本地删除。");
});

load();
