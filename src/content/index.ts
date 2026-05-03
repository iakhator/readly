import { extractContent } from './extractor';
import { TTSReader } from './reader';
import { WordHighlighter } from './highlighter';
import { ReaderOverlay } from './overlay';
import { getSettings, saveSettings } from '../shared/storage';
import { sendToBackground } from '../shared/messages';
import type { ExtractedContent, ReaderState } from '../shared/types';
import type { Message } from '../shared/messages';

let reader: TTSReader | null = null;
let highlighter: WordHighlighter | null = null;
let overlay: ReaderOverlay | null = null;
let currentContent: ExtractedContent | null = null;

function onStateChange(state: ReaderState): void {
  // Attach article metadata so the popup can display it
  const enriched: ReaderState = {
    ...state,
    title: currentContent?.title,
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

async function startReading(): Promise<void> {
  currentContent = extractContent();
  if (!currentContent) {
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
      highlighter.wrap(articleEl);
    }
  }

  reader.load(currentContent.textContent);
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
