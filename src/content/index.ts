import { APP_NAME } from '../shared/constants';
import type {
  ApplyResult,
  CapturedState,
  ContentMessage,
} from '../shared/contentMessaging';
import { applyState } from './apply-logic';
import { captureState } from './capture-logic';
import { initHighlights } from './highlights';

// Run only in the top frame. Content scripts are injected into every frame
// by default (thanks to <all_urls>), and iframe scroll positions aren't
// what the user thinks of as "the page's scroll".
if (window.top === window) {
  initHighlights();

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
      return;
    }

    if (msg?.type === 'APPLY_STATE') {
      try {
        const method = applyState(document, window, msg.state);
        const result: ApplyResult = { method };
        sendResponse(result);
      } catch (err) {
        console.warn(`[${APP_NAME}] apply failed:`, err);
        sendResponse({ method: 'failed' } satisfies ApplyResult);
      }
      return;
    }
  });
}
