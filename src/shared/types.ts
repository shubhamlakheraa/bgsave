import type { SCHEMA_VERSION } from './constants';

export type SchemaVersion = typeof SCHEMA_VERSION;

// A stable locator for a highlighted piece of text within a page.
// Restore logic uses this to re-find the text even if the page has drifted.
export interface Highlight {
  text: string;
  anchor: string;
}

export interface FrameState {
  // Frame URL at capture time. Used to match the frame on restore since
  // frameId is not stable across page loads.
  url: string;
  scrollY?: number;
  anchorText?: string;
}

export interface SavedTab {
  url: string;
  title: string;
  pinned: boolean;
  // chrome.tabs.TAB_ID_NONE-style sentinel: -1 when the tab is not in a group.
  groupId: number;
  // Position of the tab within its window at capture time.
  index: number;
  // True for URLs where content scripts can't run (chrome://, file://, etc.).
  // When true, scrollY/anchorText/highlights will be absent.
  restricted: boolean;
  capturedAt: number;
  scrollY?: number;
  // Short snippet of text near the scroll position, used as a fallback anchor
  // when the page has changed since capture.
  anchorText?: string;
  highlights?: Highlight[];
  // Per-iframe state, one entry per non-top-frame that responded during
  // capture. Empty/absent when the page has no iframes we care about
  // (Claude artifacts, YouTube embeds, docs previews are the interesting
  // cases). Matched back to live frames by URL on restore.
  frames?: FrameState[];
}

export interface SavedWindow {
  // Was this the focused window at capture time? Used to decide which
  // window to focus after restore when a profile has multiple windows.
  focused: boolean;
  tabs: SavedTab[];
}

export interface Profile {
  id: string;
  name: string;
  schemaVersion: SchemaVersion;
  createdAt: number;
  updatedAt: number;
  windows: SavedWindow[];
}

// Lightweight summary stored in the profileIndex — enough to render the
// popup list without loading every profile's full tab payload.
export interface ProfileIndexEntry {
  id: string;
  name: string;
  tabCount: number;
  updatedAt: number;
  // Number of tabs whose captured cognitive state was non-trivial — used to
  // render the drift indicator in the popup ("12 tabs · 8 with state").
  // Optional so index entries written before this field existed still
  // validate; readers treat missing as 0.
  tabsWithState?: number;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; error: string };

// Message types (used across execution contexts). Real message shapes
// arrive in Task 3 when the background router lands.
export interface PingMessage {
  type: 'PING';
}

export interface PongResponse {
  type: 'PONG';
  from: 'background';
  at: number;
}

export type ExtensionMessage = PingMessage;
export type ExtensionResponse = PongResponse;
