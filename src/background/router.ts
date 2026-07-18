import type { HighlightStore } from '../shared/highlightStore';
import type { ProfileStore } from '../shared/storage';
import type {
  Envelope,
  Message,
  MessageType,
  ResponseData,
} from '../shared/messaging';
import type { WriteQueue } from './writeQueue';
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
      return { ok: false, error };
    }
  };
}
