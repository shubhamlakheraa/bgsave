import { LIMITS } from '../shared/constants';
import type {
  ApplyResult,
  CapturedState,
  RestoreState,
} from '../shared/contentMessaging';
import type { HighlightStore } from '../shared/highlightStore';
import type { ProfileIndexEntry } from '../shared/types';
import type { ProfileStore } from '../shared/storage';
import { withTimeout } from '../shared/withTimeout';
import { buildProfile, isRestrictedUrl, type TabLike } from './capture';

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

/**
 * Ask a tab's content script for its cognitive state (scroll + anchor),
 * or push saved state back to a tab during restore. Both methods return
 * null when the tab can't or doesn't respond in time — the freeze or
 * restore still proceeds, just without that tab's state.
 *
 * `frameId` targets a specific frame; when omitted the top frame is used.
 * With `all_frames: true` in the manifest, each frame has its own message
 * listener, so per-frame capture/apply requires per-frame calls.
 */
export interface TabMessenger {
  requestState(tabId: number, frameId?: number): Promise<CapturedState | null>;
  applyState(
    tabId: number,
    state: RestoreState,
    frameId?: number,
  ): Promise<ApplyResult | null>;
}

/**
 * Enumerate all frames of a tab. Uses chrome.webNavigation.getAllFrames
 * in production; injectable so tests don't need Chrome's frame graph.
 */
export interface FramesEnumerator {
  getFrames(tabId: number): Promise<Array<{ frameId: number; url: string }>>;
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

export function makeChromeTabMessenger(): TabMessenger {
  return {
    async requestState(tabId: number, frameId?: number) {
      // chrome.tabs.sendMessage rejects if the tab has no listener (e.g.
      // content script not injected yet, or the tab navigated). We treat
      // any failure the same as a timeout: return null, freeze anyway.
      const send = (
        frameId !== undefined
          ? chrome.tabs.sendMessage(tabId, { type: 'CAPTURE_STATE' }, { frameId })
          : chrome.tabs.sendMessage(tabId, { type: 'CAPTURE_STATE' })
      ) as Promise<CapturedState | undefined>;
      const result = await withTimeout(send, LIMITS.CAPTURE_TIMEOUT_MS);
      return result ?? null;
    },
    async applyState(tabId, state, frameId) {
      const send = (
        frameId !== undefined
          ? chrome.tabs.sendMessage(tabId, { type: 'APPLY_STATE', state }, { frameId })
          : chrome.tabs.sendMessage(tabId, { type: 'APPLY_STATE', state })
      ) as Promise<ApplyResult | undefined>;
      const result = await withTimeout(send, LIMITS.CAPTURE_TIMEOUT_MS);
      return result ?? null;
    },
  };
}

export function makeChromeFramesEnumerator(): FramesEnumerator {
  return {
    async getFrames(tabId: number) {
      try {
        const frames = await chrome.webNavigation.getAllFrames({ tabId });
        return (frames ?? []).map((f) => ({ frameId: f.frameId, url: f.url }));
      } catch {
        // Frame enumeration fails for restricted tabs and mid-navigation
        // states. Callers treat an empty list as "top frame only" and
        // proceed via the plain top-frame path.
        return [];
      }
    },
  };
}

export interface FreezeDeps {
  store: ProfileStore;
  tabs: TabFetcher;
  messenger: TabMessenger;
  // Read persisted per-URL highlights when bundling them into the profile.
  // Independent of the content-script capture path — highlights are
  // authoritative in storage, not in the live DOM.
  highlights: HighlightStore;
  // Enumerate iframes of each tab so we can capture their scroll state
  // separately (Claude artifacts, YouTube embeds, docs previews).
  frames: FramesEnumerator;
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
 * Freeze a workspace: fetch tabs, capture cognitive state per-tab in
 * parallel, build a Profile, persist via ProfileStore, return the index
 * entry the popup can render immediately.
 *
 * Multi-window handling: when tabIds span multiple windows, we group tabs
 * by windowId. The focused window at capture time is marked so restore can
 * decide which window to focus.
 */
export async function freezeWorkspace(
  deps: FreezeDeps,
  args: FreezeArgs,
): Promise<ProfileIndexEntry> {
  const rawTabs =
    args.tabIds && args.tabIds.length > 0
      ? await deps.tabs.getTabs(args.tabIds)
      : await deps.tabs.queryCurrentWindow();

  if (rawTabs.length === 0) {
    throw new Error('No tabs selected to freeze.');
  }

  // Capture state and load highlights for non-restricted tabs in parallel.
  // Each state capture races against LIMITS.CAPTURE_TIMEOUT_MS inside the
  // messenger, so total wall time is bounded by the slowest tab, not the sum.
  // Highlight fetches are direct storage reads and don't need a timeout —
  // they're bounded by chrome.storage's own latency.
  const enriched: TabLike[] = await Promise.all(
    rawTabs.map(async (tab) => {
      const url = tab.url ?? tab.pendingUrl ?? '';
      if (tab.id === undefined || isRestrictedUrl(url)) return tab;

      const [state, highlights, frames] = await Promise.all([
        deps.messenger.requestState(tab.id),
        deps.highlights.getHighlights(url).catch(() => []),
        deps.frames.getFrames(tab.id).catch(() => []),
      ]);

      // Non-top frames with a real URL: capture each in parallel. The top
      // frame is frameId 0 — already handled by the requestState() above.
      const iframeStates = await captureIframeStates(deps.messenger, tab.id, frames);

      const next: TabLike = { ...tab };
      if (state) next.capturedState = state;
      if (highlights.length > 0) next.highlights = highlights;
      if (iframeStates.length > 0) next.frames = iframeStates;
      return next;
    }),
  );

  // Group by windowId. Tabs from queryCurrentWindow all share one windowId;
  // tabs from a cross-window picker may span several.
  const focusedId = await deps.tabs.getLastFocusedWindowId();
  const byWindow = new Map<number, TabLike[]>();
  for (const tab of enriched) {
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

/**
 * Iframes may legitimately live at URLs that isRestrictedUrl blocks for
 * top-level tabs — most importantly `about:srcdoc`, which is what Claude
 * artifacts render into. `match_about_blank`/`match_origin_as_fallback` in
 * the manifest let content scripts inject there, so we don't want to skip
 * capturing them. We still filter chrome-scheme frames (extension DevTools
 * iframes, etc.) since our content script can't run there.
 */
function isCapturableIframeUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('chrome://')) return false;
  if (url.startsWith('chrome-extension://')) return false;
  if (url.startsWith('devtools://')) return false;
  return true;
}

/**
 * Capture state from every iframe of a tab that has a URL our content
 * script can reach. Returns entries for frames that actually had
 * scroll/anchor to record — iframes with nothing to preserve are dropped
 * rather than persisted as empty rows.
 */
async function captureIframeStates(
  messenger: TabMessenger,
  tabId: number,
  frames: Array<{ frameId: number; url: string }>,
): Promise<Array<{ url: string; scrollY: number; anchorText: string }>> {
  const targets = frames.filter(
    (f) => f.frameId !== 0 && isCapturableIframeUrl(f.url),
  );
  if (targets.length === 0) return [];

  const captured = await Promise.all(
    targets.map(async (f) => {
      const state = await messenger.requestState(tabId, f.frameId);
      if (!state) return null;
      return { url: f.url, scrollY: state.scrollY, anchorText: state.anchorText };
    }),
  );
  return captured.filter(
    (x): x is { url: string; scrollY: number; anchorText: string } => x !== null,
  );
}
