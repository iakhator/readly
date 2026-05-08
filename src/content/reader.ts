import type { ReaderSettings, ReaderState, ReadingStatus } from '../shared/types';
import { selectBestVoice } from '../shared/voices';

/** Max words per TTS utterance — keeps Chrome's 15-second stall bug at bay */
const CHUNK_WORD_LIMIT = 150;
/** Watchdog poll interval (ms) */
const WATCHDOG_MS = 500;
/** Consecutive ticks with no word-boundary event before we assume a stall */
const STALL_TICKS = 8; // ~4 seconds

type StateListener = (state: ReaderState) => void;
type WordListener = (index: number) => void;

export class TTSReader {
  // ── Text state ──────────────────────────────────────────────────────────────
  private words: string[] = [];       // all words in the full text
  private chunks: string[] = [];      // text split into utterance-sized segments
  private chunkOffsets: number[] = []; // absolute word index at start of each chunk

  // ── Playback cursor ─────────────────────────────────────────────────────────
  private chunkIdx = 0;
  private absoluteWordIdx = 0;

  // ── Runtime ─────────────────────────────────────────────────────────────────
  private status: ReadingStatus = 'idle';
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private hadBoundaryEvent = false; // guard against voices that fire no boundary events

  private settings: ReaderSettings;
  private onStateChange: StateListener;
  private onWordChange: WordListener;

