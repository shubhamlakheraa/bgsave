# Chrome Web Store — listing content for bgsave

Copy-paste ready. Character counts noted where Google enforces limits.

---

## Short description (max 132 chars)

> Freeze tabs into named workspaces and restore them exactly — scroll positions, text selections, and highlights included.

**131 chars.** ✓

---

## Full description

> **Freeze a set of tabs into a named workspace, then restore them later exactly where you left off.**
>
> Built for developers and researchers who juggle multiple in-flight investigations — "the auth debug session," "the Redis latency thread," "the design review" — and want to swap between them without losing their place.
>
> Every other session saver gives you back the URLs. bgsave gives you back the *state*: the scroll position halfway down a long RFC, the text you had selected in the docs, the highlights you made across three tabs.
>
> ## Features
>
> • **Freeze** the current window as a named workspace — captures every tab's URL, title, scroll position, selected text, and any highlights you've made
> • **Restore** a workspace into a new window with the original tab order, pinned states, and per-tab state re-applied
> • **Append** any tab into an existing workspace via right-click → *Add to workspace*
> • **Manage** — rename, delete, or remove individual tabs from the options page
> • **Highlight** text on any page and it will be re-applied on restore
> • **Quota-aware** — clear messaging when Chrome's storage limit is reached, so you never lose data silently
>
> ## Privacy — the whole story
>
> • **No accounts, no login, no cloud**
> • **No analytics, no telemetry, no external requests** — the extension makes zero HTTP calls
> • **All data stays on your device** in Chrome's local storage
> • **Open source** — code is available at https://github.com/shubhamlakheraa/bgsave
>
> ## Non-goals
>
> bgsave is intentionally not:
> • A cloud-synced session manager (use the browser's built-in sync or a dedicated tool)
> • A history browser
> • A team collaboration tool
>
> It does one thing: freeze and restore your own workspaces on your own machine.
>
> ## Source & feedback
>
> Source code, bug reports, and feature requests: https://github.com/shubhamlakheraa/bgsave

---

## Category

**Productivity**

---

## Permission justifications

For the dev console form. One paragraph per permission.

### `tabs`

> Required to enumerate tabs in the current window when the user chooses to freeze a workspace, and to inspect existing tabs when appending a tab to an existing workspace. Only accessed when the user explicitly triggers a freeze, append, or restore action.

### `storage`

> Required to persist frozen workspaces locally using `chrome.storage.local`. All data stays on the user's device; nothing is transmitted anywhere.

### `scripting`

> Required to programmatically inject the content script into pages when needed to capture scroll position, text selections, and highlights at the moment of freezing, and to re-apply that state on restore.

### `activeTab`

> Required for the right-click "Add to workspace" context menu action, which captures the state of the tab the user is currently viewing and appends it to a chosen workspace.

### `contextMenus`

> Required to register the "Add to workspace" right-click menu that lets users append a single tab to an existing workspace without opening the popup.

### `windows`

> Required to open a new browser window when restoring a workspace, so that the restored tabs are grouped together in a dedicated window rather than mixed into the user's current one.

### `webNavigation`

> Required to enumerate all frames (including iframes) within a tab at freeze time, so that the extension can also capture and restore scroll position inside embedded frames — not just the top-level document.

### `<all_urls>` (host permissions)

> Required so the content script can capture and restore scroll position, text selections, and highlights on any page the user chooses to freeze. Restricting to specific domains would force users to pre-authorize every site they want to save state for, which is impractical for a general-purpose workspace tool. The content script only reads page state when the user explicitly triggers a freeze or capture action, and never transmits any data — all captured state is stored in `chrome.storage.local` on the user's device.

---

## Single-purpose statement

> bgsave freezes browser tabs into named workspaces and restores them exactly — including per-tab scroll positions, text selections, and highlights.

---

## Homepage / support URLs

- **Homepage URL**: https://github.com/shubhamlakheraa/bgsave
- **Support URL**: https://github.com/shubhamlakheraa/bgsave/issues
- **Privacy policy URL**: https://github.com/shubhamlakheraa/bgsave/blob/main/PRIVACY.md
