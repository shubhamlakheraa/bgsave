import { describe, it, expect } from 'vitest';
import {
  countTabsWithState,
  isProfile,
  isProfileIndex,
  isProfileIndexEntry,
  normalizeName,
  tabHasState,
  validateProfileName,
} from './validators';
import { SCHEMA_VERSION } from './constants';
import type { Profile, ProfileIndexEntry, SavedTab } from './types';

const makeIndexEntry = (over: Partial<ProfileIndexEntry> = {}): ProfileIndexEntry => ({
  id: 'p1',
  name: 'Auth-JWT',
  tabCount: 3,
  updatedAt: 1_700_000_000_000,
  ...over,
});

const makeValidProfile = (over: Partial<Profile> = {}): Profile => ({
  id: 'p1',
  name: 'Auth-JWT',
  schemaVersion: SCHEMA_VERSION,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  windows: [
    {
      focused: true,
      tabs: [
        {
          url: 'https://example.com',
          title: 'Example',
          pinned: false,
          groupId: -1,
          index: 0,
          restricted: false,
          capturedAt: 1_700_000_000_000,
        },
      ],
    },
  ],
  ...over,
});

describe('normalizeName', () => {
  it('trims leading and trailing whitespace', () => {
    expect(normalizeName('   Auth   ')).toBe('Auth');
  });
});

describe('validateProfileName', () => {
  it('rejects empty and whitespace-only names', () => {
    expect(validateProfileName('', [])).toEqual({ ok: false, error: expect.any(String) });
    expect(validateProfileName('   ', [])).toEqual({ ok: false, error: expect.any(String) });
  });

  it('rejects names over 60 chars', () => {
    const longName = 'a'.repeat(61);
    expect(validateProfileName(longName, [])).toMatchObject({ ok: false });
  });

  it('accepts names at the 60-char boundary', () => {
    const boundary = 'a'.repeat(60);
    expect(validateProfileName(boundary, [])).toEqual({ ok: true });
  });

  it('rejects duplicate names (case-insensitive)', () => {
    const existing = [makeIndexEntry({ name: 'Auth-JWT' })];
    expect(validateProfileName('auth-jwt', existing)).toMatchObject({ ok: false });
    expect(validateProfileName('  Auth-JWT  ', existing)).toMatchObject({ ok: false });
  });

  it('skips the excluded id when checking duplicates (rename same-name)', () => {
    const existing = [makeIndexEntry({ id: 'p1', name: 'Auth-JWT' })];
    expect(validateProfileName('Auth-JWT', existing, 'p1')).toEqual({ ok: true });
  });
});

describe('isProfile', () => {
  it('accepts a fully valid profile', () => {
    expect(isProfile(makeValidProfile())).toBe(true);
  });

  it('rejects null, arrays, primitives', () => {
    expect(isProfile(null)).toBe(false);
    expect(isProfile([])).toBe(false);
    expect(isProfile('nope')).toBe(false);
  });

  it('rejects profiles with wrong schemaVersion', () => {
    expect(isProfile(makeValidProfile({ schemaVersion: 999 as never }))).toBe(false);
  });

  it('rejects profiles missing required fields', () => {
    const { name: _unused, ...noName } = makeValidProfile();
    expect(isProfile(noName)).toBe(false);
  });

  it('rejects profiles with malformed tabs', () => {
    const bad = makeValidProfile();
    bad.windows[0].tabs[0] = { ...bad.windows[0].tabs[0], pinned: 'yes' as never };
    expect(isProfile(bad)).toBe(false);
  });

  it('accepts profiles with optional highlight fields', () => {
    const withHighlights = makeValidProfile();
    withHighlights.windows[0].tabs[0].scrollY = 400;
    withHighlights.windows[0].tabs[0].anchorText = 'some text';
    withHighlights.windows[0].tabs[0].highlights = [{ text: 'hi', anchor: 'h1' }];
    expect(isProfile(withHighlights)).toBe(true);
  });
});

describe('isProfileIndex', () => {
  it('accepts an empty array', () => {
    expect(isProfileIndex([])).toBe(true);
  });

  it('rejects arrays with malformed entries', () => {
    expect(isProfileIndex([{ id: 'x' }])).toBe(false);
  });
});

describe('isProfileIndexEntry — tabsWithState back-compat', () => {
  it('accepts entries without tabsWithState (old index shape)', () => {
    expect(isProfileIndexEntry(makeIndexEntry())).toBe(true);
  });

  it('accepts entries with a numeric tabsWithState', () => {
    expect(isProfileIndexEntry(makeIndexEntry({ tabsWithState: 5 }))).toBe(true);
  });

  it('rejects entries with a non-numeric tabsWithState', () => {
    expect(
      isProfileIndexEntry({ ...makeIndexEntry(), tabsWithState: 'many' as never }),
    ).toBe(false);
  });
});

const makeTab = (over: Partial<SavedTab> = {}): SavedTab => ({
  url: 'https://a.com',
  title: 'A',
  pinned: false,
  groupId: -1,
  index: 0,
  restricted: false,
  capturedAt: 1_700_000_000_000,
  ...over,
});

describe('tabHasState', () => {
  it('returns false for a plain metadata-only tab', () => {
    expect(tabHasState(makeTab())).toBe(false);
  });

  it('returns false for a scrollY below the substantial-scroll threshold', () => {
    // Matches SCROLL_MIN_TARGET_PX behavior at restore — SPAs commonly emit
    // scrollY = 0 no matter how far the user scrolled, so <100 doesn't
    // count as real state.
    expect(tabHasState(makeTab({ scrollY: 50 }))).toBe(false);
  });

  it('returns true for a substantial scrollY', () => {
    expect(tabHasState(makeTab({ scrollY: 400 }))).toBe(true);
  });

  it('returns true when any anchor text was captured', () => {
    expect(tabHasState(makeTab({ anchorText: 'x' }))).toBe(true);
  });

  it('returns true when at least one highlight was captured', () => {
    expect(
      tabHasState(makeTab({ highlights: [{ text: 't', anchor: 'a' }] })),
    ).toBe(true);
  });

  it('returns true when at least one frame has state', () => {
    expect(
      tabHasState(
        makeTab({
          frames: [{ url: 'https://iframe.com', scrollY: 500 }],
        }),
      ),
    ).toBe(true);
  });

  it('ignores frame entries with only metadata (no scroll or anchor)', () => {
    expect(
      tabHasState(makeTab({ frames: [{ url: 'https://iframe.com' }] })),
    ).toBe(false);
  });
});

describe('countTabsWithState', () => {
  it('sums across every window in the profile', () => {
    const profile = makeValidProfile();
    profile.windows = [
      {
        focused: true,
        tabs: [
          makeTab({ scrollY: 400 }),
          makeTab({ url: 'https://b.com' }), // no state
        ],
      },
      {
        focused: false,
        tabs: [makeTab({ url: 'https://c.com', anchorText: 'hi' })],
      },
    ];
    expect(countTabsWithState(profile)).toBe(2);
  });

  it('returns 0 when nothing has state', () => {
    const profile = makeValidProfile();
    expect(countTabsWithState(profile)).toBe(0);
  });
});
