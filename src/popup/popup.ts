import { sendToBackground } from '../shared/messages';
import { DEFAULT_SETTINGS, tabStateKey } from '../shared/storage';
import type { ReaderState, ReaderSettings } from '../shared/types';

// ── DOM refs ─────────────────────────────────────────────────────────────────

const $emptyState    = el('empty-state');
const $articleDetails = el('article-details');
const $articleTitle  = el('article-title');
const $articleSite   = el('article-site');
const $articleByline = el('article-byline');
const $statusDot     = el('status-dot');
const $statusLabel   = el('status-label');
const $statusEta     = el('status-eta');
const $progressFill  = el('progress-fill');
const $wordsRead     = el('words-read');
const $progressPct   = el('progress-pct');
const $btnPlayPause  = el<HTMLButtonElement>('btn-play-pause');
const $btnStop       = el<HTMLButtonElement>('btn-stop');
const $btnSkip       = el<HTMLButtonElement>('btn-skip');
const $btnSettings   = el<HTMLButtonElement>('btn-settings');
const $settingsPanel = el('settings-panel');
const $speedSlider   = el<HTMLInputElement>('speed-slider');
const $speedValue    = el('speed-value');
const $voiceSelect   = el<HTMLSelectElement>('voice-select');
const $aiProvider    = el<HTMLSelectElement>('ai-provider');
const $apiKeyInput   = el<HTMLInputElement>('api-key-input');
const $apiKeyRow     = el('api-key-row');
const $autoSummarize = el<HTMLInputElement>('auto-summarize');
const $highlightEnabled = el<HTMLInputElement>('highlight-enabled');

let currentState: ReaderState | null = null;
let currentTabId: number | undefined;
let isPlaying = false;

// ── Init ─────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id;

  await loadSettings();
  await loadState();
  populateVoices();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && currentTabId !== undefined) {
      const key = tabStateKey(currentTabId);
      if (key in changes) {
        const newState = changes[key]?.newValue as ReaderState | undefined;
        if (newState) renderState(newState);
      }
    }
    if (area === 'sync') {
      void loadSettings();
    }
  });
}

// ── State ─────────────────────────────────────────────────────────────────────

async function loadState(): Promise<void> {
  try {
    const response = await sendToBackground({ type: 'CMD_GET_STATE' });
    if (response && 'payload' in response) {
      renderState((response as { payload: ReaderState | null }).payload);
    }
  } catch {
    renderState(null);
  }
}

function renderState(state: ReaderState | null): void {
  currentState = state;
  const status = state?.status ?? 'idle';
  isPlaying = status === 'reading';

  $statusDot.className = `status-dot ${status}`;
  $statusLabel.textContent = STATUS_LABELS[status] ?? status;
  $btnPlayPause.textContent = isPlaying ? '⏸' : '▶';
  $btnPlayPause.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  $btnStop.disabled = status === 'idle';
  $btnSkip.disabled = status !== 'reading' && status !== 'paused';

  if (state) {
    $progressFill.style.width = `${state.progress}%`;
    $progressPct.textContent = `${state.progress}%`;
    $wordsRead.textContent = `${state.currentWordIndex} / ${state.totalWords} words`;
    $articleTitle.textContent = state.title ?? '';
    $articleSite.textContent = state.siteName ?? '';
    $articleByline.textContent = state.byline ?? '';
    $emptyState.hidden = true;
    $articleDetails.hidden = false;

    if (state.estimatedTimeRemaining > 0) {
      const m = Math.floor(state.estimatedTimeRemaining / 60);
      const s = state.estimatedTimeRemaining % 60;
      $statusEta.textContent = m > 0 ? `${m}m ${s}s` : `${s}s`;
    } else {
      $statusEta.textContent = '';
    }
  } else {
    $progressFill.style.width = '0%';
    $progressPct.textContent = '0%';
    $wordsRead.textContent = '0 words';
    $statusEta.textContent = '';
    $emptyState.hidden = false;
    $articleDetails.hidden = true;
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────

async function loadSettings(): Promise<void> {
  const response = await sendToBackground({ type: 'CMD_GET_SETTINGS' });
  const settings: ReaderSettings =
    response && 'payload' in response
      ? (response as { payload: ReaderSettings }).payload
      : DEFAULT_SETTINGS;

  $speedSlider.value = String(settings.rate);
  $speedValue.textContent = `${settings.rate.toFixed(1)}×`;
  if (settings.voice) $voiceSelect.value = settings.voice;
  $aiProvider.value = settings.aiProvider;
  $apiKeyInput.value = settings.aiApiKey;
  $autoSummarize.checked = settings.autoSummarize;
  $highlightEnabled.checked = settings.highlightEnabled;
  $apiKeyRow.hidden = settings.aiProvider === 'none';
}

function patchSettings(patch: Partial<ReaderSettings>): void {
  void sendToBackground({ type: 'CMD_UPDATE_SETTINGS', payload: patch });
}

// ── Voices ────────────────────────────────────────────────────────────────────

function populateVoices(): void {
  const fill = () => {
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return;
    $voiceSelect.innerHTML = voices
      .map((v) => `<option value="${v.name}">${v.name} (${v.lang})</option>`)
      .join('');
    // Re-apply saved voice after list is available
    void sendToBackground({ type: 'CMD_GET_SETTINGS' }).then((res) => {
      if (res && 'payload' in res) {
        const saved = (res as { payload: ReaderSettings }).payload.voice;
        if (saved) $voiceSelect.value = saved;
      }
    });
  };
  fill();
  speechSynthesis.addEventListener('voiceschanged', fill, { once: true });
}

// ── Event listeners ───────────────────────────────────────────────────────────

$btnPlayPause.addEventListener('click', () => {
  if (isPlaying) {
    void sendToBackground({ type: 'CMD_PAUSE' });
  } else if (currentState?.status === 'paused') {
    void sendToBackground({ type: 'CMD_RESUME' });
  } else {
    void sendToBackground({ type: 'CMD_START' });
  }
});

$btnStop.addEventListener('click', () => {
  void sendToBackground({ type: 'CMD_STOP' });
});

$btnSkip.addEventListener('click', () => {
  void sendToBackground({ type: 'CMD_SKIP' });
});

$btnSettings.addEventListener('click', () => {
  $settingsPanel.classList.toggle('open');
});

$speedSlider.addEventListener('input', () => {
  const rate = parseFloat($speedSlider.value);
  $speedValue.textContent = `${rate.toFixed(1)}×`;
  patchSettings({ rate });
});

$voiceSelect.addEventListener('change', () => {
  patchSettings({ voice: $voiceSelect.value });
});

$aiProvider.addEventListener('change', () => {
  const aiProvider = $aiProvider.value as ReaderSettings['aiProvider'];
  $apiKeyRow.hidden = aiProvider === 'none';
  patchSettings({ aiProvider });
});

$apiKeyInput.addEventListener('change', () => {
  patchSettings({ aiApiKey: $apiKeyInput.value.trim() });
});

$autoSummarize.addEventListener('change', () => {
  patchSettings({ autoSummarize: $autoSummarize.checked });
});

$highlightEnabled.addEventListener('change', () => {
  patchSettings({ highlightEnabled: $highlightEnabled.checked });
});

// ── Utils ─────────────────────────────────────────────────────────────────────

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const STATUS_LABELS: Record<string, string> = {
  idle: 'Idle',
  loading: 'Loading…',
  reading: 'Reading',
  paused: 'Paused',
  summarizing: 'Summarising…',
  done: 'Done',
  error: 'Error',
};

void init();
