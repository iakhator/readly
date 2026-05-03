import { extractContent } from './extractor';
import { TTSReader } from './reader';
import { WordHighlighter } from './highlighter';
import { ReaderOverlay } from './overlay';
import { getSettings, saveSettings } from '../shared/storage';
import { sendToBackground } from '../shared/messages';
import type { ExtractedContent, ReaderState } from '../shared/types';
import type { Message } from '../shared/messages';

// ── Graceful degradation ──────────────────────────────────────────────────────

if (typeof speechSynthesis === 'undefined') {
  console.warn('[Readly] Web Speech API not available — extension disabled on this page.');
  // Stop executing — no message listener registered
  // eslint-disable-next-line no-throw-literal
  throw new Error('[Readly] speechSynthesis unavailable');
}

// ── State ─────────────────────────────────────────────────────────────────────

let reader: TTSReader | null = null;
let highlighter: WordHighlighter | null = null;
let overlay: ReaderOverlay | null = null;
let currentContent: ExtractedContent | null = null;

// ── Callbacks ─────────────────────────────────────────────────────────────────

function onStateChange(state: ReaderState): void {
  const enriched: ReaderState = {
    ...state,
    title: currentContent?.title,
    byline: currentContent?.byline ?? undefined,
    siteName: currentContent?.siteName ?? undefined,
  };
  overlay?.update(enriched);
  void sendToBackground({ type: 'READER_STATE_UPDATE', payload: enriched });

  if (state.status === 'done') {
    void handleReadingComplete();
  }
}

function onWordChange(index: number): void {
  highlighter?.highlight(index);
}

// ── Reading lifecycle ─────────────────────────────────────────────────────────

async function startReading(): Promise<void> {
  currentContent = extractContent();
  if (!currentContent) {
    console.warn('[Readly] Could not extract readable content from this page.');
    return;
  }
  await beginReading(currentContent.textContent);
}

async function startReadingSelection(text: string): Promise<void> {
  stopReading();
  // Synthesise minimal content metadata for the overlay
  currentContent = {
    title: document.title,
    byline: null,
    textContent: text,
    excerpt: null,
    siteName: null,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    estimatedReadingTime: 0,
    lang: document.documentElement.lang || null,
  };
  await beginReading(text);
}

async function beginReading(text: string): Promise<void> {
  stopReading();

  const settings = await getSettings();

  reader = new TTSReader(settings, onStateChange, onWordChange);
  highlighter = new WordHighlighter();

  overlay = new ReaderOverlay({
    onPlay: () => reader?.play(),
    onPause: () => reader?.pause(),
    onStop: stopReading,
    onSpeedChange: (rate) => {
      reader?.updateSettings({ rate });
      void saveSettings({ rate });
    },
    onClose: stopReading,
  });

  overlay.mount();

  if (settings.highlightEnabled && currentContent) {
    const articleEl =
      document.querySelector<HTMLElement>('article') ??
      document.querySelector<HTMLElement>('main') ??
      document.querySelector<HTMLElement>('[role="main"]');
    if (articleEl) highlighter.wrap(articleEl);
  }

  reader.load(text);
  reader.play();
}

function stopReading(): void {
  reader?.stop();
  highlighter?.destroy();
  overlay?.unmount();
  reader = null;
  highlighter = null;
  overlay = null;
  currentContent = null;
}

async function handleReadingComplete(): Promise<void> {
  const settings = await getSettings();
  if (!settings.autoSummarize || settings.aiProvider === 'none') return;
  if (!currentContent) return;
  void sendToBackground({ type: 'SUMMARIZE', payload: { text: currentContent.textContent } });
}

// ── SPA navigation detection ──────────────────────────────────────────────────

let lastHref = location.href;

function handleNavigation(): void {
  if (location.href !== lastHref) {
    lastHref = location.href;
    if (reader) stopReading();
  }
}

window.addEventListener('popstate', handleNavigation);
window.addEventListener('hashchange', handleNavigation);

// Intercept History API pushes (React Router, Vue Router, etc.)
const _pushState = history.pushState.bind(history);
history.pushState = function (...args: Parameters<typeof history.pushState>) {
  _pushState(...args);
  handleNavigation();
};

const _replaceState = history.replaceState.bind(history);
history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
  _replaceState(...args);
  handleNavigation();
};

// ── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: Message, _sender, sendResponse: (r: { ok: boolean }) => void) => {
    switch (message.type) {
      case 'START_READING':
        void startReading();
        sendResponse({ ok: true });
        break;
      case 'PAUSE_READING':
        reader?.pause();
        sendResponse({ ok: true });
        break;
      case 'RESUME_READING':
        reader?.play();
        sendResponse({ ok: true });
        break;
      case 'STOP_READING':
        stopReading();
        sendResponse({ ok: true });
        break;
      case 'READ_SELECTION':
        void startReadingSelection(message.payload.text);
        sendResponse({ ok: true });
        break;
      case 'SKIP_TO_SUMMARY': {
        const textToSummarize = currentContent?.textContent ?? null;
        stopReading();
        if (textToSummarize) {
          void sendToBackground({ type: 'SUMMARIZE', payload: { text: textToSummarize } });
        }
        sendResponse({ ok: true });
        break;
      }
      case 'SUMMARY_READY': {
        const { text, keyPoints } = message.payload;
        const spoken =
          `Summary: ${text}` +
          (keyPoints.length > 0 ? ` Key points: ${keyPoints.join('. ')}` : '');
        const utterance = new SpeechSynthesisUtterance(spoken);
        utterance.rate = 0.9;
        speechSynthesis.speak(utterance);
        sendResponse({ ok: true });
        break;
      }
      default:
        break;
    }
    return true;
  },
);
