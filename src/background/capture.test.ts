import { describe, it, expect } from 'vitest';
import { buildProfile, captureTab, isRestrictedUrl, type TabLike } from './capture';
import { LIMITS, SCHEMA_VERSION } from '../shared/constants';

describe('isRestrictedUrl', () => {
  const restricted = [
    'chrome://settings/',
    'chrome-extension://abc/popup.html',
    'chrome-untrusted://foo',
    'edge://flags',
    'brave://rewards',
    'about:blank',
    'view-source:https://example.com',
    'devtools://devtools/bundled/inspector.html',
    'file:///Users/x/foo.html',
    'https://chromewebstore.google.com/detail/abc',
    'https://chrome.google.com/webstore/detail/abc',
    '',
  ];
  const allowed = [
    'https://example.com',
    'http://localhost:3000',
    'https://stackoverflow.com/questions/1234',
    'https://developer.mozilla.org/',
  ];

  it.each(restricted)('flags %s as restricted', (url) => {
    expect(isRestrictedUrl(url)).toBe(true);
  });

  it.each(allowed)('does not flag %s as restricted', (url) => {
    expect(isRestrictedUrl(url)).toBe(false);
  });
});

describe('captureTab', () => {
  const NOW = 1_700_000_000_000;

  it('captures a fully populated normal tab', () => {
    const tab: TabLike = {
      url: 'https://example.com',
      title: 'Example',
      pinned: false,
      groupId: -1,
      index: 3,
    };
    expect(captureTab(tab, NOW)).toEqual({
      url: 'https://example.com',
      title: 'Example',
      pinned: false,
      groupId: -1,
      index: 3,
      restricted: false,
      capturedAt: NOW,
    });
  });

  it('falls back to pendingUrl when url is undefined (loading tab)', () => {
    const tab: TabLike = { pendingUrl: 'https://loading.example', index: 0 };
    expect(captureTab(tab, NOW).url).toBe('https://loading.example');
  });

  it('defaults undefined title to empty string', () => {
    const tab: TabLike = { url: 'https://x', index: 0 };
    expect(captureTab(tab, NOW).title).toBe('');
  });

  it('truncates long titles to TITLE_MAX', () => {
    const long = 'A'.repeat(LIMITS.TITLE_MAX + 50);
    const tab: TabLike = { url: 'https://x', title: long, index: 0 };
    expect(captureTab(tab, NOW).title).toHaveLength(LIMITS.TITLE_MAX);
  });

  it('defaults undefined groupId to -1', () => {
    const tab: TabLike = { url: 'https://x', index: 0 };
    expect(captureTab(tab, NOW).groupId).toBe(-1);
  });

  it('defaults undefined pinned to false', () => {
    const tab: TabLike = { url: 'https://x', index: 0 };
    expect(captureTab(tab, NOW).pinned).toBe(false);
  });

  it('preserves pinned + groupId when set', () => {
    const tab: TabLike = { url: 'https://x', index: 0, pinned: true, groupId: 42 };
    const captured = captureTab(tab, NOW);
    expect(captured.pinned).toBe(true);
    expect(captured.groupId).toBe(42);
  });

  it('marks chrome:// tabs as restricted', () => {
    const tab: TabLike = { url: 'chrome://extensions', title: 'Extensions', index: 0 };
    expect(captureTab(tab, NOW).restricted).toBe(true);
  });

  it('marks tabs with no url as restricted', () => {
    const tab: TabLike = { index: 0 };
    const c = captureTab(tab, NOW);
    expect(c.url).toBe('');
    expect(c.restricted).toBe(true);
  });
});

describe('buildProfile', () => {
  const NOW = 1_700_000_000_000;

  it('assembles a valid Profile', () => {
    const profile = buildProfile({
      id: 'p1',
      name: 'Test',
      now: NOW,
      windows: [
        {
          focused: true,
          tabs: [
            { url: 'https://a.com', title: 'A', index: 0 },
            { url: 'https://b.com', title: 'B', index: 1 },
          ],
        },
      ],
    });
    expect(profile.id).toBe('p1');
    expect(profile.name).toBe('Test');
    expect(profile.schemaVersion).toBe(SCHEMA_VERSION);
    expect(profile.createdAt).toBe(NOW);
    expect(profile.updatedAt).toBe(NOW);
    expect(profile.windows).toHaveLength(1);
    expect(profile.windows[0].tabs).toHaveLength(2);
  });

  it('sorts tabs by index within each window', () => {
    const profile = buildProfile({
      id: 'p1',
      name: 'Test',
      now: NOW,
      windows: [
        {
          focused: true,
          tabs: [
            { url: 'https://c.com', title: 'C', index: 2 },
            { url: 'https://a.com', title: 'A', index: 0 },
            { url: 'https://b.com', title: 'B', index: 1 },
          ],
        },
      ],
    });
    const urls = profile.windows[0].tabs.map((t) => t.url);
    expect(urls).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
  });

  it('preserves focused flag across multi-window captures', () => {
    const profile = buildProfile({
      id: 'p1',
      name: 'Multi',
      now: NOW,
      windows: [
        { focused: false, tabs: [{ url: 'https://a.com', index: 0 }] },
        { focused: true, tabs: [{ url: 'https://b.com', index: 0 }] },
      ],
    });
    expect(profile.windows.map((w) => w.focused)).toEqual([false, true]);
  });

  it('handles a mix of restricted and normal tabs in one window', () => {
    const profile = buildProfile({
      id: 'p1',
      name: 'Mixed',
      now: NOW,
      windows: [
        {
          focused: true,
          tabs: [
            { url: 'https://a.com', title: 'A', index: 0 },
            { url: 'chrome://settings', title: 'Settings', index: 1 },
          ],
        },
      ],
    });
    expect(profile.windows[0].tabs[0].restricted).toBe(false);
    expect(profile.windows[0].tabs[1].restricted).toBe(true);
  });
});
