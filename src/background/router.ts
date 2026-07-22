import type { HighlightStore } from '../shared/highlightStore';
import { QuotaExceededError, type ProfileStore } from '../shared/storage';
import {
  STORAGE_QUOTA_BYTES,
  STORAGE_WARN_BYTES,
} from '../shared/constants';
import type {
  Envelope,
  Message,
  MessageType,
  QuotaUsage,
  ResponseData,
} from '../shared/messaging';
import type { WriteQueue } from './writeQueue';
import { appendTabToWorkspace } from './append';
import { removeTabFromWorkspace } from './removeTab';
import {
  freezeWorkspace,
  type FramesEnumerator,
  type TabFetcher,
  type TabMessenger,
} from './freeze';
import {
  restoreWorkspace,
  type TabCreator,
  type TabLoadWaiter,
} from './restore';

// Operations that touch multiple storage keys (or otherwise mutate) go
// through the queue. Reads run concurrently.
const QUEUED_OPS: ReadonlySet<MessageType> = new Set<MessageType>([
  'SAVE_PROFILE',
  'DELETE_PROFILE',
  'RENAME_PROFILE',
  'FREEZE_WORKSPACE',
  'RESTORE_WORKSPACE',
  'APPEND_TAB',
  'REMOVE_TAB',
]);

export interface HandlerDeps {
  store: ProfileStore;
  queue: WriteQueue;
  tabs: TabFetcher;
  messenger: TabMessenger;
  highlights: HighlightStore;
  creator: TabCreator;
  waiter: TabLoadWaiter;
  frames: FramesEnumerator;
  now: () => number;
  newId: () => string;
  // Bytes currently held in the underlying KVStore. Passed as a getter
  // (not the KVStore itself) so the router stays unaware of the storage
  // implementation.
  bytesInUse: () => Promise<number>;
}

/**
 * Factory returning a pure message handler. `chrome.runtime.onMessage` is
 * bound in background/index.ts — this file stays testable in Node.
 *
 * Every handler returns an Envelope so errors serialize cleanly across the
 * message boundary. Thrown errors become {ok: false, error}.
 */
export function makeMessageHandler(deps: HandlerDeps) {
  const {
    store,
    queue,
    tabs,
    messenger,
    highlights,
    creator,
    waiter,
    frames,
    now,
    newId,
    bytesInUse,
  } = deps;

  const run = async (msg: Message): Promise<ResponseData<MessageType>> => {
    switch (msg.type) {
      case 'PING':
        return { type: 'PONG', at: now() };
      case 'LIST_PROFILES':
        return store.listProfiles();
      case 'GET_PROFILE':
        return store.getProfile(msg.id);
      case 'VALIDATE_NAME':
        return store.validateName(msg.name, msg.excludeId);
      case 'SAVE_PROFILE':
        await store.saveProfile(msg.profile);
        return null;
      case 'DELETE_PROFILE':
        await store.deleteProfile(msg.id);
        return null;
      case 'RENAME_PROFILE':
        await store.renameProfile(msg.id, msg.newName);
        return null;
      case 'FREEZE_WORKSPACE':
        return freezeWorkspace(
          { store, tabs, messenger, highlights, frames, now, newId },
          { name: msg.name, tabIds: msg.tabIds },
        );
      case 'RESTORE_WORKSPACE':
        return restoreWorkspace(
          { store, highlights, creator, waiter, messenger, frames },
          { id: msg.id },
        );
      case 'APPEND_TAB': {
        // Look up the live tab once here; the pure append fn takes it as
        // a plain TabLike so its tests don't need chrome.tabs at all.
        const [tab] = await tabs.getTabs([msg.tabId]);
        if (!tab) throw new Error(`Tab ${msg.tabId} not found.`);
        return appendTabToWorkspace(
          { store, messenger, highlights, frames, now },
          { profileId: msg.profileId, tab },
        );
      }
      case 'REMOVE_TAB':
        return removeTabFromWorkspace(
          { store, now },
          {
            profileId: msg.profileId,
            windowIndex: msg.windowIndex,
            tabIndex: msg.tabIndex,
          },
        );
      case 'GET_QUOTA_USAGE': {
        const used = await bytesInUse();
        const usage: QuotaUsage = {
          bytesInUse: used,
          warnBytes: STORAGE_WARN_BYTES,
          quotaBytes: STORAGE_QUOTA_BYTES,
          percent: Math.round((used / STORAGE_QUOTA_BYTES) * 100) / 100,
        };
        return usage;
      }
      default: {
        const _exhaustive: never = msg;
        throw new Error(`Unknown message type: ${JSON.stringify(_exhaustive)}`);
      }
    }
  };

  return async function handle<M extends Message>(
    msg: M,
  ): Promise<Envelope<ResponseData<M['type']>>> {
    try {
      const data = QUEUED_OPS.has(msg.type)
        ? await queue.enqueue(() => run(msg))
        : await run(msg);
      return { ok: true, data: data as ResponseData<M['type']> };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      if (err instanceof QuotaExceededError) {
        return { ok: false, error, code: 'quota_exceeded' };
      }
      return { ok: false, error };
    }
  };
}
