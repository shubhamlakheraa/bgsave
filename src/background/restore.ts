import { LIMITS } from '../shared/constants';
import type { HighlightStore } from '../shared/highlightStore';
import type { RestoreSummary } from '../shared/messaging';
import type { ProfileStore } from '../shared/storage';
import type { SavedTab, SavedWindow } from '../shared/types';
import type { FramesEnumerator, TabMessenger } from './freeze';

/**
 * Injectable interface for creating windows and tweaking tabs. Mirrors
 * TabFetcher's role for freeze — restore.ts stays free of chrome.* imports
 * so it's unit-testable in Node.
 */
export interface TabCreator {
  /**
   * Create a new window containing the given URLs, in order. `focused`
   * controls whether the window steals focus at creation time; restore
   * always creates unfocused windows and focuses one at the end to avoid
   * a flurry of window flashes.
   *
   * Returns the created windowId plus the tabIds in the same order as
   * `urls` so callers can zip them back against the SavedTab list.
   */
  createWindow(urls: string[], focused: boolean): Promise<{
    windowId: number;
    tabIds: number[];
  }>;

  // Update a single tab's `pinned` state (chrome.windows.create can't take
  // per-tab options, so pinned is restored as a post-step).
  setPinned(tabId: number, pinned: boolean): Promise<void>;

  focusWindow(windowId: number): Promise<void>;
}

/**
 * Wait until a tab reaches `status === 'complete'` (or the deadline
 * elapses). Separate from TabCreator because tests need to control it
 * independently from window creation.
 */
export interface TabLoadWaiter {
  waitForLoad(tabId: number, timeoutMs: number): Promise<boolean>;
}

export interface RestoreDeps {
  store: ProfileStore;
  highlights: HighlightStore;
  creator: TabCreator;
  waiter: TabLoadWaiter;
  messenger: TabMessenger;
  // Optional to keep test fixtures simple. When present, iframes get their
  // saved state re-applied too; when absent, only the top frame is restored.
  frames?: FramesEnumerator;
}

/**
 * Restore a saved profile:
 *  1. Look it up in ProfileStore. Bail if not found.
 *  2. Merge each URL's stored highlights so initHighlights() picks them up
 *     when the tab loads — no race with content-script startup.
 *  3. For each SavedWindow, create a Chrome window with its URLs, restore
 *     pinned state, wait for each tab to load, then push APPLY_STATE.
 *  4. Focus the window that was focused at capture time.
 *
 * Returns a per-restore summary so the popup can render a short toast.
 */
export async function restoreWorkspace(
  deps: RestoreDeps,
  args: { id: string },
): Promise<RestoreSummary> {
  const profile = await deps.store.getProfile(args.id);
  if (!profile) throw new Error(`Profile not found: ${args.id}`);

  // Merge highlights first — before any tab is created — so the content
  // script's initHighlights() reads a store that already contains them.
  await mergeHighlightsFromProfile(deps.highlights, profile.windows);

  const summary: RestoreSummary = {
    windowsCreated: 0,
    tabsCreated: 0,
    tabsWithState: 0,
    tabsFailed: 0,
  };

  let focusedWindowId: number | null = null;

  for (const win of profile.windows) {
    const orderedTabs = [...win.tabs].sort((a, b) => a.index - b.index);
    const urls = orderedTabs.map((t) => t.url);
    if (urls.length === 0) continue;

    const created = await deps.creator.createWindow(urls, false);
    summary.windowsCreated += 1;
    summary.tabsCreated += created.tabIds.length;

    if (win.focused) focusedWindowId = created.windowId;

    await restoreTabsInWindow(deps, orderedTabs, created.tabIds, summary);
  }

  if (focusedWindowId !== null) {
    // Focus the intended window after all windows exist so users see the
    // "main" one on top even if we happened to create others later.
    await deps.creator.focusWindow(focusedWindowId);
  }

  return summary;
}

async function mergeHighlightsFromProfile(
  store: HighlightStore,
  windows: SavedWindow[],
): Promise<void> {
  for (const win of windows) {
    for (const tab of win.tabs) {
      if (!tab.highlights || tab.highlights.length === 0) continue;
      // addHighlight is idempotent by (text, anchor), so merging profile
      // highlights on top of any newer ones the user has since made is
      // non-destructive. Cap enforcement + dedup are the store's job.
      for (const h of tab.highlights) {
        await store.addHighlight(tab.url, h);
      }
    }
  }
}

