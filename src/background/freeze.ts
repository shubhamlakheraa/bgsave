import type { ProfileIndexEntry } from '../shared/types';
import type { ProfileStore } from '../shared/storage';
import { buildProfile, type TabLike } from './capture';

/**
 * Interface for fetching tab data from the browser. Injectable so tests
 * can supply an in-memory fixture without booting Chrome.
 *
 * `queryCurrentWindow` is used for the fast path (freeze everything in the
 * active window). `getTabs` is used when a caller has already picked a
 * specific subset of tab IDs via the picker (Task 6).
 */
export interface TabFetcher {
  queryCurrentWindow(): Promise<TabLike[]>;
  getTabs(ids: number[]): Promise<TabLike[]>;
  getLastFocusedWindowId(): Promise<number | null>;
}

// Production adapter — wraps chrome.tabs / chrome.windows APIs. Skipped in
// unit tests; exercised in the real extension.
export function makeChromeTabFetcher(): TabFetcher {
  return {
    async queryCurrentWindow() {
      const win = await chrome.windows.getCurrent();
      if (win.id === undefined) throw new Error('No current window.');
      return chrome.tabs.query({ windowId: win.id });
    },
    async getTabs(ids: number[]) {
      return Promise.all(ids.map((id) => chrome.tabs.get(id)));
    },
    async getLastFocusedWindowId() {
      const win = await chrome.windows.getLastFocused();
      return win.id ?? null;
    },
  };
}

export interface FreezeDeps {
  store: ProfileStore;
  tabs: TabFetcher;
  // Injectable for deterministic tests. Default to Date.now() / randomUUID()
  // in production wiring.
  now: () => number;
  newId: () => string;
}

export interface FreezeArgs {
  name: string;
  // When provided: freeze exactly these tabs (across whichever windows they
  // live in). When omitted: freeze the entire current window.
  tabIds?: number[];
}

/**
 * Freeze a workspace: fetch tabs, build a Profile, persist via ProfileStore,
 * return the index entry the popup can render immediately.
 *
 * Multi-window handling: when tabIds span multiple windows, we group tabs
 * by windowId. The focused window at capture time is marked so restore can
 * decide which window to focus.
 */
export async function freezeWorkspace(
  deps: FreezeDeps,
  args: FreezeArgs,
): Promise<ProfileIndexEntry> {
  const tabs =
    args.tabIds && args.tabIds.length > 0
      ? await deps.tabs.getTabs(args.tabIds)
      : await deps.tabs.queryCurrentWindow();

  if (tabs.length === 0) {
    throw new Error('No tabs selected to freeze.');
  }

  // Group by windowId. Tabs from queryCurrentWindow all share one windowId;
  // tabs from a cross-window picker may span several.
  const focusedId = await deps.tabs.getLastFocusedWindowId();
  const byWindow = new Map<number, TabLike[]>();
  for (const tab of tabs) {
    // If windowId is undefined (shouldn't happen for real tabs), fall back
    // to a synthetic single-window bucket keyed by -1.
    const wid = tab.windowId ?? -1;
    const bucket = byWindow.get(wid);
    if (bucket) bucket.push(tab);
    else byWindow.set(wid, [tab]);
  }

  const windows = Array.from(byWindow.entries()).map(([wid, winTabs]) => ({
    focused: focusedId !== null && wid === focusedId,
    tabs: winTabs,
  }));

  // If no window was flagged focused (e.g., all tabs from a background
  // window), mark the first one focused so restore has somewhere to go.
  if (!windows.some((w) => w.focused) && windows.length > 0) {
    windows[0].focused = true;
  }

  const profile = buildProfile({
    id: deps.newId(),
    name: args.name,
    now: deps.now(),
    windows,
  });

  await deps.store.saveProfile(profile);

  return {
    id: profile.id,
    name: profile.name,
    tabCount: profile.windows.reduce((sum, w) => sum + w.tabs.length, 0),
    updatedAt: profile.updatedAt,
  };
}
