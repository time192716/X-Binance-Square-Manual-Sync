const SQUARE_URL = "https://www.binance.com/bapi/composite/v1/public/pgc/openApi/content/add";
const SQUARE_UPLOAD_URL = "https://www.binance.com/bapi/composite/v2/public/pgc/openApi";
const ALARM = "x-square-retry";
const MAX_QUEUE = 100;
const MAX_ATTEMPTS = 10;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_POLL_INTERVAL_MS = 3000;
const MAX_IMAGE_POLL_RETRIES = 10;
const DEFAULT_BLOCK_KEYWORDS = ["OKX", "OKEx", "欧易"];

async function config() {
  const values = await chrome.storage.local.get([
    "squareApiKey", "boundUsername", "enabled", "blockKeywords"
  ]);
  return {
    ...values,
    blockKeywords: normalizeBlockKeywords(values.blockKeywords)
  };
}
async function getQueue() {
  return (await chrome.storage.local.get("queue")).queue || {};
}
async function saveQueue(queue) {
  const entries = Object.entries(queue).sort((a,b) => b[1].created_at - a[1].created_at).slice(0, MAX_QUEUE);
  const compact = Object.fromEntries(entries);
  await chrome.storage.local.set({queue: compact});
  await updateBadge(compact);
}
async function updateBadge(queue) {
  const unfinished = Object.values(queue).filter(x => x.status !== "published");
  const blocked = unfinished.some(x => x.status === "blocked");
  await chrome.action.setBadgeText({text: unfinished.length ? String(unfinished.length) : ""});
  await chrome.action.setBadgeBackgroundColor({color: blocked ? "#B42318" : unfinished.length ? "#D97706" : "#16A34A"});
}
async function setLast(value) {
  await chrome.storage.local.set({lastStatus: {...value, at: Date.now()}});
}
function normalizeUsername(value) {
  return String(value || "").trim().replace(/^@/, "").toLowerCase();
}
function normalizeBlockKeywords(values) {
  const source = Array.isArray(values) ? values : DEFAULT_BLOCK_KEYWORDS;
  const seen = new Set();
  const result = [];
  for (const value of source) {
    const keyword = String(value || "").trim();
    const normalized = keyword.toLowerCase();
    if (!keyword || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(keyword);
  }
  return result;
}
function findBlockedKeyword(text, keywords) {
  const normalizedText = String(text || "").toLowerCase();
  return normalizeBlockKeywords(keywords).find(keyword =>
    normalizedText.includes(keyword.toLowerCase())
  ) || "";
}
function stripUrls(text) {
  return String(text || "")
    .replace(/https?:\/\/[^\s]+/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function squareError(message, code, permanent = false) {
  const error = new Error(message);
  error.code = String(code || "unknown");
  error.permanent = permanent;
  return error;
}
function normalizeXImageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "pbs.twimg.com") return "";
    if (!url.pathname.startsWith("/media/")) return "";
    url.searchParams.set("name", "orig");
    return url.toString();
  } catch (_) {
    return "";
  }
}
function sanitizeImageUrls(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(normalizeXImageUrl).filter(Boolean))].slice(0, MAX_IMAGES);
}
function samePostPayload(left, right) {
  const leftImages = sanitizeImageUrls(left?.image_urls);
  const rightImages = sanitizeImageUrls(right?.image_urls);
  return String(left?.text || "") === String(right?.text || "") &&
    normalizeUsername(left?.username) === normalizeUsername(right?.username) &&
    JSON.stringify(leftImages) === JSON.stringify(rightImages);
}
function isAllowedUploadUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (
      host === "amazonaws.com" ||
      host.endsWith(".amazonaws.com") ||
      host === "amazonaws.com.cn" ||
      host.endsWith(".amazonaws.com.cn")
    );
  } catch (_) {
    return false;
  }
}
function imageExtension(contentType) {
  return ({
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp"
  })[contentType] || "";
}
async function callSquare(url, apiKey, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-Square-OpenAPI-Key": apiKey,
      "Content-Type": "application/json",
      "clienttype": "binanceSkill"
    },
    body: JSON.stringify(body)
  });
  if (url === SQUARE_URL && response.status === 504) {
    return {publishStatus: "success_without_post_id"};
  }
  const raw = await response.text().catch(() => "");
  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch (_) {}
  if (!response.ok) {
    throw squareError(`Binance HTTP ${response.status}`, `HTTP_${response.status}`);
  }
  if (String(payload.code) !== "000000") {
    const code = String(payload.code || "unknown");
    throw squareError(
      `${payload.message || "Binance rejected the request"} (code ${code})`,
      code,
      !["10004"].includes(code)
    );
  }
  return payload.data || {};
}
async function downloadXImage(imageUrl) {
  const normalizedUrl = normalizeXImageUrl(imageUrl);
  if (!normalizedUrl) {
    throw squareError("Unsupported X image URL", "INVALID_X_IMAGE_URL", true);
  }
  const response = await fetch(normalizedUrl, {cache: "no-store", credentials: "omit"});
  if (!response.ok) {
    throw squareError(`X image download failed: HTTP ${response.status}`, `X_IMAGE_HTTP_${response.status}`);
  }
  const contentType = String(response.headers.get("Content-Type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const extension = imageExtension(contentType);
  if (!extension) {
    throw squareError(`Unsupported X image type: ${contentType || "unknown"}`, "UNSUPPORTED_IMAGE_TYPE", true);
  }
  const blob = await response.blob();
  if (!blob.size) {
    throw squareError("X returned an empty image", "EMPTY_X_IMAGE", true);
  }
  if (blob.size > MAX_IMAGE_BYTES) {
    throw squareError("X image is larger than the 20 MB safety limit", "X_IMAGE_TOO_LARGE", true);
  }
  return {blob, contentType, extension};
}
async function uploadXImage(imageUrl, apiKey, eventId, index) {
  const {blob, contentType, extension} = await downloadXImage(imageUrl);
  const safeId = String(eventId || "post").replace(/[^a-zA-Z0-9_-]/g, "-").slice(-80);
  const imageName = `${safeId}-${index + 1}.${extension}`;
  const ticket = await callSquare(
    `${SQUARE_UPLOAD_URL}/image/presignedUrl`,
    apiKey,
    {imageName}
  );
  if (!ticket.presignedUrl || !ticket.fileTicket) {
    throw squareError("Binance did not return an image upload ticket", "INVALID_UPLOAD_TICKET");
  }
  if (!isAllowedUploadUrl(ticket.presignedUrl)) {
    throw squareError("Binance returned an unsupported upload host", "UNSUPPORTED_UPLOAD_HOST", true);
  }
  const upload = await fetch(ticket.presignedUrl, {
    method: "PUT",
    headers: {"Content-Type": contentType},
    body: blob
  });
  if (!upload.ok) {
    throw squareError(`Image upload failed: HTTP ${upload.status}`, `IMAGE_UPLOAD_HTTP_${upload.status}`);
  }
  for (let attempt = 0; attempt < MAX_IMAGE_POLL_RETRIES; attempt++) {
    const status = await callSquare(
      `${SQUARE_UPLOAD_URL}/image/imageStatus`,
      apiKey,
      {fileTicket: ticket.fileTicket}
    );
    if (status.status === 1 && status.imageUrl) return status.imageUrl;
    if (status.status === 2) {
      throw squareError(
        `Binance image processing failed: ${status.failedReason || "unknown reason"}`,
        "IMAGE_PROCESSING_FAILED",
        true
      );
    }
    if (attempt + 1 < MAX_IMAGE_POLL_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, IMAGE_POLL_INTERVAL_MS));
    }
  }
  throw squareError("Binance image processing timed out", "IMAGE_PROCESSING_TIMEOUT");
}
async function prepareImages(item, apiKey, queue, eventId) {
  const sourceUrls = sanitizeImageUrls(item.payload?.image_urls);
  if (!sourceUrls.length) return [];
  const uploaded = Array.isArray(item.uploaded_image_urls)
    ? item.uploaded_image_urls.slice(0, sourceUrls.length)
    : [];
  for (let index = uploaded.length; index < sourceUrls.length; index++) {
    uploaded.push(await uploadXImage(sourceUrls[index], apiKey, eventId, index));
    item.uploaded_image_urls = [...uploaded];
    item.updated_at = Date.now();
    queue[eventId] = item;
    await saveQueue(queue);
  }
  return uploaded;
}
async function publishOnce(text, apiKey, imageList = []) {
  const body = {contentType: 1, bodyTextOnly: text};
  if (imageList.length) body.imageList = imageList;
  const data = await callSquare(SQUARE_URL, apiKey, body);
  if (data.publishStatus === "success_without_post_id") {
    return {id: "", url: "", published_without_id: true};
  }
  const id = String(data.id || "");
  if (!id) throw squareError("Binance returned success without a post ID", "MISSING_POST_ID");
  return {
    id,
    url: String(data.shareLink || `https://www.binance.com/square/post/${id}`)
  };
}
async function publish(text, apiKey, imageList = []) {
  try {
    return await publishOnce(text, apiKey, imageList);
  } catch (error) {
    // Binance Square may reject otherwise valid posts with code 20041 when a
    // URL is considered risky. Preserve links on the first attempt; only when
    // Binance explicitly rejects them do we remove URLs and retry once.
    if (error?.code !== "20041") throw error;
    const withoutUrls = stripUrls(text);
    if (!withoutUrls || withoutUrls === text.trim()) throw error;
    const result = await publishOnce(withoutUrls, apiKey, imageList);
    return {...result, links_removed: true};
  }
}
async function deliver(eventId) {
  const queue = await getQueue();
  const item = queue[eventId];
  if (!item || item.status === "published" || item.status === "blocked") return;
  const cfg = await config();
  if (cfg.enabled === false || !cfg.squareApiKey) return;
  try {
    item.status = "sending";
    item.updated_at = Date.now();
    queue[eventId] = item;
    await saveQueue(queue);
    const imageList = await prepareImages(item, cfg.squareApiKey, queue, eventId);
    const textToPublish = item.retry_text || item.payload.text;
    const result = item.retry_without_links
      ? await publishOnce(textToPublish, cfg.squareApiKey, imageList)
      : await publish(textToPublish, cfg.squareApiKey, imageList);
    item.status = "published";
    item.square_id = result.id;
    item.square_url = result.url;
    item.image_count = imageList.length;
    item.links_removed = Boolean(result.links_removed || item.retry_without_links);
    item.last_error = "";
    await setLast({
      ok: true,
      event_id: eventId,
      square_url: result.url,
      username: item.payload.username,
      links_removed: item.links_removed,
      image_count: imageList.length,
      published_without_id: Boolean(result.published_without_id)
    });
  } catch (error) {
    item.attempts = (item.attempts || 0) + 1;
    item.status = error?.permanent || item.attempts >= MAX_ATTEMPTS ? "blocked" : "pending";
    item.last_error = String(error?.message || error).slice(0, 300);
    item.error_code = String(error?.code || "unknown");
    item.rejected_at = Date.now();
    await setLast({ok: false, event_id: eventId, error: item.last_error, error_code: item.error_code, status: item.status, username: item.payload.username});
  }
  item.updated_at = Date.now();
  queue[eventId] = item;
  await saveQueue(queue);
}
async function retryAll(forceBlocked = false, removeLinks = false) {
  const queue = await getQueue();
  let linksRemoved = 0;
  let skippedEmpty = 0;
  for (const [eventId, item] of Object.entries(queue)) {
    // Never retry records created by the former automatic-sync versions.
    // Only posts explicitly selected in manual mode carry this marker.
    if (item.source !== "manual") continue;
    if (forceBlocked && item.status === "blocked") {
      if (removeLinks) {
        const original = String(item.payload?.text || "").trim();
        const cleaned = stripUrls(original);
        if (cleaned !== original) {
          if (!cleaned) {
            skippedEmpty++;
            continue;
          }
          item.retry_text = cleaned;
          item.retry_without_links = true;
          linksRemoved++;
        }
      }
      item.status = "pending";
      item.attempts = 0;
      queue[eventId] = item;
      await saveQueue(queue);
    }
    if (["pending", "sending"].includes(item.status) && (item.attempts || 0) < MAX_ATTEMPTS) await deliver(eventId);
  }
  return {links_removed_count: linksRemoved, skipped_empty_count: skippedEmpty};
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "RETRY_ALL" || message?.type === "RETRY_WITHOUT_LINKS") {
    retryAll(true, message.type === "RETRY_WITHOUT_LINKS")
      .then(result => sendResponse({ok:true, ...result}))
      .catch(e => sendResponse({ok:false,error:String(e)}));
    return true;
  }
  // Manual mode: only explicit clicks from manual-sync.js may create a post.
  if (message?.type !== "SYNC_MANUAL_POST") return;
  (async () => {
    const payload = message.payload || {};
    const username = normalizeUsername(payload.username);
    const currentUsername = normalizeUsername(payload.current_username);
    if (!payload.event_id || typeof payload.text !== "string" || !username || !currentUsername) {
      throw new Error("Invalid X post payload");
    }
    if (currentUsername !== username) {
      sendResponse({ok: false, ignored: true, reason: "not_own_post"});
      return;
    }
    delete payload.current_username;
    payload.image_urls = sanitizeImageUrls(payload.image_urls);
    if (!payload.text.trim()) {
      await setLast({
        ok: false,
        status: "blocked",
        error: "币安广场要求图片帖子包含文字，请在 X 图片帖子中添加正文",
        error_code: "IMAGE_CAPTION_REQUIRED",
        username
      });
      sendResponse({ok: false, error: "image caption required"});
      return;
    }
    const cfg = await config();
    if (!cfg.squareApiKey) {
      await setLast({ok:false, status:"not_configured", error:"请先填写币安广场 OpenAPI Key"});
      sendResponse({ok:false, error:"not configured"});
      return;
    }
    if (cfg.enabled === false) {
      sendResponse({ok:false, error:"disabled"});
      return;
    }
    const blockedKeyword = findBlockedKeyword(payload.text, cfg.blockKeywords);
    if (blockedKeyword) {
      await setLast({
        ok: false,
        status: "skipped_keyword",
        skipped: true,
        matched_keyword: blockedKeyword,
        error: `命中不同步关键词：${blockedKeyword}`,
        username
      });
      sendResponse({ok: true, skipped: true, reason: "keyword", keyword: blockedKeyword});
      return;
    }
    const bound = normalizeUsername(cfg.boundUsername);
    if (bound && bound !== username) {
      await setLast({ok:false, status:"account_mismatch", error:`扩展已绑定 @${bound}，忽略 @${username} 的推文`});
      sendResponse({ok:false, ignored:true});
      return;
    }
    if (!bound) await chrome.storage.local.set({boundUsername: username});
    payload.username = username;
    const queue = await getQueue();
    const existing = queue[payload.event_id];
    if (!existing || !samePostPayload(existing.payload, payload)) {
      queue[payload.event_id] = {
        payload,
        source: "manual",
        status: "pending",
        attempts: 0,
        created_at: Date.now()
      };
      await saveQueue(queue);
    }
    await deliver(payload.event_id);
    const latest = (await getQueue())[payload.event_id];
    sendResponse({
      ok: latest?.status === "published",
      status: latest?.status || "unknown",
      square_url: latest?.square_url || "",
      message: latest?.last_error || ""
    });
  })().catch(error => sendResponse({ok:false, error:String(error?.message || error)}));
  return true;
});
chrome.runtime.onInstalled.addListener(async details => {
  await chrome.alarms.create(ALARM, {periodInMinutes: 1});
  const current = await chrome.storage.local.get(["enabled", "squareApiKey", "blockKeywords"]);
  if (typeof current.enabled !== "boolean") await chrome.storage.local.set({enabled:true});
  if (!Array.isArray(current.blockKeywords)) {
    await chrome.storage.local.set({blockKeywords: DEFAULT_BLOCK_KEYWORDS});
  }
  if (details.reason === "update") {
    const queue = await getQueue();
    const manualQueue = Object.fromEntries(
      Object.entries(queue).filter(([, item]) => item?.source === "manual")
    );
    if (Object.keys(manualQueue).length !== Object.keys(queue).length) {
      await saveQueue(manualQueue);
    }
  }
  await updateBadge(await getQueue());
  if (details.reason === "install" && !current.squareApiKey) await chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(() => chrome.alarms.create(ALARM, {periodInMinutes: 1}));
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) retryAll(); });
