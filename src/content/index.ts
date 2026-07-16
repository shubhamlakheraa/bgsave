import { APP_NAME } from '../shared/constants';
import type { ContentMessage, CapturedState } from '../shared/contentMessaging';
import { captureState } from './capture-logic';

// Run only in the top frame. Content scripts are injected into every frame
// by default (thanks to <all_urls>), and iframe scroll positions aren't
// what the user thinks of as "the page's scroll".
if (window.top === window) {
  chrome.runtime.onMessage.addListener((msg: ContentMessage, _sender, sendResponse) => {
    if (msg?.type === 'CAPTURE_STATE') {
      // Wrap in try/catch so an unexpected DOM edge case (detached document
      // during navigation, quirky same-origin iframe) can't leave the
      // background hanging on a promise that never resolves.
      try {
        const state: CapturedState = captureState(document, window);
        sendResponse(state);
      } catch (err) {
        console.warn(`[${APP_NAME}] capture failed:`, err);
        sendResponse({ scrollY: 0, anchorText: '' });
      }
      // Synchronous response — no `return true` needed.
      return;
    }
  });
}
