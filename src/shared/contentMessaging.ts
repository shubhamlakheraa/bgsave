// ---------------------------------------------------------------------------
// Contract for background ↔ content-script messages (chrome.tabs.sendMessage
// transport). Kept separate from shared/messaging.ts because that file is the
// runtime.sendMessage contract (popup/options → background), and the two go
// through different Chrome APIs. Mixing them in one union would let a caller
// send the wrong type down the wrong channel.
// ---------------------------------------------------------------------------

export interface CapturedState {
  // window.scrollY at capture time.
  scrollY: number;
  // Short text snippet used to relocate the same DOM region on restore even
  // if the page's content has drifted. Empty string when the page has no
  // extractable anchor (e.g., landing pages that are all images).
  anchorText: string;
}

// State the background asks a restored tab to apply. Both fields optional
// so we can send a partial restore for tabs that only had one of them
// captured (e.g., no anchor was extractable at freeze time).
export interface RestoreState {
  scrollY?: number;
  anchorText?: string;
}

// Which strategy the content script used to satisfy the restore. Reported
// back to the caller so the restore flow can surface an "N/M restored"
// summary in the popup.
export type ApplyMethod = 'scrollY' | 'anchor' | 'noop' | 'failed';

export interface ApplyResult {
  method: ApplyMethod;
}

export type ContentMessage =
  | { type: 'CAPTURE_STATE' }
  | { type: 'APPLY_STATE'; state: RestoreState };

export interface ContentResponseMap {
  CAPTURE_STATE: CapturedState;
  APPLY_STATE: ApplyResult;
}

export type ContentResponse<K extends ContentMessage['type']> = ContentResponseMap[K];
