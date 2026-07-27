# bgsave

**Freeze a set of browser tabs and reopen them exactly where you left off — scroll positions, text selections, and highlights included.**

Built for developers who juggle "the auth investigation," "the Redis latency thing," and "the design review" as three separate workspaces they want to swap between without losing their place.

<!-- Add screenshot / GIF here once available -->

---

## Why bgsave

Chrome's built-in "recently closed" and every session-saver extension I tried gave me back the URLs, but never the *state* — the scroll position halfway down the long RFC, the anchor text I'd selected in the docs, the highlight I'd made across three tabs. bgsave restores that too.

**Non-goals** (on purpose):

- No cloud sync, no account, no login
- No telemetry, no analytics, no external network calls
- Not a replacement for browser history — this is for named, curated workspaces

---

## What it does

- **Freeze** the current window as a named workspace — captures every tab's URL, title, scroll position, selected/anchor text, and any highlights you've made
- **Restore** a workspace into a new window with the tabs in their original order, pinned states preserved, and per-tab state re-applied
- **Append** any tab into an existing workspace via right-click → *Add to workspace*
- **Manage** workspaces — rename, delete, or remove individual tabs — from the options page
- **Highlights** — select text on any page and save it as a colored highlight; it's re-applied when you restore that tab
- **Quota-aware** — Chrome's 10 MB storage cap is respected; you'll see a clear message before any silent data loss

---

## Privacy

- All data lives in `chrome.storage.local` on your machine. It never leaves your device.
- No servers, no accounts, no third-party requests.
- The extension needs broad host permissions (`<all_urls>`) so it can inject the content script that captures scroll/highlight state on every page. It reads that state only when you explicitly freeze or capture a tab.

---

## Install

Coming soon on the Chrome Web Store.

---

## Development

```bash
pnpm install
pnpm dev        # Vite dev server with HMR
pnpm test       # Vitest — 200+ tests
pnpm typecheck  # tsc --noEmit
pnpm build      # emit dist/
```

For loading the dev build into Chrome, follow the same "Load unpacked" steps as above but point at `dist/`. HMR works for the popup, options page, and content script. The service worker requires a manual reload from `chrome://extensions` after changes.

### Layout

```
src/
├── background/   Service worker: message router, freeze/restore/append, context menu
├── content/      Content script: captures scroll + highlights, re-applies on restore
├── popup/        Toolbar popup: workspace list + freeze form
├── options/      Full-page manage view: rename, delete, remove tabs, previews
├── welcome/      First-run welcome tab
└── shared/       Storage, messaging, validators, constants, types
```

---

## Contributing

Issues and PRs welcome — especially bug reports if a restore ever fails to reproduce a page's state.

## License

MIT
