function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
}

function formatTime(value) {
  if (!value) return "时间未知";
  return new Date(value).toLocaleString();
}

function reasonLabel(item) {
  const code = item.error_code && item.error_code !== "unknown" ? `错误码 ${escapeHtml(item.error_code)}` : "未返回错误码";
  return `${code}<br>${escapeHtml(item.last_error || "币安拒绝发布，未返回具体原因")}`;
}

async function render() {
  const el = document.getElementById("status");
  const toggleButton = document.getElementById("toggleSync");
  const {lastStatus, queue = {}, squareApiKey, boundUsername, enabled} = await chrome.storage.local.get([
    "lastStatus", "queue", "squareApiKey", "boundUsername", "enabled"
  ]);
  const items = Object.values(queue);
  const pending = items.filter(item => item.status !== "published").length;
  const rejected = items
    .filter(item => item.status === "blocked")
    .sort((a, b) => (b.rejected_at || b.updated_at || 0) - (a.rejected_at || a.updated_at || 0))
    .slice(0, 3);
  const paused = enabled === false;
  toggleButton.textContent = paused ? "恢复同步" : "暂停同步";
  toggleButton.className = paused ? "resume" : "";

  if (!squareApiKey) {
    el.innerHTML = '<div class="bad">● 尚未填写币安广场 OpenAPI Key</div>';
    return;
  }
  if (paused) {
    el.innerHTML = '<div class="bad">● 手动同步已暂停</div><div class="muted">点击“恢复同步”后才能使用 X 页面上的同步按钮</div>';
    return;
  }

  let summary = "";
  if (!lastStatus) {
    summary = `<div class="ok">● 手动同步已启用${boundUsername ? ` · @${escapeHtml(boundUsername)}` : ""}</div><div class="muted">请在 X 推文旁点击“同步”${pending ? `；待处理 ${pending} 条` : ""}</div>`;
  } else if (lastStatus?.status === "skipped_keyword") {
    const keyword = escapeHtml(lastStatus.matched_keyword || "未知关键词");
    summary = `<div class="bad">● 最近一条已跳过</div><div class="muted">${formatTime(lastStatus.at)}<br>命中不同步关键词：${keyword}<br>未进入发布或重试队列</div>`;
  } else if (lastStatus.ok) {
    const note = lastStatus.links_removed ? "<br>币安拒绝原链接，已自动移除链接后发布" : "";
    const images = lastStatus.image_count ? `<br>已同步 ${Number(lastStatus.image_count)} 张图片` : "";
    const noId = lastStatus.published_without_id ? "<br>币安已接收内容，但未返回帖子 ID" : "";
    const link = lastStatus.square_url ? `<br><a href="${escapeHtml(lastStatus.square_url)}" target="_blank">查看币安广场帖子</a>` : "";
    summary = `<div class="ok">● 最近同步成功</div><div class="muted">${formatTime(lastStatus.at)}${images}${note}${noId}${link}</div>`;
  } else {
    const isRejected = lastStatus.status === "blocked";
    const title = isRejected ? "● 最近一条被币安拒绝" : "● 最近同步失败，等待重试";
    const code = lastStatus.error_code && lastStatus.error_code !== "unknown" ? `<br>错误码：${escapeHtml(lastStatus.error_code)}` : "";
    summary = `<div class="bad">${title}</div><div class="muted">${formatTime(lastStatus.at)}${code}<br>${escapeHtml(lastStatus.error || "未知错误")}<br>未完成 ${pending} 条</div>`;
  }

  const rejectedHtml = rejected.length ? `
    <div class="rejected-title">被拒绝记录（最近 ${rejected.length} 条）</div>
    ${rejected.map(item => {
      const text = String(item.payload?.text || "").replace(/\s+/g, " ").trim();
      const excerpt = text.length > 70 ? `${text.slice(0, 70)}…` : text;
      return `<div class="rejected-item"><strong>${formatTime(item.rejected_at || item.updated_at)}</strong><br>${reasonLabel(item)}${excerpt ? `<br><span class="excerpt">推文：${escapeHtml(excerpt)}</span>` : ""}</div>`;
    }).join("")}` : "";

  el.innerHTML = summary + rejectedHtml;
}

document.getElementById("settings").onclick = () => chrome.runtime.openOptionsPage();
document.getElementById("toggleSync").onclick = async () => {
  const {enabled} = await chrome.storage.local.get("enabled");
  await chrome.storage.local.set({enabled: enabled === false});
  await render();
};
document.getElementById("retry").onclick = async () => {
  const {queue = {}} = await chrome.storage.local.get("queue");
  const rejectedWithLinks = Object.values(queue).filter(item =>
    item.status === "blocked" && /https?:\/\/[^\s]+/i.test(String(item.payload?.text || ""))
  ).length;
  let type = "RETRY_ALL";
  if (rejectedWithLinks) {
    const confirmed = window.confirm(
      `发现 ${rejectedWithLinks} 条被拒绝内容含有链接。\n\n重试时将删除链接，只发送剩余文字。是否继续？`
    );
    if (!confirmed) return;
    type = "RETRY_WITHOUT_LINKS";
  }
  const button = document.getElementById("retry");
  button.disabled = true;
  button.textContent = "重试中…";
  const result = await chrome.runtime.sendMessage({type});
  button.disabled = false;
  button.textContent = "立即重试";
  if (result?.links_removed_count) {
    window.alert(`已删除 ${result.links_removed_count} 条内容中的链接，并重新发送。`);
  }
  if (result?.skipped_empty_count) {
    window.alert(`${result.skipped_empty_count} 条内容删除链接后没有剩余文字，已保留为被拒绝状态，没有发送空内容。`);
  }
  await render();
};
render();
