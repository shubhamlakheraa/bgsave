import type { Profile, ProfileIndexEntry, ValidationResult } from './types';

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
  | { type: 'FREEZE_WORKSPACE'; name: string; tabIds?: number[] };

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
}

export type ResponseData<K extends MessageType> = ResponseMap[K];

// Wire-level envelope — background always responds with this shape so
// errors can cross the message boundary (thrown errors can't).
export type Envelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

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
    throw new Error(envelope.error);
  }
  return envelope.data;
}
