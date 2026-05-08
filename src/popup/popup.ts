import { sendToBackground } from '../shared/messages';
import { DEFAULT_SETTINGS, tabStateKey } from '../shared/storage';
import { STATUS_LABELS } from '../shared/strings';
import { selectBestVoice, sortVoices } from '../shared/voices';
import type { ReaderState, ReaderSettings } from '../shared/types';

// ── DOM refs ─────────────────────────────────────────────────────────────────

const $emptyState       = el('empty-state');
const $articleDetails   = el('article-details');
const $articleTitle     = el('article-title');
const $articleSite      = el('article-site');
const $articleByline    = el('article-byline');
const $statusDot        = el('status-dot');
const $statusLabel      = el('status-label');
const $statusEta        = el('status-eta');
const $progressFill     = el('progress-fill');
const $wordsRead        = el('words-read');
const $progressPct      = el('progress-pct');
const $btnPlayPause     = el<HTMLButtonElement>('btn-play-pause');
const $btnStop          = el<HTMLButtonElement>('btn-stop');
const $btnSkip          = el<HTMLButtonElement>('btn-skip');
const $btnSettings      = el<HTMLButtonElement>('btn-settings');
const $settingsPanel    = el('settings-panel');
const $speedSlider      = el<HTMLInputElement>('speed-slider');
const $speedValue       = el('speed-value');
const $voiceSelect      = el<HTMLSelectElement>('voice-select');
const $btnVoicePreview  = el<HTMLButtonElement>('btn-voice-preview');
const $pitchSlider      = el<HTMLInputElement>('pitch-slider');
const $pitchValue       = el('pitch-value');
const $volumeSlider     = el<HTMLInputElement>('volume-slider');
const $volumeValue      = el('volume-value');
const $aiProvider       = el<HTMLSelectElement>('ai-provider');
const $apiKeyInput      = el<HTMLInputElement>('api-key-input');
const $apiKeyRow        = el('api-key-row');
const $apiKeyStatus     = el('api-key-status');
const $btnTestApi       = el<HTMLButtonElement>('btn-test-api');
const $autoSummarize    = el<HTMLInputElement>('auto-summarize');
const $highlightEnabled = el<HTMLInputElement>('highlight-enabled');
const $summaryError     = el('summary-error');
const $btnResetDefaults = el<HTMLButtonElement>('btn-reset-defaults');

let currentState: ReaderState | null = null;
let currentTabId: number | undefined;
let isPlaying = false;
let currentSettings: ReaderSettings = { ...DEFAULT_SETTINGS };

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

    if (state.summaryError) {
      $summaryError.textContent = `⚠ ${state.summaryError}`;
      $summaryError.hidden = false;
    } else {
      $summaryError.hidden = true;
    }

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
    $summaryError.hidden = true;
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

  currentSettings = settings;

  $speedSlider.value = String(settings.rate);
  $speedValue.textContent = `${settings.rate.toFixed(1)}×`;
  if (settings.voice) $voiceSelect.value = settings.voice;
  $pitchSlider.value = String(settings.pitch);
  $pitchValue.textContent = settings.pitch.toFixed(1);
  $volumeSlider.value = String(settings.volume);
  $volumeValue.textContent = `${Math.round(settings.volume * 100)}%`;
  $aiProvider.value = settings.aiProvider;
  $apiKeyInput.value = settings.aiApiKey;
  $autoSummarize.checked = settings.autoSummarize;
  $highlightEnabled.checked = settings.highlightEnabled;
  $apiKeyRow.hidden = settings.aiProvider === 'none';
}

function patchSettings(patch: Partial<ReaderSettings>): void {
  currentSettings = { ...currentSettings, ...patch };
  void sendToBackground({ type: 'CMD_UPDATE_SETTINGS', payload: patch });
}

// ── Voices ────────────────────────────────────────────────────────────────────

function populateVoices(): void {
  const fill = () => {
    const raw = speechSynthesis.getVoices();
    if (!raw.length) return;
    const sorted = sortVoices(raw);
    const autoLabel = selectBestVoice(sorted, '')?.name ?? 'system default';
    $voiceSelect.innerHTML =
      `<option value="">Auto — ${autoLabel}</option>` +
      sorted
        .map((v) => {
          const quality = v.localService ? ' ★' : '';
          return `<option value="${v.name}">${v.name}${quality} (${v.lang})</option>`;
        })
        .join('');
    $voiceSelect.value = currentSettings.voice ?? '';
  };
  fill();
  speechSynthesis.addEventListener('voiceschanged', fill, { once: true });
}

