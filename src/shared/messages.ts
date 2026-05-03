import type { ReaderState, ReaderSettings, Summary } from './types';

export type Message =
  // Popup → Background (commands)
  | { type: 'CMD_START' }
  | { type: 'CMD_PAUSE' }
  | { type: 'CMD_RESUME' }
  | { type: 'CMD_STOP' }
  | { type: 'CMD_SKIP' }
  | { type: 'CMD_GET_STATE' }
  | { type: 'CMD_GET_SETTINGS' }
  | { type: 'CMD_UPDATE_SETTINGS'; payload: Partial<ReaderSettings> }
  // Content → Background (events)
  | { type: 'READER_STATE_UPDATE'; payload: ReaderState }
  | { type: 'SUMMARIZE'; payload: { text: string } }
  // Background → Content (instructions)
  | { type: 'START_READING' }
  | { type: 'PAUSE_READING' }
  | { type: 'RESUME_READING' }
  | { type: 'STOP_READING' }
  | { type: 'SKIP_TO_SUMMARY' }
  | { type: 'SUMMARY_READY'; payload: Summary }
  // Background → Popup (responses)
  | { type: 'SETTINGS_RESPONSE'; payload: ReaderSettings }
  | { type: 'STATE_RESPONSE'; payload: ReaderState | null };

/**
 * Send a message from popup/content to the background service worker.
 * Returns null when the SW isn't reachable (still waking up, etc.).
 */
export async function sendToBackground(message: Message): Promise<Message | null> {
  try {
    return (await chrome.runtime.sendMessage(message)) as Message;
  } catch (err) {
    if (!isConnectionError(err)) console.warn('[Readly] sendToBackground:', err);
    return null;
  }
}

/**
 * Send a message from the background to a tab's content script.
 * Silently no-ops when the tab has no content script running
 * (chrome://, new tab, PDF, extension page, etc.).
 */
export async function sendToTab(tabId: number, message: Message): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    if (!isConnectionError(err)) console.warn('[Readly] sendToTab:', err);
  }
}

function isConnectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('Receiving end does not exist') ||
    msg.includes('Could not establish connection') ||
    msg.includes('The message port closed before a response was received')
  );
}
