# Privacy

## What the extension reads

The extension runs on `x.com` and `twitter.com` so it can identify the currently signed-in username and display a manual sync button only beside that account's own posts. It does not automatically publish posts.

Only after the user clicks that button, the extension reads the selected post's:

- text;
- hashtags, cashtags, and paragraph breaks contained in that text;
- author username;
- status ID and URL;
- up to four attached X image URLs.

Quoted-post images are excluded from the selected post's image list.

## What the extension stores locally

The extension stores the Binance Square API key, enable switch, keyword blocklist, bound X username, selected-post delivery queue, and latest delivery status in `chrome.storage.local`.

The delivery queue contains only posts explicitly selected by the user. Records left by older automatic-sync versions are discarded during the v2.0 update and are never retried.

## Network access

Network requests are limited to:

- X image hosts, to download images from a post selected by the user;
- Binance Square OpenAPI, to publish the selected text and images.

The extension has no analytics, advertising, telemetry, or third-party collection endpoint.

## Data handling

- The API key remains in the browser's local extension storage.
- Downloaded image bytes are kept only as part of the local delivery record until that record is pruned.
- No data is sold or shared with unrelated third parties.
- Disabling the extension prevents new manual submissions.
