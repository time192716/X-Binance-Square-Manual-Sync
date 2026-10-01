#!/usr/bin/env python3
"""Static security assertions for the distributable extension."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))

assert manifest["manifest_version"] == 3
assert manifest["version"] == "2.1.0"
assert set(manifest["permissions"]) == {"storage", "alarms"}
assert manifest.get("incognito") == "not_allowed"
assert "<all_urls>" not in manifest["host_permissions"]
assert set(manifest["host_permissions"]) == {
    "https://x.com/*",
    "https://twitter.com/*",
    "https://www.binance.com/*",
    "https://pbs.twimg.com/*",
    "https://*.amazonaws.com/*",
    "https://*.amazonaws.com.cn/*",
}
assert manifest["content_security_policy"]["extension_pages"] == "script-src 'self'; object-src 'self'"

source_files = [*ROOT.glob("*.js"), *ROOT.glob("*.html"), *ROOT.glob("*.json")]
source = "\n".join(path.read_text(encoding="utf-8") for path in source_files)
for forbidden in [
    "clipboardRead", "clipboardWrite", "navigator.clipboard", "document.execCommand",
    "chrome.cookies", "chrome.history", "chrome.downloads", "chrome.webRequest",
    "chrome.debugger", "nativeMessaging", "<all_urls>", "storage.sync",
    "eval(", "new Function(",
]:
    assert forbidden not in source, f"forbidden capability found: {forbidden}"

# No live secret, private webhook, or user-specific account should ship.
for forbidden in ["EXTENSION_WEBHOOK_TOKEN", "xauth.43-155", "ferdie_jhovie", "6MEOvb"]:
    assert forbidden not in source, f"private data found: {forbidden}"

options = (ROOT / "options.js").read_text(encoding="utf-8")
assert "keyEl.value = values.squareApiKey" not in options
assert 'keyEl.value = ""' in options
assert "chrome.storage.local" in options and "chrome.storage.sync" not in options

content_scripts = manifest["content_scripts"]
assert len(content_scripts) == 1
assert content_scripts[0]["js"] == ["manual-sync.js"]
assert content_scripts[0]["run_at"] == "document_idle"

manual = (ROOT / "manual-sync.js").read_text(encoding="utf-8")
assert 'type: "SYNC_MANUAL_POST"' in manual
assert 'article[data-testid="tweet"]' in manual
assert "MutationObserver" in manual
assert 'tweet-text-show-more-link' in manual
assert 'AppTabBar_Profile_Link' in manual
assert 'SideNav_AccountSwitcher_Button' in manual
assert 'current_username: currentUsername' in manual
assert 'token => /^[#$]' in manual

worker = (ROOT / "service-worker.js").read_text(encoding="utf-8")
assert 'url.hostname.toLowerCase() !== "pbs.twimg.com"' in worker
assert "imageList" in worker
assert "/image/presignedUrl" in worker
assert "/image/imageStatus" in worker
assert 'status: "skipped_keyword"' in worker
assert "findBlockedKeyword" in worker
assert 'message?.type !== "SYNC_MANUAL_POST"' in worker
assert 'message?.type !== "QUEUE_X_POST"' not in worker
assert 'reason: "not_own_post"' in worker

popup = (ROOT / "popup.js").read_text(encoding="utf-8")
assert 'getElementById("toggleSync")' in popup
assert "enabled: enabled === false" in popup

# Remote script tags would violate the no-remote-code design.
for html in ROOT.glob("*.html"):
    text = html.read_text(encoding="utf-8")
    assert not re.search(r'<script[^>]+src=["\']https?://', text, re.I), html.name

print("static security audit: PASS")
