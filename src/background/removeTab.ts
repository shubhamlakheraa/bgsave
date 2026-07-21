import type { ProfileStore } from '../shared/storage';
import type { Profile } from '../shared/types';

export interface RemoveTabDeps {
  store: ProfileStore;
  now: () => number;
}

export interface RemoveTabArgs {
  profileId: string;
  windowIndex: number;
  tabIndex: number;
}

export type RemoveTabOutcome =
  | { kind: 'removed'; tabCount: number; tabsWithState: number }
  | { kind: 'not_found' }
  | { kind: 'last_tab' };

/**
 * Splice one tab out of a saved workspace, then persist.
 *
 * Rules:
 * - Refuse to remove the last tab of the last window. A workspace with
 *   zero tabs has no meaning — the caller should delete the workspace
 *   instead. Returning a distinct 'last_tab' outcome lets the UI toast
 *   "delete the workspace instead".
 * - If a window becomes empty after removal AND at least one other window
 *   remains, drop the empty window entirely rather than persisting a
 *   phantom "focused window with no tabs" that restore would silently
 *   ignore.
 * - Reindex remaining tabs in the affected window so their `index`
 *   matches their new position. Restore sorts by index at replay time,
 *   and stale gaps would make new appends collide with existing indexes.
 * - Bump updatedAt via saveProfile so the popup preview cache invalidates
 *   and the context menu rebuilds pick up the new tab count.
 */
export async function removeTabFromWorkspace(
  deps: RemoveTabDeps,
  args: RemoveTabArgs,
): Promise<RemoveTabOutcome> {
  const profile = await deps.store.getProfile(args.profileId);
  if (!profile) return { kind: 'not_found' };

  const totalTabs = profile.windows.reduce((s, w) => s + w.tabs.length, 0);
  if (totalTabs <= 1) return { kind: 'last_tab' };

  const win = profile.windows[args.windowIndex];
  if (!win) return { kind: 'not_found' };
  if (args.tabIndex < 0 || args.tabIndex >= win.tabs.length) {
    return { kind: 'not_found' };
  }

  const nextTabs = win.tabs.filter((_, i) => i !== args.tabIndex)
    // Reindex so restore's index-based sort stays consistent and future
    // appendTabToWorkspace calls don't reuse an index we just freed.
    .map((tab, newIndex) => ({ ...tab, index: newIndex }));

  const nextWindows =
    nextTabs.length === 0 && profile.windows.length > 1
      ? profile.windows.filter((_, i) => i !== args.windowIndex)
      : profile.windows.map((w, i) =>
          i === args.windowIndex ? { ...w, tabs: nextTabs } : w,
        );

  // If we removed the focused window, promote the first remaining one
  // so restore still has somewhere to focus.
  if (!nextWindows.some((w) => w.focused) && nextWindows.length > 0) {
    nextWindows[0] = { ...nextWindows[0], focused: true };
  }

  const updated: Profile = {
    ...profile,
    windows: nextWindows,
    updatedAt: deps.now(),
  };
  await deps.store.saveProfile(updated);

  const index = await deps.store.listProfiles();
  const entry = index.find((e) => e.id === updated.id);
  return {
    kind: 'removed',
    tabCount: entry?.tabCount ?? nextWindows.reduce((s, w) => s + w.tabs.length, 0),
    tabsWithState: entry?.tabsWithState ?? 0,
  };
}
