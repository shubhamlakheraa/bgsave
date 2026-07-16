import { describe, it, expect, beforeEach } from 'vitest';
import {
  freezeWorkspace,
  type FreezeDeps,
  type TabFetcher,
  type TabMessenger,
} from './freeze';
import { ProfileStore } from '../shared/storage';
import { MemoryKVStore } from '../shared/kvStore';
import type { TabLike } from './capture';

const NOW = 1_700_000_000_000;

function makeFetcher(overrides: Partial<TabFetcher> = {}): TabFetcher {
  return {
    queryCurrentWindow: async () => [],
    getTabs: async () => [],
    getLastFocusedWindowId: async () => null,
    ...overrides,
  };
}

function makeMessenger(overrides: Partial<TabMessenger> = {}): TabMessenger {
  return {
    requestState: async () => null,
    ...overrides,
  };
}

function makeDeps(
  fetcher: TabFetcher,
  store: ProfileStore,
  id = 'p1',
  messenger: TabMessenger = makeMessenger(),
): FreezeDeps {
  return {
    store,
    tabs: fetcher,
    messenger,
    now: () => NOW,
    newId: () => id,
  };
}

let store: ProfileStore;
beforeEach(() => {
  store = new ProfileStore(new MemoryKVStore());
});

describe('freezeWorkspace — current window fast path', () => {
  it('freezes all tabs in the current window into one SavedWindow', async () => {
    const fetcher = makeFetcher({
      queryCurrentWindow: async () => [
        { url: 'https://a.com', title: 'A', index: 0, windowId: 100 },
        { url: 'https://b.com', title: 'B', index: 1, windowId: 100 },
      ],
      getLastFocusedWindowId: async () => 100,
    });
    const entry = await freezeWorkspace(makeDeps(fetcher, store), { name: 'Auth' });

    expect(entry).toEqual({ id: 'p1', name: 'Auth', tabCount: 2, updatedAt: NOW });

    const saved = await store.getProfile('p1');
    expect(saved).not.toBeNull();
    expect(saved!.windows).toHaveLength(1);
    expect(saved!.windows[0].focused).toBe(true);
    expect(saved!.windows[0].tabs.map((t) => t.url)).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('marks restricted tabs correctly in the captured window', async () => {
    const fetcher = makeFetcher({
      queryCurrentWindow: async () => [
        { url: 'https://x.com', title: 'X', index: 0, windowId: 1 },
        { url: 'chrome://settings', title: 'Settings', index: 1, windowId: 1 },
      ],
      getLastFocusedWindowId: async () => 1,
    });
    await freezeWorkspace(makeDeps(fetcher, store), { name: 'Mixed' });
    const saved = await store.getProfile('p1');
    expect(saved!.windows[0].tabs[0].restricted).toBe(false);
    expect(saved!.windows[0].tabs[1].restricted).toBe(true);
  });

  it('rejects freezing when there are no tabs', async () => {
    const fetcher = makeFetcher({ queryCurrentWindow: async () => [] });
    await expect(
      freezeWorkspace(makeDeps(fetcher, store), { name: 'Empty' }),
    ).rejects.toThrow(/no tabs/i);
  });
});

describe('freezeWorkspace — tabIds path (subset from picker)', () => {
  it('captures only the requested tabs, grouped by their windows', async () => {
    const tabs: Record<number, TabLike> = {
      1: { url: 'https://a.com', title: 'A', index: 0, windowId: 100 },
      2: { url: 'https://b.com', title: 'B', index: 1, windowId: 100 },
      3: { url: 'https://c.com', title: 'C', index: 0, windowId: 200 },
    };
    const fetcher = makeFetcher({
      getTabs: async (ids) => ids.map((id) => tabs[id]),
      getLastFocusedWindowId: async () => 200,
    });

    await freezeWorkspace(makeDeps(fetcher, store), {
      name: 'Split',
      tabIds: [1, 2, 3],
    });

    const saved = await store.getProfile('p1');
    expect(saved!.windows).toHaveLength(2);
    // Window 100 has 2 tabs, window 200 has 1 tab; order across windows is
    // preserved by insertion into the Map.
    const win100 = saved!.windows.find((w) => w.tabs.length === 2)!;
    const win200 = saved!.windows.find((w) => w.tabs.length === 1)!;
    expect(win100.focused).toBe(false);
    expect(win200.focused).toBe(true);
    expect(win200.tabs[0].url).toBe('https://c.com');
  });

  it('marks the first window focused if none matches the focused window id', async () => {
    const fetcher = makeFetcher({
      getTabs: async () => [
        { url: 'https://a.com', title: 'A', index: 0, windowId: 500 },
      ],
      getLastFocusedWindowId: async () => 999,
    });
    await freezeWorkspace(makeDeps(fetcher, store), { name: 'Bg', tabIds: [1] });
    const saved = await store.getProfile('p1');
    expect(saved!.windows[0].focused).toBe(true);
  });

  it('merges captured state into non-restricted tabs', async () => {
    const fetcher = makeFetcher({
      queryCurrentWindow: async () => [
        { id: 10, url: 'https://a.com', index: 0, windowId: 1 },
        { id: 11, url: 'https://b.com', index: 1, windowId: 1 },
      ],
      getLastFocusedWindowId: async () => 1,
    });
    const messenger = makeMessenger({
      requestState: async (tabId) =>
        tabId === 10
          ? { scrollY: 400, anchorText: 'top of A' }
          : { scrollY: 0, anchorText: '' },
    });
    await freezeWorkspace(makeDeps(fetcher, store, 'p1', messenger), { name: 'CogState' });
    const saved = await store.getProfile('p1');
    const [a, b] = saved!.windows[0].tabs;
    expect(a.scrollY).toBe(400);
    expect(a.anchorText).toBe('top of A');
    // Empty anchor from content script is dropped rather than persisted as "".
    expect(b.scrollY).toBe(0);
    expect(b.anchorText).toBeUndefined();
  });

  it('skips capture for restricted tabs (does not call messenger)', async () => {
    const seen: number[] = [];
    const fetcher = makeFetcher({
      queryCurrentWindow: async () => [
        { id: 10, url: 'chrome://settings', index: 0, windowId: 1 },
        { id: 11, url: 'https://ok.com', index: 1, windowId: 1 },
      ],
      getLastFocusedWindowId: async () => 1,
    });
    const messenger = makeMessenger({
      requestState: async (tabId) => {
        seen.push(tabId);
        return { scrollY: 1, anchorText: 'x' };
      },
    });
    await freezeWorkspace(makeDeps(fetcher, store, 'p1', messenger), { name: 'R' });
    expect(seen).toEqual([11]);
    const saved = await store.getProfile('p1');
    expect(saved!.windows[0].tabs[0].scrollY).toBeUndefined();
    expect(saved!.windows[0].tabs[1].scrollY).toBe(1);
  });

  it('falls back to metadata-only when messenger returns null (timeout / no listener)', async () => {
    const fetcher = makeFetcher({
      queryCurrentWindow: async () => [
        { id: 10, url: 'https://slow.com', index: 0, windowId: 1 },
      ],
      getLastFocusedWindowId: async () => 1,
    });
    const messenger = makeMessenger({ requestState: async () => null });
    await freezeWorkspace(makeDeps(fetcher, store, 'p1', messenger), { name: 'Slow' });
    const saved = await store.getProfile('p1');
    expect(saved!.windows[0].tabs[0].scrollY).toBeUndefined();
    expect(saved!.windows[0].tabs[0].anchorText).toBeUndefined();
    // Metadata still lands.
    expect(saved!.windows[0].tabs[0].url).toBe('https://slow.com');
  });

  it('propagates duplicate-name errors from ProfileStore', async () => {
    // Save an existing profile first.
    const fetcher = makeFetcher({
      queryCurrentWindow: async () => [
        { url: 'https://a.com', index: 0, windowId: 1 },
      ],
      getLastFocusedWindowId: async () => 1,
    });
    await freezeWorkspace(makeDeps(fetcher, store, 'first'), { name: 'Same' });
    await expect(
      freezeWorkspace(makeDeps(fetcher, store, 'second'), { name: 'Same' }),
    ).rejects.toThrow(/already exists/i);
  });
});
