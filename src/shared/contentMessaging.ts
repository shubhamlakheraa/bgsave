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

export type ContentMessage = { type: 'CAPTURE_STATE' };

export interface ContentResponseMap {
  CAPTURE_STATE: CapturedState;
}

export type ContentResponse<K extends ContentMessage['type']> = ContentResponseMap[K];
