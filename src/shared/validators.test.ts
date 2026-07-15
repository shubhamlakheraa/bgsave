import { describe, it, expect } from 'vitest';
import {
  isProfile,
  isProfileIndex,
  normalizeName,
  validateProfileName,
} from './validators';
import { SCHEMA_VERSION } from './constants';
import type { Profile, ProfileIndexEntry } from './types';

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
