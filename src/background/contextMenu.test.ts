import { describe, it, expect } from 'vitest';
import {
  buildMenuItems,
  childIdFor,
  EMPTY_MENU_ID,
  PARENT_MENU_ID,
  profileIdFromChildId,
  rebuildContextMenu,
  type ContextMenuAPI,
  type MenuItemSpec,
} from './contextMenu';
import type { ProfileIndexEntry } from '../shared/types';

function makeEntry(over: Partial<ProfileIndexEntry> = {}): ProfileIndexEntry {
  return {
    id: 'p1',
    name: 'Auth',
    tabCount: 3,
    updatedAt: 1,
    ...over,
  };
}

describe('childIdFor / profileIdFromChildId round-trip', () => {
  it('encodes and decodes the profile id', () => {
    expect(profileIdFromChildId(childIdFor('abc'))).toBe('abc');
  });

  it('returns null for non-bgsave menu ids', () => {
    expect(profileIdFromChildId('some-other-extension:foo')).toBeNull();
    expect(profileIdFromChildId(PARENT_MENU_ID)).toBeNull();
    expect(profileIdFromChildId(42)).toBeNull();
  });
});

describe('buildMenuItems', () => {
  it('emits parent + disabled hint when there are no profiles', () => {
    const items = buildMenuItems([]);
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe(PARENT_MENU_ID);
    expect(items[1]).toMatchObject({
      id: EMPTY_MENU_ID,
      parentId: PARENT_MENU_ID,
      enabled: false,
    });
  });

  it('emits one child per profile, sorted by most-recently-updated', () => {
    const items = buildMenuItems([
      makeEntry({ id: 'old', name: 'Old', updatedAt: 100 }),
      makeEntry({ id: 'new', name: 'New', updatedAt: 300 }),
      makeEntry({ id: 'mid', name: 'Mid', updatedAt: 200 }),
    ]);
    expect(items.slice(1).map((i) => i.title)).toEqual(['New', 'Mid', 'Old']);
    expect(items.slice(1).map((i) => i.id)).toEqual([
      childIdFor('new'),
      childIdFor('mid'),
      childIdFor('old'),
    ]);
  });

  it('truncates long workspace names to keep submenu items readable', () => {
    const longName = 'x'.repeat(80);
    const items = buildMenuItems([makeEntry({ name: longName })]);
    const title = items[1].title;
    expect(title.length).toBeLessThanOrEqual(40);
    expect(title.endsWith('…')).toBe(true);
  });
});

describe('rebuildContextMenu', () => {
  it('removes all existing items before creating the new tree', async () => {
    const events: string[] = [];
    const created: MenuItemSpec[] = [];
    const api: ContextMenuAPI = {
      removeAll: async () => {
        events.push('removeAll');
      },
      create: (spec) => {
        events.push(`create:${spec.id}`);
        created.push(spec);
      },
    };
    await rebuildContextMenu(api, [makeEntry({ id: 'a', name: 'A' })]);
    // removeAll must come first — otherwise duplicate-id creates would error.
    expect(events[0]).toBe('removeAll');
    expect(created.map((c) => c.id)).toEqual([PARENT_MENU_ID, childIdFor('a')]);
  });
});
