import { extractContent } from './extractor';
import { TTSReader } from './reader';
import { WordHighlighter } from './highlighter';
import { ReaderOverlay } from './overlay';
import { ReadlyFAB } from './fab';
import { getSettings, saveSettings } from '../shared/storage';
import { sendToBackground } from '../shared/messages';
import type { ExtractedContent, ReaderState } from '../shared/types';
import type { Message } from '../shared/messages';

// ── FAB — always-present page button ─────────────────────────────────────────

const fab = new ReadlyFAB(() => {
  const status = fab.getStatus();
  if (status === 'reading') {
    reader?.pause();
  } else if (status === 'paused') {
    reader?.play();
  } else {
    void startReading();
  }
});

fab.mount();

// ── State ─────────────────────────────────────────────────────────────────────

let reader: TTSReader | null = null;
let highlighter: WordHighlighter | null = null;
let overlay: ReaderOverlay | null = null;
let currentContent: ExtractedContent | null = null;

// ── Callbacks ─────────────────────────────────────────────────────────────────

function onStateChange(state: ReaderState): void {
  fab.update(state.status);

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
  if (typeof speechSynthesis === 'undefined') {
    console.warn('[Readly] Web Speech API not available on this page.');
    return;
  }

  // Stop first, THEN extract so stopReading() doesn't wipe freshly-set content
  stopReading();
  currentContent = extractContent();

  if (!currentContent) {
    console.warn('[Readly] Could not extract readable content from this page.');
    void sendToBackground({
      type: 'READER_STATE_UPDATE',
      payload: {
        status: 'error',
        progress: 0,
        currentWordIndex: 0,
        totalWords: 0,
        wordsPerMinute: 0,
        estimatedTimeRemaining: 0,
        summaryError: 'Could not find readable content on this page.',
      },
    });
    return;
  }

  await beginReading(currentContent.textContent);
}

async function startReadingSelection(text: string): Promise<void> {
  if (typeof speechSynthesis === 'undefined') return;

  stopReading();
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

/**
 * Mounts the overlay + reader for the given text.
 * Callers MUST call stopReading() and set currentContent before invoking.
 */
async function beginReading(text: string): Promise<void> {
  const settings = await getSettings();

  reader    = new TTSReader(settings, onStateChange, onWordChange);
  highlighter = new WordHighlighter();

  overlay = new ReaderOverlay({
    onPlay:  () => reader?.play(),
    onPause: () => reader?.pause(),
    onStop:  stopReading,
    onSpeedChange: (rate) => {
      reader?.updateSettings({ rate });
      void saveSettings({ rate });
    },
    onClose: stopReading,
  });

  overlay.mount();

  // Use the highlighter's word list as TTS source so indices stay aligned.
  // The highlighter wraps the raw DOM; its span order matches charIndex math.
  let textToRead = text;
  if (settings.highlightEnabled && currentContent) {
    const articleEl =
      document.querySelector<HTMLElement>('article') ??
      document.querySelector<HTMLElement>('main') ??
      document.querySelector<HTMLElement>('[role="main"]');
    if (articleEl) {
      const wrappedText = highlighter.wrap(articleEl);
      if (wrappedText.trim()) textToRead = wrappedText;
    }
  }

  reader.load(textToRead);
  reader.play();
}

function stopReading(): void {
  reader?.stop();
  // Always cancel even when no reader exists — clears any paused/stale state
  // so the next speechSynthesis.speak() starts from a clean slate.
  speechSynthesis.cancel();
  highlighter?.destroy();
  overlay?.unmount();
  reader      = null;
  highlighter = null;
  overlay     = null;
  currentContent = null;
  fab.update('idle');
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
