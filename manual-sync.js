(() => {
  if (globalThis.__xSquareManualSyncInstalled) return;
  globalThis.__xSquareManualSyncInstalled = true;

  const BUTTON_CLASS = "x-square-manual-sync-button";
  const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
  const SHOW_MORE_SELECTOR = '[data-testid="tweet-text-show-more-link"]';
  const STATUS_PATTERN = /^\/([^/]+)\/status\/(\d+)/i;
  const USERNAME_PATTERN = /^[a-zA-Z0-9_]{1,15}$/;
  let ownUsername = "";
  let scanTimer = 0;

  function normalizeUsername(value) {
    return String(value || "").trim().replace(/^@/, "").toLowerCase();
  }

  function parseStatusUrl(value) {
    try {
      const url = new URL(String(value || ""), location.origin);
      const match = url.pathname.match(STATUS_PATTERN);
      if (!match) return null;
      return {
        username: match[1],
        tweetId: match[2],
        url: `https://x.com/${match[1]}/status/${match[2]}`
      };
    } catch (_) {
      return null;
    }
  }

  function directElements(article, selector) {
    return [...article.querySelectorAll(selector)].filter(node => node.closest(ARTICLE_SELECTOR) === article);
  }

  function statusInfo(article) {
    const timedLink = directElements(article, 'a[href*="/status/"] time')
      .map(time => time.closest("a"))
      .find(Boolean);
    if (timedLink) return parseStatusUrl(timedLink.getAttribute("href") || timedLink.href);
    for (const link of directElements(article, 'a[href*="/status/"]')) {
      const parsed = parseStatusUrl(link.getAttribute("href") || link.href);
      if (parsed) return parsed;
    }
    return null;
  }

  function usernameFromProfileHref(value) {
    try {
      const url = new URL(String(value || ""), location.origin);
      const segment = url.pathname.split("/").filter(Boolean)[0] || "";
      return USERNAME_PATTERN.test(segment) ? normalizeUsername(segment) : "";
    } catch (_) {
      return "";
    }
  }

  function detectOwnUsername() {
    const accountSwitcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    const accountMatch = String(accountSwitcher?.innerText || accountSwitcher?.textContent || "")
      .match(/@([a-zA-Z0-9_]{1,15})\b/);
    if (accountMatch) return normalizeUsername(accountMatch[1]);

    const profileLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"][href]');
    return usernameFromProfileHref(profileLink?.getAttribute("href") || profileLink?.href || "");
  }

  function primaryTextElement(article) {
    return directElements(article, '[data-testid="tweetText"]')
      .find(node => !node.closest('[data-testid="quoteTweet"]')) || null;
  }

  function extractText(article) {
    const textElement = primaryTextElement(article);
    if (!textElement) return "";
    let text = String(textElement.innerText || textElement.textContent || "")
      .replace(/\r\n?/g, "\n")
      .trim();

    // X renders hashtags and cashtags as links. innerText normally includes
    // them, but append any missing linked tag as a safeguard against DOM variants.
    const missingTags = [...textElement.querySelectorAll("a")]
      .map(link => String(link.innerText || link.textContent || "").trim())
      .filter(token => /^[#$][^\s#$]+$/u.test(token) && !text.includes(token));
    if (missingTags.length) text = `${text}${text ? "\n\n" : ""}${[...new Set(missingTags)].join(" ")}`;
    return text;
  }

  function findShowMoreButton(article) {
    return directElements(article, SHOW_MORE_SELECTOR).find(node =>
      !node.closest('[data-testid="quoteTweet"]') && typeof node.click === "function" && !node.disabled
    ) || null;
  }

  function resolveArticle(tweetId) {
    return [...document.querySelectorAll(ARTICLE_SELECTOR)].find(article =>
      statusInfo(article)?.tweetId === tweetId
    ) || null;
  }

  function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  async function waitForExpansion(tweetId, previousText) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 2000) {
      await wait(60);
      const article = resolveArticle(tweetId);
      if (!article) continue;
      if (extractText(article) !== previousText || !findShowMoreButton(article)) {
        await wait(120);
        return article;
      }
    }
    return resolveArticle(tweetId);
  }

  async function expandTweetText(article, tweetId) {
    let current = resolveArticle(tweetId) || article;
    for (let attempt = 0; attempt < 4; attempt++) {
      const showMore = findShowMoreButton(current);
      if (!showMore) return current;
      const previousText = extractText(current);
      showMore.click();
      current = await waitForExpansion(tweetId, previousText) || current;
    }
    return current;
  }

  function ownImageUrls(article, tweetId) {
    const urls = [];
    const seen = new Set();
    for (const image of directElements(article, 'img[src*="pbs.twimg.com/media/"]')) {
      if (image.closest('[data-testid="quoteTweet"]')) continue;
      const mediaLink = image.closest('a[href*="/status/"]');
      const mediaStatus = mediaLink
        ? parseStatusUrl(mediaLink.getAttribute("href") || mediaLink.href)
        : null;
      if (mediaStatus && mediaStatus.tweetId !== tweetId) continue;
      const src = String(image.currentSrc || image.src || "");
      if (!src || seen.has(src)) continue;
      seen.add(src);
      urls.push(src);
      if (urls.length >= 4) break;
    }
    return urls;
  }

  function payloadFromArticle(article, currentUsername) {
    const info = statusInfo(article);
    if (!info) return null;
    return {
      event_id: `x:${info.tweetId}`,
      tweet_id: info.tweetId,
      username: info.username,
      current_username: currentUsername,
      text: extractText(article),
      image_urls: ownImageUrls(article, info.tweetId),
      source_url: info.url
    };
  }

  function actionGroup(article) {
    return directElements(article, '[role="group"]').find(group =>
      group.querySelector('[data-testid="reply"], [data-testid="retweet"], [data-testid="like"]')
    ) || null;
  }

  function setButtonState(button, state, detail = "") {
    const states = {
      idle: ["同步完整推文到币安广场", "同步"],
      expanding: ["正在展开并读取完整推文", "读取全文…"],
      sending: ["正在同步到币安广场", "同步中…"],
      success: ["已同步到币安广场", "已同步"],
      skipped: [detail || "该推文已跳过", "已跳过"],
      error: [detail || "同步失败", "失败，重试"]
    };
    const [title, label] = states[state] || states.idle;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.dataset.state = state;
    button.querySelector("span").textContent = label;
    button.disabled = ["expanding", "sending", "success", "skipped"].includes(state);
  }

  function currentButton(tweetId, fallback) {
    return resolveArticle(tweetId)?.querySelector(`.${BUTTON_CLASS}`) || fallback;
  }

  async function syncArticle(article, button) {
    const initialInfo = statusInfo(article);
    const currentUsername = detectOwnUsername();
    if (!initialInfo || !currentUsername || normalizeUsername(initialInfo.username) !== currentUsername) {
      button.remove();
      return;
    }

    setButtonState(button, findShowMoreButton(article) ? "expanding" : "sending");
    try {
      const expandedArticle = await expandTweetText(article, initialInfo.tweetId);
      const activeButton = currentButton(initialInfo.tweetId, button);
      if (findShowMoreButton(expandedArticle)) {
        setButtonState(activeButton, "error", "X 未能展开全文，请打开推文详情页后再同步");
        return;
      }
      const payload = payloadFromArticle(expandedArticle, currentUsername);
      if (!payload) {
        setButtonState(activeButton, "error", "无法识别这条推文");
        return;
      }
      if (!payload.text) {
        setButtonState(activeButton, "error", "币安要求图片帖子包含文字");
        return;
      }
      setButtonState(activeButton, "sending");
      const result = await chrome.runtime.sendMessage({type: "SYNC_MANUAL_POST", payload});
      if (result?.skipped) {
        setButtonState(activeButton, "skipped", `命中不同步关键词：${result.keyword || "未知"}`);
      } else if (result?.ok && result?.status === "published") {
        setButtonState(activeButton, "success");
      } else if (result?.error === "disabled") {
        setButtonState(activeButton, "error", "同步已暂停，请先在插件弹窗恢复");
      } else if (result?.error === "not configured") {
        setButtonState(activeButton, "error", "请先填写币安广场 OpenAPI Key");
      } else if (result?.ignored) {
        setButtonState(activeButton, "error", "只允许同步当前登录账号自己的推文");
      } else {
        setButtonState(activeButton, "error", result?.message || result?.error || "同步失败");
      }
    } catch (error) {
      setButtonState(currentButton(initialInfo.tweetId, button), "error", String(error?.message || error));
    }
  }

  function makeButton(article, info) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = BUTTON_CLASS;
    button.dataset.tweetId = info.tweetId;
    button.style.cssText = [
      "border:0", "background:transparent", "color:rgb(29,155,240)",
      "font:600 12px system-ui,sans-serif", "padding:0 8px", "cursor:pointer",
      "min-width:54px", "height:34px", "border-radius:9999px"
    ].join(";");
    const label = document.createElement("span");
    button.appendChild(label);
    setButtonState(button, "idle");
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      syncArticle(article, button);
    });
    return button;
  }

  function enhanceArticle(article) {
    if (!(article instanceof Element)) return;
    const info = statusInfo(article);
    const existing = article.querySelector(`.${BUTTON_CLASS}`);
    const isOwnPost = Boolean(ownUsername) && normalizeUsername(info?.username) === ownUsername;
    if (!isOwnPost || !info) {
      existing?.remove();
      return;
    }
    if (existing?.dataset.tweetId === info.tweetId) return;
    existing?.remove();
    const group = actionGroup(article);
    if (group) group.appendChild(makeButton(article, info));
  }

  function scan(root = document) {
    if (root instanceof Element && root.matches(ARTICLE_SELECTOR)) enhanceArticle(root);
    for (const article of root.querySelectorAll?.(ARTICLE_SELECTOR) || []) enhanceArticle(article);
  }

  function refreshIdentityAndScan(root = document) {
    const detected = detectOwnUsername();
    if (detected !== ownUsername) {
      ownUsername = detected;
      for (const button of document.querySelectorAll(`.${BUTTON_CLASS}`)) button.remove();
      scan(document);
      return;
    }
    scan(root);
  }

  function scheduleScan(root = document) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => refreshIdentityAndScan(root), 80);
  }

  if (globalThis.__X_SQUARE_MANUAL_TEST__) {
    Object.assign(globalThis.__X_SQUARE_MANUAL_TEST__, {
      parseStatusUrl,
      detectOwnUsername,
      extractText,
      findShowMoreButton,
      expandTweetText
    });
    return;
  }

  refreshIdentityAndScan();
  new MutationObserver(mutations => {
    const addedRoots = mutations.flatMap(mutation => [...mutation.addedNodes])
      .filter(node => node instanceof Element);
    scheduleScan(addedRoots.length === 1 ? addedRoots[0] : document);
  }).observe(document.documentElement, {childList: true, subtree: true});
})();
