import type { ReaderSettings, ReaderState } from './types';

export const DEFAULT_SETTINGS: ReaderSettings = {
  voice: '',
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,
  aiProvider: 'none',
  aiApiKey: '',
  highlightEnabled: true,
  autoSummarize: true,
};

const SETTINGS_KEY = 'readly_settings';
const STATE_KEY_PREFIX = 'readly_state_';

export async function getSettings(): Promise<ReaderSettings> {
  const result = await chrome.storage.sync.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] as Partial<ReaderSettings> | undefined) };
}

export async function saveSettings(patch: Partial<ReaderSettings>): Promise<void> {
  const current = await getSettings();
  await chrome.storage.sync.set({ [SETTINGS_KEY]: { ...current, ...patch } });
}

export async function getTabState(tabId: number): Promise<ReaderState | null> {
  const key = `${STATE_KEY_PREFIX}${tabId}`;
  const result = await chrome.storage.session.get(key);
  return (result[key] as ReaderState | undefined) ?? null;
}

export async function setTabState(tabId: number, state: ReaderState): Promise<void> {
  await chrome.storage.session.set({ [`${STATE_KEY_PREFIX}${tabId}`]: state });
}

export async function clearTabState(tabId: number): Promise<void> {
  await chrome.storage.session.remove(`${STATE_KEY_PREFIX}${tabId}`);
}

export function tabStateKey(tabId: number): string {
  return `${STATE_KEY_PREFIX}${tabId}`;
}
