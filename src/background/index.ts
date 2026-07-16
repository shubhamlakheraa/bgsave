import { APP_NAME, APP_VERSION } from '../shared/constants';
import { ChromeKVStore } from '../shared/kvStore';
import { ProfileStore } from '../shared/storage';
import { makeMessageHandler } from './router';
import { WriteQueue } from './writeQueue';
import { makeChromeTabFetcher, makeChromeTabMessenger } from './freeze';

// Wire-up. Instances are created at each service-worker cold start; all
// persistent state lives in chrome.storage.local, so worker suspension
// is transparent to callers.
const store = new ProfileStore(new ChromeKVStore());
const queue = new WriteQueue();
const handle = makeMessageHandler({
  store,
  queue,
  tabs: makeChromeTabFetcher(),
  messenger: makeChromeTabMessenger(),
  now: () => Date.now(),
  newId: () => crypto.randomUUID(),
});

chrome.runtime.onInstalled.addListener((details) => {
  console.log(`[${APP_NAME}] background alive — v${APP_VERSION} — reason: ${details.reason}`);
});

chrome.runtime.onStartup.addListener(() => {
  console.log(`[${APP_NAME}] background alive on browser startup`);
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
