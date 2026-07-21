import { describe, it, expect, beforeEach } from 'vitest';
import { removeTabFromWorkspace } from './removeTab';
import { ProfileStore } from '../shared/storage';
import { MemoryKVStore } from '../shared/kvStore';
import { SCHEMA_VERSION } from '../shared/constants';
import type { Profile, SavedTab } from '../shared/types';

const NOW = 1_700_000_000_000;

function makeTab(over: Partial<SavedTab> = {}): SavedTab {
  return {
    url: 'https://a.com',
    title: 'A',
    pinned: false,
    groupId: -1,
    index: 0,
    restricted: false,
    capturedAt: 1,
    ...over,
  };
}

function makeProfile(over: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    name: 'Auth',
    schemaVersion: SCHEMA_VERSION,
    createdAt: 1,
    updatedAt: 1,
    windows: [
      {
        focused: true,
        tabs: [
          makeTab({ url: 'https://a.com', title: 'A', index: 0, scrollY: 500 }),
          makeTab({ url: 'https://b.com', title: 'B', index: 1 }),
          makeTab({ url: 'https://c.com', title: 'C', index: 2 }),
        ],
      },
    ],
    ...over,
  };
}

let store: ProfileStore;
beforeEach(async () => {
  store = new ProfileStore(new MemoryKVStore());
  await store.saveProfile(makeProfile());
});

describe('removeTabFromWorkspace', () => {
  it('splices out the tab and reindexes the survivors', async () => {
    const outcome = await removeTabFromWorkspace(
      { store, now: () => NOW },
      { profileId: 'p1', windowIndex: 0, tabIndex: 1 },
    );
    expect(outcome).toEqual({
      kind: 'removed',
      tabCount: 2,
      tabsWithState: 1, // only the scrollY=500 tab still has state
    });
    const saved = await store.getProfile('p1');
    const tabs = saved!.windows[0].tabs;
    expect(tabs.map((t) => t.url)).toEqual(['https://a.com', 'https://c.com']);
    // Indexes are re-numbered so later appends don't clash.
    expect(tabs.map((t) => t.index)).toEqual([0, 1]);
  });

  it('refuses to remove the last tab of the only window', async () => {
    const kv = new MemoryKVStore();
    const s = new ProfileStore(kv);
    await s.saveProfile(
      makeProfile({
        id: 'solo',
        name: 'Solo',
        windows: [{ focused: true, tabs: [makeTab({ url: 'https://only.com' })] }],
      }),
    );
    const outcome = await removeTabFromWorkspace(
      { store: s, now: () => NOW },
      { profileId: 'solo', windowIndex: 0, tabIndex: 0 },
    );
    expect(outcome).toEqual({ kind: 'last_tab' });
    // Untouched.
    const saved = await s.getProfile('solo');
    expect(saved!.windows[0].tabs).toHaveLength(1);
  });

  it('drops an emptied window when other windows still remain', async () => {
    const kv = new MemoryKVStore();
    const s = new ProfileStore(kv);
    await s.saveProfile(
      makeProfile({
        id: 'multi',
        name: 'Multi',
        windows: [
          { focused: true, tabs: [makeTab({ url: 'https://a.com' })] },
          { focused: false, tabs: [makeTab({ url: 'https://b.com' })] },
        ],
      }),
    );
    const outcome = await removeTabFromWorkspace(
      { store: s, now: () => NOW },
      { profileId: 'multi', windowIndex: 0, tabIndex: 0 },
    );
    expect(outcome.kind).toBe('removed');
    const saved = await s.getProfile('multi');
    expect(saved!.windows).toHaveLength(1);
    // The surviving window is promoted to focused since the focused one
    // went away.
    expect(saved!.windows[0].focused).toBe(true);
    expect(saved!.windows[0].tabs[0].url).toBe('https://b.com');
  });

  it('returns not_found when the profile is missing', async () => {
    const outcome = await removeTabFromWorkspace(
      { store, now: () => NOW },
      { profileId: 'nope', windowIndex: 0, tabIndex: 0 },
    );
    expect(outcome).toEqual({ kind: 'not_found' });
  });

  it('returns not_found when the window index is out of range', async () => {
    const outcome = await removeTabFromWorkspace(
      { store, now: () => NOW },
      { profileId: 'p1', windowIndex: 5, tabIndex: 0 },
    );
    expect(outcome).toEqual({ kind: 'not_found' });
  });

  it('returns not_found when the tab index is out of range', async () => {
    const outcome = await removeTabFromWorkspace(
      { store, now: () => NOW },
      { profileId: 'p1', windowIndex: 0, tabIndex: 99 },
    );
    expect(outcome).toEqual({ kind: 'not_found' });
  });

  it('bumps updatedAt so the popup preview cache invalidates', async () => {
    const before = await store.getProfile('p1');
    await new Promise((r) => setTimeout(r, 3));
    await removeTabFromWorkspace(
      { store, now: () => Date.now() },
      { profileId: 'p1', windowIndex: 0, tabIndex: 1 },
    );
    const after = await store.getProfile('p1');
    expect(after!.updatedAt).toBeGreaterThan(before!.updatedAt);
  });
});
