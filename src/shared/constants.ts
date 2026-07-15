export const APP_NAME = 'bgsave';
export const APP_VERSION = '0.1.0';

export const STORAGE_KEYS = {
  PROFILE_INDEX: 'profileIndex',
  PROFILE_PREFIX: 'profile:',
  CORRUPTED_PREFIX: '__corrupted:',
  LAST_SESSION_ID: '__last_session__',
  SETTINGS: 'settings',
} as const;

export const profileKey = (id: string) => `${STORAGE_KEYS.PROFILE_PREFIX}${id}`;
export const corruptedKey = (id: string) => `${STORAGE_KEYS.CORRUPTED_PREFIX}${id}`;

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
} as const;

export const SCHEMA_VERSION = 1 as const;
