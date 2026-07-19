import type { ProfileIndexEntry } from '../shared/types';

// Stable ID for the top-level "Add to workspace" parent so we can find
// and remove it on rebuild. Also used to detect our own clicks in the
// dispatcher — anything not prefixed with `bgsave:` isn't ours.
export const PARENT_MENU_ID = 'bgsave:add-to-workspace';

// Sentinel item shown when the user has no saved workspaces yet. It's
// disabled and just tells them to freeze one first — better than an empty
// submenu that looks broken.
export const EMPTY_MENU_ID = 'bgsave:no-workspaces';

// Prefix for per-workspace child items. Encoded as `bgsave:add-to:<id>`
// so the click handler can parse the profile id straight back out
// without a lookup table.
const CHILD_ID_PREFIX = 'bgsave:add-to:';

export function childIdFor(profileId: string): string {
  return `${CHILD_ID_PREFIX}${profileId}`;
}

/**
 * Reverse of childIdFor. Returns null when the menu id isn't one of ours,
 * so the click dispatcher can early-out on menus from other extensions.
 */
export function profileIdFromChildId(menuItemId: string | number): string | null {
  if (typeof menuItemId !== 'string') return null;
  if (!menuItemId.startsWith(CHILD_ID_PREFIX)) return null;
  return menuItemId.slice(CHILD_ID_PREFIX.length);
}

// Truncate long workspace names so submenu items stay readable — Chrome
// enforces its own limit internally, but 40 chars renders cleanly on all
// platforms and matches the popup's ellipsis behavior.
const MENU_TITLE_MAX = 40;

function truncateTitle(name: string): string {
  return name.length <= MENU_TITLE_MAX
    ? name
    : name.slice(0, MENU_TITLE_MAX - 1) + '…';
}

/**
 * Pure description of the context-menu item tree for a given profile list.
 * Split out from the chrome.contextMenus calls so the ordering / titles
 * are testable without booting an extension.
 */
export interface MenuItemSpec {
  id: string;
  title: string;
  parentId?: string;
  enabled?: boolean;
  contexts?: chrome.contextMenus.ContextType[];
}

export function buildMenuItems(profiles: ProfileIndexEntry[]): MenuItemSpec[] {
  const items: MenuItemSpec[] = [
    {
      id: PARENT_MENU_ID,
      title: 'Add to workspace',
      contexts: ['page', 'frame', 'selection', 'link'],
    },
  ];

  if (profiles.length === 0) {
    items.push({
      id: EMPTY_MENU_ID,
      title: 'No workspaces yet — freeze one first',
      parentId: PARENT_MENU_ID,
      enabled: false,
    });
    return items;
  }

  // Sort by most-recently-updated so the workspace the user is actively
  // curating stays at the top of the submenu.
  const sorted = [...profiles].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const p of sorted) {
    items.push({
      id: childIdFor(p.id),
      title: truncateTitle(p.name),
      parentId: PARENT_MENU_ID,
    });
  }
  return items;
}

/**
 * Injectable Chrome contextMenus surface — lets tests skip the extension
 * runtime entirely. Production wiring in background/index.ts uses
 * chrome.contextMenus directly.
 */
export interface ContextMenuAPI {
  removeAll(): Promise<void>;
  create(spec: MenuItemSpec): void;
}

/**
 * Rebuild the entire menu tree. Called on install/startup and whenever
 * the profile index changes (via storage.onChanged). Cheap enough that
 * a full rebuild beats diffing individual items — profile counts here
 * are counted in dozens, not thousands.
 */
export async function rebuildContextMenu(
  api: ContextMenuAPI,
  profiles: ProfileIndexEntry[],
): Promise<void> {
  await api.removeAll();
  for (const spec of buildMenuItems(profiles)) {
    api.create(spec);
  }
}
