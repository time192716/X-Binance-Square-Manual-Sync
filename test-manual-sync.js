const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

(async () => {
  let expanded = false;
  const article = {
    querySelectorAll(selector) {
      if (selector === 'a[href*="/status/"] time') return [timeElement];
      if (selector === 'a[href*="/status/"]') return [statusLink];
      if (selector === '[data-testid="tweetText"]') return [textElement];
      if (selector === '[data-testid="tweet-text-show-more-link"]') return expanded ? [] : [showMoreButton];
      return [];
    }
  };
  const statusLink = {
    href: "https://x.com/Alice/status/123",
    getAttribute(name) { return name === "href" ? "/Alice/status/123" : null; }
  };
  const timeElement = {
    closest(selector) {
      if (selector === 'article[data-testid="tweet"]') return article;
      if (selector === "a") return statusLink;
      return null;
    }
  };
  const tags = [
    {innerText: "#Acurast", textContent: "#Acurast"},
    {innerText: "$ACU", textContent: "$ACU"}
  ];
  const textElement = {
    get innerText() { return expanded ? "第一段\n\n完整结尾 #Acurast" : "第一段…"; },
    get textContent() { return this.innerText; },
    closest(selector) {
      if (selector === 'article[data-testid="tweet"]') return article;
      if (selector === '[data-testid="quoteTweet"]') return null;
      return null;
    },
    querySelectorAll(selector) { return selector === "a" ? tags : []; }
  };
  const showMoreButton = {
    disabled: false,
    closest(selector) {
      if (selector === 'article[data-testid="tweet"]') return article;
      if (selector === '[data-testid="quoteTweet"]') return null;
      return null;
    },
    click() { expanded = true; }
  };
  const document = {
    querySelector(selector) {
      if (selector === '[data-testid="SideNav_AccountSwitcher_Button"]') {
        return {innerText: "Alice\n@Alice"};
      }
      return null;
    },
    querySelectorAll(selector) {
      return selector === 'article[data-testid="tweet"]' ? [article] : [];
    }
  };
  const hooks = {};
  const context = {
    __X_SQUARE_MANUAL_TEST__: hooks,
    document,
    location: {origin: "https://x.com"},
    URL,
    Date,
    Promise,
    setTimeout,
    clearTimeout,
    console
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("manual-sync.js", "utf8"), context);

  assert.equal(hooks.detectOwnUsername(), "alice");
  assert.deepEqual(
    JSON.parse(JSON.stringify(hooks.parseStatusUrl("/Alice/status/123"))),
    {username: "Alice", tweetId: "123", url: "https://x.com/Alice/status/123"}
  );
  assert.equal(hooks.extractText(article), "第一段…\n\n#Acurast $ACU");
  const result = await hooks.expandTweetText(article, "123");
  assert.equal(result, article);
  assert.equal(hooks.findShowMoreButton(article), null);
  assert.equal(hooks.extractText(article), "第一段\n\n完整结尾 #Acurast\n\n$ACU");

  console.log("manual X DOM extraction: PASS");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
