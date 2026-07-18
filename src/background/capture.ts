import { LIMITS, SCHEMA_VERSION } from '../shared/constants';
import type { Highlight, Profile, SavedTab, SavedWindow } from '../shared/types';

// Chrome's sentinel for "not in a tab group". Hardcoded here so the pure
// capture module doesn't need to import chrome.* types.
const TAB_GROUP_ID_NONE = -1;

/**
 * URL schemes and origins where content scripts cannot be injected. Freezing
 * still captures metadata (url, title, position); downstream restore skips
 * scroll/highlight replay for these tabs.
 *
 * The Chrome Web Store domains are explicitly excluded from all extensions
 * regardless of `<all_urls>` permission.
 */
const RESTRICTED_SCHEMES = [
  'chrome://',
  'chrome-extension://',
  'chrome-untrusted://',
  'edge://',
  'brave://',
  'vivaldi://',
  'opera://',
  'about:',
  'view-source:',
  'devtools://',
  'file://',
];

const RESTRICTED_HOST_PATTERNS = [
  /^https?:\/\/chromewebstore\.google\.com/i,
  /^https?:\/\/chrome\.google\.com\/webstore/i,
];

export function isRestrictedUrl(url: string): boolean {
  if (!url) return true; // empty/undefined URL — treat as restricted (nothing to inject on)
  for (const scheme of RESTRICTED_SCHEMES) {
    if (url.startsWith(scheme)) return true;
  }
  for (const pattern of RESTRICTED_HOST_PATTERNS) {
    if (pattern.test(url)) return true;
  }
  return false;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

// The subset of chrome.tabs.Tab we actually read. Kept as a structural type
// so tests can pass in plain objects without a chrome type dependency.
export interface TabLike {
  url?: string;
  pendingUrl?: string;
  title?: string;
  pinned?: boolean;
  groupId?: number;
  index: number;
  windowId?: number;
  id?: number;
  // Cognitive state, pre-captured by the content script during freeze. When
  // null/undefined the SavedTab is metadata-only (restricted URL, timeout,
  // or content script failure).
  capturedState?: { scrollY: number; anchorText: string } | null;
  // Highlights the user has persisted on this URL (read from HighlightStore
  // at freeze time, not from the page's live DOM).
  highlights?: Highlight[];
  // Per-iframe state, one entry per non-top-frame with a real URL that
  // responded to CAPTURE_STATE during freeze.
  frames?: Array<{ url: string; scrollY: number; anchorText: string }>;
}

/**
 * Convert one Chrome tab into a SavedTab. Handles loading tabs (pendingUrl
 * fallback), untitled tabs (empty string), ungrouped tabs (groupId -1),
 * and restricted URLs. When `capturedState` is present, scrollY/anchorText
 * are copied through; otherwise they're omitted.
 */
export function captureTab(tab: TabLike, now: number = Date.now()): SavedTab {
  const url = tab.url ?? tab.pendingUrl ?? '';
  const title = truncate(tab.title ?? '', LIMITS.TITLE_MAX);
  const saved: SavedTab = {
    url,
    title,
    pinned: tab.pinned ?? false,
    groupId: tab.groupId ?? TAB_GROUP_ID_NONE,
    index: tab.index,
    restricted: isRestrictedUrl(url),
    capturedAt: now,
  };
  if (tab.capturedState) {
    saved.scrollY = tab.capturedState.scrollY;
    // Empty anchor is a signal from the content script that no anchor was
    // found — don't persist an empty string, which would just be noise.
    if (tab.capturedState.anchorText.length > 0) {
      saved.anchorText = tab.capturedState.anchorText;
    }
  }
  if (tab.highlights && tab.highlights.length > 0) {
    saved.highlights = tab.highlights;
  }
  if (tab.frames && tab.frames.length > 0) {
    saved.frames = tab.frames
      .filter((f) => f.url && (f.scrollY > 0 || f.anchorText.length > 0))
      .map((f) => {
        const frame: { url: string; scrollY?: number; anchorText?: string } = {
          url: f.url,
        };
        if (f.scrollY > 0) frame.scrollY = f.scrollY;
        if (f.anchorText.length > 0) frame.anchorText = f.anchorText;
        return frame;
      });
    if (saved.frames.length === 0) delete saved.frames;
  }
  return saved;
}

/**
 * Build a Profile from grouped Chrome tabs. Pure — takes everything it
 * needs as arguments so tests don't need to mock time or uuid.
 *
 * Tabs are sorted by their `index` within each window so restore replays
 * them in their original visual order.
 */
export function buildProfile(input: {
  id: string;
  name: string;
  windows: Array<{ focused: boolean; tabs: TabLike[] }>;
  now: number;
}): Profile {
  const windows: SavedWindow[] = input.windows.map((win) => ({
    focused: win.focused,
    tabs: [...win.tabs]
      .sort((a, b) => a.index - b.index)
      .map((t) => captureTab(t, input.now)),
  }));

  return {
    id: input.id,
    name: input.name,
    schemaVersion: SCHEMA_VERSION,
    createdAt: input.now,
    updatedAt: input.now,
    windows,
  };
}