  constructor(
    settings: ReaderSettings,
    onStateChange: StateListener,
    onWordChange: WordListener,
  ) {
    this.settings = settings;
    this.onStateChange = onStateChange;
    this.onWordChange = onWordChange;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  load(text: string): void {
    this.hardStop();
    this.words = text.split(/\s+/).filter(Boolean);
    this.chunks = splitIntoChunks(text, CHUNK_WORD_LIMIT);
    this.chunkOffsets = computeOffsets(this.chunks);
    this.chunkIdx = 0;
    this.absoluteWordIdx = 0;
    this.emitState('idle');
  }

  play(): void {
    if (this.status === 'paused' && speechSynthesis.paused) {
      speechSynthesis.resume();
      this.status = 'reading';
      this.emitState('reading');
      return;
    }
    if (this.chunks.length === 0 || this.chunkIdx >= this.chunks.length) {
      this.emitState('done');
      return;
    }
    void this.speakChunk();
  }

  pause(): void {
    this.stopWatchdog();
    speechSynthesis.pause();
    this.status = 'paused';
    this.emitState('paused');
  }

  stop(): void {
    this.hardStop();
    this.words = [];
    this.chunks = [];
    this.chunkOffsets = [];
    this.emitState('idle');
  }

  /** Called when the user moves the speed slider — takes effect on the next chunk boundary. */
  updateSettings(patch: Partial<ReaderSettings>): void {
    const wasReading = this.status === 'reading';
    this.settings = { ...this.settings, ...patch };

    if (wasReading && 'rate' in patch) {
      // Restart current chunk at new rate for immediate feedback
      this.stopWatchdog();
      speechSynthesis.cancel(); // fires onerror 'interrupted', which we ignore
      void this.speakChunk();
    }
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private async speakChunk(): Promise<void> {
    if (this.chunkIdx >= this.chunks.length) {
      this.status = 'done';
      this.absoluteWordIdx = this.words.length;
      this.emitState('done');
      return;
    }

    const chunkText = this.chunks[this.chunkIdx];
    const wordOffset = this.chunkOffsets[this.chunkIdx];

    const utterance = new SpeechSynthesisUtterance(chunkText);
    this.hadBoundaryEvent = false;
    await applyVoice(utterance, this.settings);

    utterance.onboundary = (event) => {
      if (event.name !== 'word') return;
      const textBefore = chunkText.substring(0, event.charIndex);
      const wordsSpoken = textBefore.split(/\s+/).filter(Boolean).length;
      const absIdx = wordOffset + wordsSpoken;
      this.hadBoundaryEvent = true;
      if (absIdx !== this.absoluteWordIdx) {
        this.absoluteWordIdx = absIdx;
        this.onWordChange(absIdx);
        this.emitState('reading');
      }
    };

    utterance.onend = () => {
      if (this.status !== 'reading') return; // paused or stopped mid-chunk
      this.stopWatchdog();
      this.advanceChunk();
    };

    utterance.onerror = (event) => {
      // 'interrupted' / 'canceled' fire when we call speechSynthesis.cancel()
      // intentionally (stop, speed change, watchdog restart) — safe to ignore.
      if (event.error === 'interrupted' || event.error === 'canceled') return;
      // 'not-allowed' means the browser blocked audio before a page gesture.
      // The FAB click normally unlocks this; if it still fires, the user
      // started reading via the popup on a page they hadn't interacted with.
      if (event.error === 'not-allowed') {
        console.warn('[Readly] Audio blocked — click the ▶ button on the page to start reading.');
        this.stopWatchdog();
        this.status = 'error';
        this.emitState('error', 'Audio blocked. Click the ▶ button directly on the page to start.');
        return;
      }
      console.error('[Readly] TTS error:', event.error);
      this.stopWatchdog();
      this.status = 'error';
      this.emitState('error');
    };

    speechSynthesis.speak(utterance);
    this.status = 'reading';
    this.emitState('reading');
    this.startWatchdog(wordOffset);
  }

  private advanceChunk(): void {
    this.chunkIdx++;
    if (this.chunkIdx < this.chunks.length) {
      this.absoluteWordIdx = this.chunkOffsets[this.chunkIdx];
      void this.speakChunk();
    } else {
      this.absoluteWordIdx = this.words.length;
      this.status = 'done';
      this.emitState('done');
    }
  }

  private startWatchdog(wordOffset: number): void {
    let lastWord = this.absoluteWordIdx;
    let stallTicks = 0;

    this.watchdog = setInterval(() => {
      if (this.status !== 'reading' || speechSynthesis.paused) return;

      // Chrome sometimes stops speaking without firing onend
      if (!speechSynthesis.speaking) {
        this.stopWatchdog();
        this.advanceChunk();
        return;
      }

      if (this.absoluteWordIdx !== lastWord) {
        lastWord = this.absoluteWordIdx;
        stallTicks = 0;
      } else if (this.hadBoundaryEvent) {
        // Only count stalls if this voice fires boundary events at all
        stallTicks++;
        if (stallTicks >= STALL_TICKS) {
          console.warn('[Readly] TTS stall detected — restarting chunk from word', wordOffset);
          this.stopWatchdog();
          speechSynthesis.cancel();
          void this.speakChunk();
        }
      }
    }, WATCHDOG_MS);
  }

  private stopWatchdog(): void {
    if (this.watchdog !== null) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
  }

  private hardStop(): void {
    this.stopWatchdog();
    speechSynthesis.cancel();
    this.chunkIdx = 0;
    this.absoluteWordIdx = 0;
    this.status = 'idle';
    this.hadBoundaryEvent = false;
  }

  private emitState(status: ReadingStatus, errorMessage?: string): void {
    const total = this.words.length;
    const current = this.absoluteWordIdx;
    const wpm = Math.round(this.settings.rate * 150);
    this.onStateChange({
      status,
      progress: total > 0 ? Math.round((current / total) * 100) : 0,
      currentWordIndex: current,
      totalWords: total,
      wordsPerMinute: wpm,
      estimatedTimeRemaining:
        wpm > 0 ? Math.max(0, Math.round(((total - current) / wpm) * 60)) : 0,
      ...(errorMessage ? { summaryError: errorMessage } : {}),
    });
  }
}

// ── Module-level helpers ──────────────────────────────────────────────────────

/**
 * Splits text into utterance-sized chunks at sentence boundaries.
 * Keeps each chunk under `wordLimit` words so Chrome's TTS engine
 * doesn't stall on long utterances.
 */
function splitIntoChunks(text: string, wordLimit: number): string[] {
  // Match sentence-ending tokens and keep the delimiter attached
  const sentences = text.match(/[^.!?…]+[.!?…]+\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = '';
  let count = 0;

  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/).filter(Boolean).length;
    if (count + words > wordLimit && current.trim()) {
      chunks.push(current.trim());
      current = sentence;
      count = words;
    } else {
      current += sentence;
      count += words;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text];
}

/** Returns the cumulative word-index offset at the start of each chunk. */
function computeOffsets(chunks: string[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const chunk of chunks) {
    offsets.push(offset);
    offset += chunk.split(/\s+/).filter(Boolean).length;
  }
  return offsets;
}

/**
 * Returns the available voices, waiting for the async `voiceschanged`
 * event if the list is empty on first call (common in Chrome).
 */
async function getVoices(): Promise<SpeechSynthesisVoice[]> {
  const immediate = speechSynthesis.getVoices();
  if (immediate.length > 0) return immediate;

  return new Promise((resolve) => {
    const onChanged = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener('voiceschanged', onChanged, { once: true });
    // Safety net: resolve after 3 s if the event never fires
    setTimeout(() => {
      speechSynthesis.removeEventListener('voiceschanged', onChanged);
      resolve(speechSynthesis.getVoices());
    }, 3000);
  });
}

async function applyVoice(
  utterance: SpeechSynthesisUtterance,
  settings: ReaderSettings,
): Promise<void> {
  const voices = await getVoices();
  const voice = selectBestVoice(voices, settings.voice);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }
  utterance.rate = settings.rate;
  utterance.pitch = settings.pitch;
  utterance.volume = settings.volume;
}

