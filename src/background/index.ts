import { getSettings, saveSettings, setTabState, clearTabState, tabStateKey } from '../shared/storage';
import { summarize } from '../lib/summarizer';
import { sendToTab } from '../shared/messages';
import type { Message } from '../shared/types';

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getActiveTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

// ── Message router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: Message, sender, sendResponse: (r: unknown) => void) => {
    switch (message.type) {

      // ── Popup → Background → Content ──────────────────────────────────────
      case 'CMD_START':
        void getActiveTabId().then((id) => id && sendToTab(id, { type: 'START_READING' }));
        sendResponse({ ok: true });
        break;

      case 'CMD_PAUSE':
        void getActiveTabId().then((id) => id && sendToTab(id, { type: 'PAUSE_READING' }));
        sendResponse({ ok: true });
        break;

      case 'CMD_RESUME':
        void getActiveTabId().then((id) => id && sendToTab(id, { type: 'RESUME_READING' }));
        sendResponse({ ok: true });
        break;

      case 'CMD_STOP':
        void getActiveTabId().then((id) => id && sendToTab(id, { type: 'STOP_READING' }));
        sendResponse({ ok: true });
        break;

      // ── Popup → Background: settings ─────────────────────────────────────
      case 'CMD_GET_SETTINGS':
        void getSettings().then((s) => sendResponse({ type: 'SETTINGS_RESPONSE', payload: s }));
        return true;

      case 'CMD_UPDATE_SETTINGS':
        void saveSettings(message.payload).then(() => sendResponse({ ok: true }));
        return true;

      // ── Popup → Background: state ─────────────────────────────────────────
      case 'CMD_GET_STATE': {
        void getActiveTabId().then(async (id) => {
          if (!id) { sendResponse({ type: 'STATE_RESPONSE', payload: null }); return; }
          const key = tabStateKey(id);
          const result = await chrome.storage.session.get(key);
          sendResponse({ type: 'STATE_RESPONSE', payload: result[key] ?? null });
        });
        return true;
      }

      // ── Content → Background: state update ───────────────────────────────
      case 'READER_STATE_UPDATE': {
        const tabId = sender.tab?.id;
        if (tabId !== undefined) {
          void setTabState(tabId, message.payload);
        }
        sendResponse({ ok: true });
        break;
      }

      // ── Content → Background: summarise ──────────────────────────────────
      case 'SUMMARIZE': {
        const tabId = sender.tab?.id;
        void (async () => {
          try {
            const settings = await getSettings();
            const summary = await summarize(message.payload.text, settings);
            if (tabId !== undefined) {
              void sendToTab(tabId, { type: 'SUMMARY_READY', payload: summary });
            }
          } catch (err) {
            console.error('[Readly] Summarisation failed:', err);
          }
          sendResponse({ ok: true });
        })();
        return true;
      }

      default:
        break;
    }
    return false;
  },
);

// ── Cleanup ──────────────────────────────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearTabState(tabId);
});

// ── Action click (when no popup is set) ──────────────────────────────────────

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id !== undefined) {
    await sendToTab(tab.id, { type: 'START_READING' });
  }
});
