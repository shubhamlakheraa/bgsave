export const APP_NAME = 'bgsave';
export const APP_VERSION = '0.1.0';

export const STORAGE_KEYS = {
  PROFILE_INDEX: 'profileIndex',
  PROFILE_PREFIX: 'profile:',
  CORRUPTED_PREFIX: '__corrupted:',
  LAST_SESSION_ID: '__last_session__',
  SETTINGS: 'settings',
  HIGHLIGHT_PREFIX: 'highlights:',
} as const;

export const profileKey = (id: string) => `${STORAGE_KEYS.PROFILE_PREFIX}${id}`;
export const corruptedKey = (id: string) => `${STORAGE_KEYS.CORRUPTED_PREFIX}${id}`;
export const highlightsKey = (normalizedUrl: string) =>
  `${STORAGE_KEYS.HIGHLIGHT_PREFIX}${normalizedUrl}`;

export const MESSAGES = {
  PING: 'PING',
  FREEZE_WORKSPACE: 'FREEZE_WORKSPACE',
  RESTORE_WORKSPACE: 'RESTORE_WORKSPACE',
  LIST_PROFILES: 'LIST_PROFILES',
  ADD_TAB_TO_PROFILE: 'ADD_TAB_TO_PROFILE',
  CAPTURE_TAB_STATE: 'CAPTURE_TAB_STATE',
  APPLY_TAB_STATE: 'APPLY_TAB_STATE',
} as const;

export const LIMITS = {
  PROFILE_NAME_MIN: 1,
  PROFILE_NAME_MAX: 60,
  ANCHOR_TEXT_MAX: 200,
  TITLE_MAX: 200,
  CAPTURE_TIMEOUT_MS: 2000,
  // Wait up to this long for a restored tab to reach 'complete' before we
  // give up on APPLY_STATE for it. Big pages and slow networks are the
  // realistic upper bound; beyond this the user is better off scrolling
  // manually than waiting for us.
  RESTORE_LOAD_TIMEOUT_MS: 10_000,
  // Prefix length (chars of preceding text) used to disambiguate a highlight
  // from other occurrences of the same text on the page.
  HIGHLIGHT_ANCHOR_MAX: 60,
  // Cap on a single highlight's text. Huge selections tend to be accidental
  // drag-selects (e.g. entire page); cutting them off protects storage and
  // keeps the re-apply search cheap.
  HIGHLIGHT_TEXT_MAX: 1000,
  // Max highlights per URL. Above this new highlights are refused.
  HIGHLIGHTS_PER_URL_MAX: 200,
} as const;

export const SCHEMA_VERSION = 1 as const;