// ── Voice / audio preview ─────────────────────────────────────────────────────

let previewTimer: ReturnType<typeof setTimeout> | null = null;

function speakPreview(immediate = false): void {
  if (previewTimer) clearTimeout(previewTimer);
  const run = () => {
    speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance('The quick brown fox jumps over the lazy dog.');
    const voices = speechSynthesis.getVoices();
    const v = selectBestVoice(voices, currentSettings.voice);
    if (v) { utt.voice = v; utt.lang = v.lang; }
    utt.rate   = currentSettings.rate;
    utt.pitch  = currentSettings.pitch;
    utt.volume = currentSettings.volume;
    speechSynthesis.speak(utt);
  };
  if (immediate) run();
  else previewTimer = setTimeout(run, 350);
}

// ── API key test ──────────────────────────────────────────────────────────────

async function testApiKey(): Promise<void> {
  const provider = currentSettings.aiProvider;
  const key = $apiKeyInput.value.trim();

  if (provider === 'none' || !key) {
    showApiStatus('Enter an API key first.', false);
    return;
  }

  $btnTestApi.disabled = true;
  $btnTestApi.textContent = '…';
  $apiKeyStatus.hidden = true;

  try {
    if (provider === 'claude') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } else {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(String(res.status));
    }
    showApiStatus('✓ Key is valid', true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showApiStatus(
      msg.includes('401') || msg.includes('403') ? '✕ Invalid key' : `✕ Error ${msg}`,
      false,
    );
  } finally {
    $btnTestApi.disabled = false;
    $btnTestApi.textContent = 'Test';
  }
}

function showApiStatus(text: string, ok: boolean): void {
  $apiKeyStatus.textContent = text;
  $apiKeyStatus.className = `api-key-status ${ok ? 'ok' : 'fail'}`;
  $apiKeyStatus.hidden = false;
}

// ── Event listeners ───────────────────────────────────────────────────────────

$btnPlayPause.addEventListener('click', () => {
  console.log('Play/pause clicked. Current status:', currentState?.status);
  if (isPlaying) {
    void sendToBackground({ type: 'CMD_PAUSE' });
  } else if (currentState?.status === 'paused') {
    void sendToBackground({ type: 'CMD_RESUME' });
  } else {
    void sendToBackground({ type: 'CMD_START' });
  }
});

$btnStop.addEventListener('click', () => void sendToBackground({ type: 'CMD_STOP' }));
$btnSkip.addEventListener('click', () => void sendToBackground({ type: 'CMD_SKIP' }));

$btnSettings.addEventListener('click', () => {
  $settingsPanel.classList.toggle('open');
});

$speedSlider.addEventListener('input', () => {
  const rate = parseFloat($speedSlider.value);
  $speedValue.textContent = `${rate.toFixed(1)}×`;
  patchSettings({ rate });
});

$pitchSlider.addEventListener('input', () => {
  const pitch = parseFloat($pitchSlider.value);
  $pitchValue.textContent = pitch.toFixed(1);
  patchSettings({ pitch });
  speakPreview();
});

$volumeSlider.addEventListener('input', () => {
  const volume = parseFloat($volumeSlider.value);
  $volumeValue.textContent = `${Math.round(volume * 100)}%`;
  patchSettings({ volume });
  speakPreview();
});

$voiceSelect.addEventListener('change', () => {
  patchSettings({ voice: $voiceSelect.value });
});

$btnVoicePreview.addEventListener('click', () => speakPreview(true));

$aiProvider.addEventListener('change', () => {
  const aiProvider = $aiProvider.value as ReaderSettings['aiProvider'];
  $apiKeyRow.hidden = aiProvider === 'none';
  $apiKeyStatus.hidden = true;
  patchSettings({ aiProvider });
});

$apiKeyInput.addEventListener('change', () => {
  $apiKeyStatus.hidden = true;
  patchSettings({ aiApiKey: $apiKeyInput.value.trim() });
});

$btnTestApi.addEventListener('click', () => void testApiKey());

$autoSummarize.addEventListener('change', () => {
  patchSettings({ autoSummarize: $autoSummarize.checked });
});

$highlightEnabled.addEventListener('change', () => {
  patchSettings({ highlightEnabled: $highlightEnabled.checked });
});

$btnResetDefaults.addEventListener('click', () => {
  void sendToBackground({ type: 'CMD_UPDATE_SETTINGS', payload: DEFAULT_SETTINGS })
    .then(() => loadSettings());
});

// ── Utils ─────────────────────────────────────────────────────────────────────

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}


void init();
