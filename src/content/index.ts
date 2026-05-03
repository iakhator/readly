import { extractContent } from './extractor';
import { TTSReader } from './reader';
import { WordHighlighter } from './highlighter';
import { ReaderOverlay } from './overlay';
import { getSettings, saveSettings } from '../shared/storage';
import { sendToBackground } from '../shared/messages';
import type { Message, ReaderState } from '../shared/types';

let reader: TTSReader | null = null;
let highlighter: WordHighlighter | null = null;
let overlay: ReaderOverlay | null = null;

function onStateChange(state: ReaderState): void {
  overlay?.update(state);
  void sendToBackground({ type: 'READER_STATE_UPDATE', payload: state });

  if (state.status === 'done') {
    void handleReadingComplete();
  }
}

function onWordChange(index: number): void {
  highlighter?.highlight(index);
}

async function startReading(): Promise<void> {
  const content = extractContent();
  if (!content) {
    console.warn('[Readly] Could not extract readable content from this page.');
    return;
  }

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

  if (settings.highlightEnabled) {
    const articleEl =
      document.querySelector<HTMLElement>('article') ??
      document.querySelector<HTMLElement>('main') ??
      document.querySelector<HTMLElement>('[role="main"]');
    if (articleEl) {
      highlighter.wrap(articleEl, content.textContent);
    }
  }

  reader.load(content.textContent);
  reader.play();
}

function stopReading(): void {
  reader?.stop();
  highlighter?.destroy();
  overlay?.unmount();
  reader = null;
  highlighter = null;
  overlay = null;
}

async function handleReadingComplete(): Promise<void> {
  const settings = await getSettings();
  if (!settings.autoSummarize || settings.aiProvider === 'none') return;

  const content = extractContent();
  if (!content) return;

  void sendToBackground({ type: 'SUMMARIZE', payload: { text: content.textContent } });
}

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
