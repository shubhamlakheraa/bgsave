# Privacy Policy — bgsave

**Last updated: 2026-07-28**

bgsave is a Chrome extension that freezes and restores browser workspaces (tabs, scroll positions, and text highlights).

## What data bgsave collects

**None.** bgsave does not collect, transmit, sell, or share any personal information or usage data.

## What data bgsave stores locally

The extension stores the following data on your device using Chrome's built-in `chrome.storage.local` API. This data never leaves your browser:

- **Workspace metadata** — the name you give each workspace, when you created it, when you last updated it
- **Tab information** — URLs, titles, pinned status, tab order, and group memberships of the tabs you explicitly choose to freeze
- **Scroll positions** — the vertical scroll position of tabs at the time of freezing, so pages can be restored to where you left off
- **Text selections and highlights** — the text you have selected on a page or highlighted using bgsave, so they can be re-applied on restore
- **iframe state** — scroll positions inside iframes on frozen pages

All of this data is stored only when you explicitly freeze a workspace or append a tab. Simply having the extension installed does not cause any data to be collected.

## What data bgsave does NOT collect

- No analytics
- No telemetry
- No crash reports
- No account, no login, no email
- No cookies
- No external network requests of any kind

The extension makes no HTTP requests to any server. It is a fully offline, local-only tool.

## Third parties

bgsave does not use any third-party services, SDKs, analytics providers, or advertising networks.

## Permissions used

bgsave requests broad host permissions (`<all_urls>`) so that its content script can capture scroll position, text selections, and highlights on any page you choose to freeze. The content script only reads page state when you explicitly trigger a freeze or capture action from the extension. It never transmits captured data anywhere — it only stores it in `chrome.storage.local` on your device.

## Data deletion

You can delete all data stored by bgsave at any time by:

- Deleting individual workspaces from the extension's manage page, or
- Uninstalling the extension (Chrome automatically clears all associated `chrome.storage.local` data)

## Changes to this policy

If the extension's data practices ever change, this document will be updated with a new "Last updated" date. Since bgsave collects no data today, any future change that involves collecting or transmitting data will be announced via a version release note.

## Contact

Questions or concerns: file an issue at https://github.com/shubhamlakheraa/bgsave/issues
