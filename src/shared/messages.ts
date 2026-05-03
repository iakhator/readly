import type { ReaderState, ReaderSettings, Summary } from './types';

export type Message =
  // Popup → Background (commands)
  | { type: 'CMD_START' }
  | { type: 'CMD_PAUSE' }
  | { type: 'CMD_RESUME' }
  | { type: 'CMD_STOP' }
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
  | { type: 'SUMMARY_READY'; payload: Summary }
  // Background → Popup (responses)
  | { type: 'SETTINGS_RESPONSE'; payload: ReaderSettings }
  | { type: 'STATE_RESPONSE'; payload: ReaderState | null };

export function sendToBackground(message: Message): Promise<Message> {
  return chrome.runtime.sendMessage(message) as Promise<Message>;
}

export function sendToTab(tabId: number, message: Message): Promise<void> {
  return chrome.tabs.sendMessage(tabId, message) as Promise<void>;
}
