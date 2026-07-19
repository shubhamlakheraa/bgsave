import type { HighlightStore } from '../shared/highlightStore';
import type { ProfileStore } from '../shared/storage';
import type { Profile, SavedTab } from '../shared/types';
import { captureTab, isRestrictedUrl, type TabLike } from './capture';
import type { FramesEnumerator, TabMessenger } from './freeze';

/**
 * Dependencies for appending one tab to an existing workspace. Same
 * capture surface as freeze, minus the tab fetcher (the caller passes in
 * the concrete tab it wants added).
 */
export interface AppendDeps {
  store: ProfileStore;
  messenger: TabMessenger;
  highlights: HighlightStore;
  frames: FramesEnumerator;
  now: () => number;
}

export interface AppendArgs {
  profileId: string;
  tab: TabLike;
}

export type AppendOutcome =
  | { kind: 'appended'; tabsWithState: number; tabCount: number }
  | { kind: 'duplicate' }
  | { kind: 'not_found' };

/**
 * Append one live tab to an existing saved workspace.
 *
 * Design decisions:
 * - Duplicate URLs (fragment-agnostic) are rejected — restoring a workspace
 *   with the same URL twice is confusing UX, and the caller can toast
 *   "already in workspace" instead.
 * - The new tab is appended to the *focused* SavedWindow (or the first one
 *   if none is flagged) rather than trying to preserve the current window
 *   layout. Chrome windowIds don't persist across sessions, so there is no
 *   correct mapping from "the current window" to "a saved window" anyway.
 * - Restricted tabs (chrome://) still append with metadata only, matching
 *   freeze's behavior.
 * - Highlights and iframe state are captured live at append time, same
 *   pipeline as freeze — no code duplication of the capture logic.
 */
export async function appendTabToWorkspace(
  deps: AppendDeps,
  args: AppendArgs,
): Promise<AppendOutcome> {
  const profile = await deps.store.getProfile(args.profileId);
  if (!profile) return { kind: 'not_found' };

  const url = args.tab.url ?? args.tab.pendingUrl ?? '';
  if (isDuplicateUrl(profile, url)) return { kind: 'duplicate' };

  // Live-capture state, highlights, and iframe state. Same primitives as
  // freeze — restricted tabs skip content-script paths entirely.
  const enriched: TabLike = { ...args.tab };
  if (args.tab.id !== undefined && !isRestrictedUrl(url)) {
    const [state, highlights, frames] = await Promise.all([
      deps.messenger.requestState(args.tab.id),
      deps.highlights.getHighlights(url).catch(() => []),
      deps.frames.getFrames(args.tab.id).catch(() => []),
    ]);
    if (state) enriched.capturedState = state;
    if (highlights.length > 0) enriched.highlights = highlights;
    // Non-top frames only; top frame is already covered by requestState.
    const iframeStates = await Promise.all(
      frames
        .filter((f) => f.frameId !== 0 && isCapturableIframeUrl(f.url))
        .map(async (f) => {
          const s = await deps.messenger.requestState(args.tab.id!, f.frameId);
          if (!s) return null;
          return { url: f.url, scrollY: s.scrollY, anchorText: s.anchorText };
        }),
    );
    const nonNull = iframeStates.filter(
      (x): x is { url: string; scrollY: number; anchorText: string } => x !== null,
    );
    if (nonNull.length > 0) enriched.frames = nonNull;
  }

  // Pick the target window: focused, or the first one.
  const targetIdx = Math.max(
    profile.windows.findIndex((w) => w.focused),
    0,
  );
  const targetWindow = profile.windows[targetIdx];
  if (!targetWindow) {
    // Defensive: profile has no windows. Add one to hold this tab.
    profile.windows.push({ focused: true, tabs: [] });
  }
  const finalWindow = profile.windows[targetIdx] ?? profile.windows[0];

  // Position the new tab at the end. `index` here is the position within
  // the window, matching capture.ts's ordering.
  const nextIndex = finalWindow.tabs.length;
  const savedTab: SavedTab = captureTab(
    { ...enriched, index: nextIndex },
    deps.now(),
  );
  finalWindow.tabs.push(savedTab);

  const updated: Profile = { ...profile, updatedAt: deps.now() };
  await deps.store.saveProfile(updated);

  // Re-read the index entry the store just wrote so we can hand the
  // freshly-computed drift counts back to the caller without duplicating
  // the tabHasState logic here.
  const index = await deps.store.listProfiles();
  const entry = index.find((e) => e.id === updated.id);
  return {
    kind: 'appended',
    tabCount: entry?.tabCount ?? updated.windows.reduce((s, w) => s + w.tabs.length, 0),
    tabsWithState: entry?.tabsWithState ?? 0,
  };
}

/**
 * True if this URL (ignoring fragment) already lives somewhere in the
 * profile. We ignore fragments because `#section-1` vs `#section-2` on the
 * same doc is still "the same tab" to a user, and restoring both would
 * open two copies of the doc.
 */
function isDuplicateUrl(profile: Profile, url: string): boolean {
  const target = stripFragment(url);
  for (const win of profile.windows) {
    for (const t of win.tabs) {
      if (stripFragment(t.url) === target) return true;
    }
  }
  return false;
}

function stripFragment(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

function isCapturableIframeUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('chrome://')) return false;
  if (url.startsWith('chrome-extension://')) return false;
  if (url.startsWith('devtools://')) return false;
  return true;
}
