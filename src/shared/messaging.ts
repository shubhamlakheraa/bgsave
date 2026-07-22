import type { Profile, ProfileIndexEntry, ValidationResult } from './types';

// Summary returned by RESTORE_WORKSPACE so the popup can render a short
// "Restored 8 tabs (7 with state)" toast after the fact.
export interface RestoreSummary {
  windowsCreated: number;
  tabsCreated: number;
  // Tabs where APPLY_STATE returned scrollY or anchor (i.e. cognitive state
  // was reapplied). Restricted / no-state tabs don't count here — they're
  // still counted in tabsCreated.
  tabsWithState: number;
  // Tabs that failed to load in time or failed APPLY_STATE outright.
  tabsFailed: number;
}

// ---------------------------------------------------------------------------
// Message contract: single source of truth for background operations.
//
// - `Message` is a discriminated union of all requests. Each variant lists
//   only the fields it actually needs (no phantom req objects).
// - `ResponseMap` maps message-type strings to their response payloads.
//   `sendToBackground` narrows automatically from the passed message.
// ---------------------------------------------------------------------------

export type Message =
  | { type: 'PING' }
  | { type: 'LIST_PROFILES' }
  | { type: 'GET_PROFILE'; id: string }
  | { type: 'SAVE_PROFILE'; profile: Profile }
  | { type: 'DELETE_PROFILE'; id: string }
  | { type: 'RENAME_PROFILE'; id: string; newName: string }
  | { type: 'VALIDATE_NAME'; name: string; excludeId?: string }
  | { type: 'FREEZE_WORKSPACE'; name: string; tabIds?: number[] }
  | { type: 'RESTORE_WORKSPACE'; id: string }
  | { type: 'APPEND_TAB'; profileId: string; tabId: number }
  | {
      type: 'REMOVE_TAB';
      profileId: string;
      windowIndex: number;
      tabIndex: number;
    }
  | { type: 'GET_QUOTA_USAGE' };

// Snapshot of chrome.storage.local usage. Popup/options render a banner
// once `percent` crosses the warn threshold so the user can prune before
// Chrome starts rejecting writes.
export interface QuotaUsage {
  bytesInUse: number;
  warnBytes: number;
  quotaBytes: number;
  // Fraction 0..1. Rounded to two decimals to avoid noisy re-renders.
  percent: number;
}

// Outcome of appending one tab to an existing workspace. `kind: 'appended'`
// carries the new tab count so the context-menu handler can render a
// success badge without a follow-up LIST_PROFILES call.
export type AppendTabResult =
  | { kind: 'appended'; tabCount: number; tabsWithState: number }
  | { kind: 'duplicate' }
  | { kind: 'not_found' };

// Outcome of removing one tab from a workspace. `last_tab` is a distinct
// case so the options page can say "delete the workspace instead" rather
// than a generic error.
export type RemoveTabResult =
  | { kind: 'removed'; tabCount: number; tabsWithState: number }
  | { kind: 'not_found' }
  | { kind: 'last_tab' };

export type MessageType = Message['type'];

export interface ResponseMap {
  PING: { type: 'PONG'; at: number };
  LIST_PROFILES: ProfileIndexEntry[];
  GET_PROFILE: Profile | null;
  SAVE_PROFILE: null;
  DELETE_PROFILE: null;
  RENAME_PROFILE: null;
  VALIDATE_NAME: ValidationResult;
  FREEZE_WORKSPACE: ProfileIndexEntry;
  RESTORE_WORKSPACE: RestoreSummary;
  APPEND_TAB: AppendTabResult;
  REMOVE_TAB: RemoveTabResult;
  GET_QUOTA_USAGE: QuotaUsage;
}

export type ResponseData<K extends MessageType> = ResponseMap[K];

// Codes attached to error envelopes so the UI can branch on well-known
// failure modes (currently just quota) without string-matching.
export type ErrorCode = 'quota_exceeded';

// Wire-level envelope — background always responds with this shape so
// errors can cross the message boundary (thrown errors can't).
export type Envelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: ErrorCode };

// Thrown by sendToBackground so callers can `instanceof` check for the
// well-known error codes (quota, etc.) without parsing message strings.
export class BackgroundError extends Error {
  constructor(message: string, readonly code?: ErrorCode) {
    super(message);
    this.name = 'BackgroundError';
  }
}

/**
 * Send a message to the background worker and get back a typed response.
 * Rejects if the background responds with an error envelope, or if the
 * runtime channel closes without a reply.
 */
export async function sendToBackground<M extends Message>(
  msg: M,
): Promise<ResponseData<M['type']>> {
  const envelope = (await chrome.runtime.sendMessage(msg)) as
    | Envelope<ResponseData<M['type']>>
    | undefined;

  if (!envelope) {
    throw new Error(`No response from background for ${msg.type}.`);
  }
  if (envelope.ok === false) {
    throw new BackgroundError(envelope.error, envelope.code);
  }
  return envelope.data;
}
