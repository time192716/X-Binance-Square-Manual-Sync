# Changelog

## 2.1.0 — 2026-10-01

- Shows the manual sync button only on posts authored by the currently signed-in X account.
- Verifies the current X username again in the service worker before queueing a post.
- Expands X's truncated long-post text before extraction and refuses to publish if the full text cannot be expanded.
- Preserves paragraph breaks, hashtags, and cashtags; missing linked tags are appended as a DOM-compatibility safeguard.
- Excludes quoted-post text, expansion controls, and images from the selected post's own content.

## 2.0.0 — 2026-10-01

- Replaces automatic `CreateTweet` interception with explicit per-post manual sync.
- Adds a “同步” button to each X post action bar; posts are sent only after a user click.
- Removes the MAIN-world page hook and message bridge from the extension manifest and package.
- Rejects the legacy automatic queue message type in the service worker.
- Extracts the selected post's text, canonical status URL, author, and up to four of its own images from the visible X page.
- Keeps image upload, keyword blocking, account binding, retries, and pause/resume controls.

## 1.4.0 — 2026-07-31

- Adds a configurable, case-insensitive keyword blocklist for posts that must not be synchronized.
- Uses `OKX`, `OKEx`, and `欧易` as conservative defaults; users can add, remove, or clear keywords in settings.
- Filters matching posts before image download, Binance requests, queueing, or X-account binding.
- Adds a one-click pause/resume button to the extension popup.
- Shows the matched keyword when a post is skipped.

## 1.3.0 — 2026-07-27

- Synchronizes up to four photos from new original or quote X posts.
- Downloads only X photo media from `pbs.twimg.com`; videos and animated GIFs remain excluded.
- Uploads photos through Binance Square's official presigned-image workflow before publishing them in `imageList`.
- Polls Binance image processing and caches processed image URLs so post retries do not upload the same images again.
- Adds narrowly scoped host access for X image downloads and Binance's S3 presigned uploads.
- Shows the synchronized image count in the extension popup.

## 1.2.4 — 2026-07-19

- When manually retrying rejected posts that contain links, asks for confirmation first.
- After confirmation, removes URLs and publishes only the remaining text.
- Shows how many rejected posts had their links removed and were resubmitted.
- Keeps the original captured text in local history; the sanitized text is used only for the retry request.

## 1.2.3 — 2026-07-19

- Displays an explicit “rejected by Binance” state for permanent publishing failures.
- Shows the Binance error code, rejection reason, timestamp, and a short post excerpt in the popup.
- Keeps the three most recent rejected records visible in the popup.
- Uses a red extension badge when blocked/rejected posts exist; orange remains reserved for retryable items.
- Escapes all remote error text before rendering it in the popup.

## 1.2.2 — 2026-07-19

- Preserves ordinary user links on the first Binance Square publishing attempt.
- If Binance explicitly rejects a URL with risk-control code `20041`, removes URLs and retries the same post once automatically.
- Shows a success note when links were removed by the fallback.
- Manual “retry now” can retry previously blocked queue items after an upgrade.
- Includes Binance error codes in status messages for easier diagnosis.

## 1.2.1 — 2026-07-19

- Replaced the generic extension icon with the supplied yellow Binance mascot artwork.
- Added optimized 16, 32, 48, and 128 px icons using a face-focused crop for toolbar readability.

## 1.2.0 — 2026-07-19

- Open-source MIT release with privacy and security documentation.
- Saved Square OpenAPI keys are never restored into the options page DOM.
- Key input is cleared immediately after saving and only a configured/not-configured state remains visible.
- Unrelated X request bodies are skipped before parsing; only `CreateTweet` requests are inspected.
- Added explicit extension CSP and disabled incognito execution.
- Added static security audit covering permissions, clipboard APIs, remote code, private data, and key UI behavior.
- Media-only trailing `t.co` links are removed while ordinary user links remain intact.

## 1.1.x

- Added quote-post support, media text cleanup, local X-account binding, queue deduplication, and retries.
