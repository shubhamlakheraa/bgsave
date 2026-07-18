import { APP_NAME } from '../shared/constants';
import type {
  ApplyMethod,
  ApplyResult,
  CapturedState,
  ContentMessage,
  RestoreState,
} from '../shared/contentMessaging';
import { applyState } from './apply-logic';
import { captureState } from './capture-logic';
import { initHighlights } from './highlights';

// Retry cadence for scroll restoration on late-hydrating pages. First pass
// runs immediately, then we retry at these offsets from the initial call.
// Stops early if any retry lands on 'scrollY', or if the user has scrolled
// / interacted with the page (we don't want to fight their input).
const APPLY_RETRY_DELAYS_MS = [400, 1200, 2400];

// Run in every frame (top + iframes). Iframes get their own message
// listener for capture / apply, and their own highlight subsystem —
// crucial for Claude artifacts, which live in about:srcdoc iframes.
initHighlights();

chrome.runtime.onMessage.addListener((msg: ContentMessage, _sender, sendResponse) => {
  if (msg?.type === 'CAPTURE_STATE') {
    try {
      const state: CapturedState = captureState(document, window);
      sendResponse(state);
    } catch (err) {
      console.warn(`[${APP_NAME}] capture failed:`, err);
      sendResponse({ scrollY: 0, anchorText: '' });
    }
    return undefined;
  }

  if (msg?.type === 'APPLY_STATE') {
    applyWithRetries(msg.state)
      .then((method) => sendResponse({ method } satisfies ApplyResult))
      .catch((err) => {
        console.warn(`[${APP_NAME}] apply failed:`, err);
        sendResponse({ method: 'failed' } satisfies ApplyResult);
      });
    // Async response — keep the channel open until the retries settle.
    return true;
  }

  return undefined;
});

/**
 * Run applyState once immediately, then retry a few times if the first
 * pass didn't land on the exact scrollY. Late-hydrating SPAs commonly
 * finish rendering after `document_idle` and `tab.status='complete'`,
 * so a single pass is unreliable — but we don't want to loop forever
 * either, so we cap at a handful of retries and bail on user input.
 */
async function applyWithRetries(state: RestoreState): Promise<ApplyMethod> {
  let method = applyState(document, window, state);
  if (method === 'scrollY' || method === 'anchor' || method === 'noop') {
    // First pass already resolved to a real method — the retry loop's
    // only job is to catch late-hydration cases where nothing was
    // scrollable/searchable yet. If we already succeeded, we're done.
    if (method !== 'anchor') return method;
    // For 'anchor' we still return early — the target was found.
    return method;
  }

  let userInterrupted = false;
  const bail = () => {
    userInterrupted = true;
  };
  window.addEventListener('wheel', bail, { once: true, passive: true });
  window.addEventListener('touchmove', bail, { once: true, passive: true });
  window.addEventListener('keydown', bail, { once: true });

  try {
    for (const delay of APPLY_RETRY_DELAYS_MS) {
      await new Promise<void>((r) => setTimeout(r, delay));
      if (userInterrupted) break;
      const retried = applyState(document, window, state);
      if (retried === 'scrollY' || retried === 'anchor') return retried;
      if (method === 'failed') method = retried;
    }
  } finally {
    window.removeEventListener('wheel', bail);
    window.removeEventListener('touchmove', bail);
    window.removeEventListener('keydown', bail);
  }
  return method;
}