async function restoreTabsInWindow(
  deps: RestoreDeps,
  orderedTabs: SavedTab[],
  createdTabIds: number[],
  summary: RestoreSummary,
): Promise<void> {
  await Promise.all(
    orderedTabs.map(async (saved, i) => {
      const tabId = createdTabIds[i];
      if (tabId === undefined) return;

      // Restore pinned state up-front so it's visually stable while the
      // page is still loading.
      if (saved.pinned) {
        await deps.creator.setPinned(tabId, true).catch(() => undefined);
      }

      // Restricted tabs (chrome://, file://, Web Store) get no APPLY_STATE
      // because the content script doesn't run there. The tab is still
      // counted as created; it just doesn't need state restoration.
      if (saved.restricted) return;

      const hasCognitiveState =
        typeof saved.scrollY === 'number' || (saved.anchorText?.length ?? 0) > 0;
      if (!hasCognitiveState) return;

      const loaded = await deps.waiter.waitForLoad(
        tabId,
        LIMITS.RESTORE_LOAD_TIMEOUT_MS,
      );
      if (!loaded) {
        summary.tabsFailed += 1;
        return;
      }

      const result = await deps.messenger.applyState(tabId, {
        scrollY: saved.scrollY,
        anchorText: saved.anchorText,
      });
      if (!result || result.method === 'failed') {
        summary.tabsFailed += 1;
      } else if (result.method === 'scrollY' || result.method === 'anchor') {
        summary.tabsWithState += 1;
      }
      // 'noop' means the state carried nothing to apply — not a failure,
      // just doesn't count toward tabsWithState either.

      // Restore iframe state after the top frame. Iframes typically load
      // after the parent, and we can't guarantee they've settled by the
      // time waitForLoad resolves; apply-logic's own retry loop covers the
      // late-hydration case.
      if (saved.frames && saved.frames.length > 0 && deps.frames) {
        await applyIframeState(deps.frames, deps.messenger, tabId, saved.frames);
      }
    }),
  );
}

async function applyIframeState(
  frames: FramesEnumerator,
  messenger: TabMessenger,
  tabId: number,
  savedFrames: NonNullable<SavedTab['frames']>,
): Promise<void> {
  const live = await frames.getFrames(tabId).catch(() => []);
  if (live.length === 0) return;
  // Match by URL. Iframe frameIds aren't stable across reloads, but a
  // fresh iframe with the same URL is almost always the same conceptual
  // frame from the user's point of view.
  const byUrl = new Map<string, number>();
  for (const f of live) {
    if (f.frameId !== 0) byUrl.set(f.url, f.frameId);
  }
  await Promise.all(
    savedFrames.map(async (sf) => {
      const frameId = byUrl.get(sf.url);
      if (frameId === undefined) return;
      await messenger.applyState(
        tabId,
        { scrollY: sf.scrollY, anchorText: sf.anchorText },
        frameId,
      );
    }),
  );
}

// -----------------------------------------------------------------------
// Chrome adapters. Skipped in unit tests; exercised only in the extension.
// -----------------------------------------------------------------------

export function makeChromeTabCreator(): TabCreator {
  return {
    async createWindow(urls, focused) {
      const win = await chrome.windows.create({ url: urls, focused });
      const windowId = win.id;
      if (windowId === undefined) throw new Error('windows.create returned no id');
      const tabIds = (win.tabs ?? [])
        .filter((t): t is chrome.tabs.Tab & { id: number } => typeof t.id === 'number')
        .map((t) => t.id);
      return { windowId, tabIds };
    },
    async setPinned(tabId, pinned) {
      await chrome.tabs.update(tabId, { pinned });
    },
    async focusWindow(windowId) {
      await chrome.windows.update(windowId, { focused: true });
    },
  };
}

export function makeChromeTabLoadWaiter(): TabLoadWaiter {
  // A freshly-created tab from chrome.windows.create briefly reports
  // status='complete' on about:blank BEFORE navigating to the target URL.
  // If we trusted that first 'complete' we'd fire APPLY_STATE against a
  // blank page. Guard by requiring the URL to be a real page.
  const isReallyLoaded = (tab: chrome.tabs.Tab): boolean => {
    if (tab.status !== 'complete') return false;
    const url = tab.url ?? '';
    if (!url) return false;
    if (url.startsWith('about:')) return false;
    if (url.startsWith('chrome://newtab')) return false;
    return true;
  };
  return {
    waitForLoad(tabId, timeoutMs) {
      return new Promise<boolean>((resolve) => {
        let done = false;
        const finish = (ok: boolean) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(ok);
        };
        const listener = (
          changedId: number,
          _info: chrome.tabs.TabChangeInfo,
          tab: chrome.tabs.Tab,
        ) => {
          if (changedId !== tabId) return;
          if (isReallyLoaded(tab)) finish(true);
        };
        chrome.tabs.onUpdated.addListener(listener);
        // Race: page could have already finished loading (e.g. cached
        // navigation) before we attached the listener. Sample current
        // state once. The URL guard inside isReallyLoaded means an
        // about:blank snapshot won't trip the shortcut.
        chrome.tabs.get(tabId).then(
          (t) => {
            if (isReallyLoaded(t)) finish(true);
          },
          () => finish(false),
        );
        const timer = setTimeout(() => finish(false), timeoutMs);
      });
    },
  };
}
