import { APP_NAME, APP_VERSION } from '../shared/constants';

chrome.runtime.onInstalled.addListener((details) => {
  console.log(`[${APP_NAME}] background alive — v${APP_VERSION} — reason: ${details.reason}`);
});

chrome.runtime.onStartup.addListener(() => {
  console.log(`[${APP_NAME}] background alive on browser startup`);
});
