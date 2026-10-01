# Security Notes

## Manual-only boundary

Version 2.1 accepts new delivery records only from the `SYNC_MANUAL_POST` extension message emitted after a user clicks a post's sync button. The former automatic `CreateTweet` interception files are not included in the manifest or package.

The content script resolves the currently signed-in X username from X's account UI and displays buttons only on posts whose author matches it. The service worker requires the same current username in the request and rejects any author mismatch before queueing.

During an upgrade, queue entries without the `source: "manual"` marker are removed. Alarm-based retries also ignore any non-manual record.

## Content validation

- Post IDs and usernames are normalized before storage.
- Image URLs must use HTTPS and an approved X image hostname.
- The keyword blocklist is checked before account binding, image download, queue insertion, or publication.
- Empty-text posts are rejected.
- A bound X username prevents accidental publication from another account.

## Binance Square requests

- Requests use the configured Binance Square OpenAPI HTTPS endpoint.
- The API key is sent only in the Binance Square request header.
- Image uploads are limited to four images and use downloaded bytes from approved X hosts.
- Permanent API rejections are not retried automatically; temporary failures have a bounded retry count.

## Browser permissions

The extension requests only local storage, alarms, and host access needed for X pages, X media, and the Binance Square API. It does not request browsing history, downloads, tabs, cookies, or clipboard permissions.

## Reporting

Do not publish API keys or sensitive logs in a public issue. Revoke a key immediately if it may have been exposed.
