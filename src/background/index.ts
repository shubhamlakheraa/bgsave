import { APP_NAME, APP_VERSION, STORAGE_KEYS } from '../shared/constants';
import { ChromeKVStore } from '../shared/kvStore';
import { HighlightStore } from '../shared/highlightStore';
import { ProfileStore } from '../shared/storage';
import { makeMessageHandler } from './router';
import { WriteQueue } from './writeQueue';
import {
  makeChromeFramesEnumerator,
  makeChromeTabFetcher,
  makeChromeTabMessenger,
} from './freeze';
import { makeChromeTabCreator, makeChromeTabLoadWaiter } from './restore';
import {
  profileIdFromChildId,
  rebuildContextMenu,
  type ContextMenuAPI,
} from './contextMenu';

// Wire-up. Instances are created at each service-worker cold start; all
// persistent state lives in chrome.storage.local, so worker suspension
// is transparent to callers.
const kv = new ChromeKVStore();
const store = new ProfileStore(kv);
const highlights = new HighlightStore(kv);
const queue = new WriteQueue();
const handle = makeMessageHandler({
  store,
  queue,
  tabs: makeChromeTabFetcher(),
  messenger: makeChromeTabMessenger(),
  highlights,
  creator: makeChromeTabCreator(),
  waiter: makeChromeTabLoadWaiter(),
  frames: makeChromeFramesEnumerator(),
  now: () => Date.now(),
  newId: () => crypto.randomUUID(),
  bytesInUse: () => kv.getBytesInUse(),
});

// Concrete chrome.contextMenus adapter. Kept here (not in contextMenu.ts)
// so that module stays free of chrome.* imports and testable in Node.
const menuApi: ContextMenuAPI = {
  removeAll() {
    return new Promise((resolve) => chrome.contextMenus.removeAll(() => resolve()));
  },
  create(spec) {
    chrome.contextMenus.create(spec);
  },
};

async function refreshMenu() {
  try {
    const profiles = await store.listProfiles();
    await rebuildContextMenu(menuApi, profiles);
  } catch (err) {
    console.error(`[${APP_NAME}] context menu rebuild failed:`, err);
  }
}

// Chrome loses the badge state whenever the service worker is torn down,
// so this timer is best-effort: if the SW dies before the timeout, the
// badge already went away with it. Good enough for a "you're seeing this
// because you just clicked" UX signal.
const BADGE_MS = 1500;

async function flashBadge(text: string, color: string) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '' }).catch(() => {});
    }, BADGE_MS);
  } catch {
    // Older Chromes / non-action-supporting contexts — silently drop.
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  console.log(`[${APP_NAME}] background alive — v${APP_VERSION} — reason: ${details.reason}`);
  void refreshMenu();
  // Only true installs get the welcome tab. Extension updates and Chrome
  // updates fire this same event with different reasons — opening a tab
  // on every update would be spammy.
  if (details.reason === 'install') {
    chrome.tabs
      .create({ url: chrome.runtime.getURL('welcome.html') })
      .catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(() => {
  console.log(`[${APP_NAME}] background alive on browser startup`);
  void refreshMenu();
});

// Whenever the profile index changes (freeze, rename, delete, append),
// rebuild the menu so the submenu list stays authoritative.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes[STORAGE_KEYS.PROFILE_INDEX]) void refreshMenu();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const profileId = profileIdFromChildId(info.menuItemId);
  if (!profileId) return; // not one of ours
  if (!tab || tab.id === undefined) {
    void flashBadge('!', '#e74c3c');
    return;
  }
  // Route through the message handler so APPEND_TAB shares the same
  // WriteQueue that FREEZE_WORKSPACE / SAVE_PROFILE use — a click that
  // fires while a freeze is mid-save must serialize behind it, otherwise
  // the two writes race on the same profile blob.
  (async () => {
    const envelope = await handle({
      type: 'APPEND_TAB',
      profileId,
      tabId: tab.id!,
    });
    if (!envelope.ok) {
      console.error(`[${APP_NAME}] append failed:`, envelope.error);
      await flashBadge('!', '#e74c3c');
      return;
    }
    const outcome = envelope.data;
    if (outcome.kind === 'appended') await flashBadge('+1', '#2ecc71');
    else if (outcome.kind === 'duplicate') await flashBadge('=', '#b58b3a');
    else await flashBadge('!', '#e74c3c');
  })();
});

// Message router entry point. `return true` keeps the sendResponse channel
// open for the async handler — required by MV3.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg)
    .then(sendResponse)
    .catch((err) => {
      const error = err instanceof Error ? err.message : String(err);
      sendResponse({ ok: false, error });
    });
  return true;
});
