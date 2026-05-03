import type { ReaderSettings, ReaderState, ReadingStatus } from '../shared/types';

type StateListener = (state: ReaderState) => void;
type WordListener = (index: number) => void;

export class TTSReader {
  private utterance: SpeechSynthesisUtterance | null = null;
  private words: string[] = [];
  private startWordIndex = 0;
  private settings: ReaderSettings;
  private onStateChange: StateListener;
  private onWordChange: WordListener;

  constructor(settings: ReaderSettings, onStateChange: StateListener, onWordChange: WordListener) {
    this.settings = settings;
    this.onStateChange = onStateChange;
    this.onWordChange = onWordChange;
  }

  load(text: string): void {
    speechSynthesis.cancel();
    this.words = text.split(/\s+/).filter(Boolean);
    this.startWordIndex = 0;
    this.emitState('idle');
  }

  play(): void {
    if (speechSynthesis.paused) {
      speechSynthesis.resume();
      this.emitState('reading');
      return;
    }

    const segment = this.words.slice(this.startWordIndex).join(' ');
    if (!segment) {
      this.emitState('done');
      return;
    }

    this.utterance = new SpeechSynthesisUtterance(segment);
    this.applySettings(this.utterance);

    const capturedStart = this.startWordIndex;

    this.utterance.onboundary = (event) => {
      if (event.name !== 'word') return;
      const textBefore = segment.substring(0, event.charIndex);
      const wordsSoFar = textBefore.split(/\s+/).filter(Boolean).length;
      const absoluteIndex = capturedStart + wordsSoFar;
      this.startWordIndex = absoluteIndex;
      this.onWordChange(absoluteIndex);
      this.emitState('reading');
    };

    this.utterance.onend = () => {
      this.startWordIndex = this.words.length;
      this.emitState('done');
    };

    this.utterance.onerror = (event) => {
      if (event.error === 'interrupted' || event.error === 'canceled') return;
      console.error('[Readly] TTS error:', event.error);
      this.emitState('error');
    };

    speechSynthesis.speak(this.utterance);
    this.emitState('reading');
  }

  pause(): void {
    speechSynthesis.pause();
    this.emitState('paused');
  }

  stop(): void {
    speechSynthesis.cancel();
    this.utterance = null;
    this.startWordIndex = 0;
    this.emitState('idle');
  }

  updateSettings(patch: Partial<ReaderSettings>): void {
    this.settings = { ...this.settings, ...patch };
  }

  private applySettings(utterance: SpeechSynthesisUtterance): void {
    const voices = speechSynthesis.getVoices();
    const match = voices.find((v) => v.name === this.settings.voice) ?? null;
    if (match) utterance.voice = match;
    utterance.rate = this.settings.rate;
    utterance.pitch = this.settings.pitch;
    utterance.volume = this.settings.volume;
  }

  private emitState(status: ReadingStatus): void {
    const total = this.words.length;
    const current = this.startWordIndex;
    const wpm = Math.round(this.settings.rate * 150);
    this.onStateChange({
      status,
      progress: total > 0 ? Math.round((current / total) * 100) : 0,
      currentWordIndex: current,
      totalWords: total,
      wordsPerMinute: wpm,
      estimatedTimeRemaining:
        wpm > 0 ? Math.max(0, Math.round(((total - current) / wpm) * 60)) : 0,
    });
  }
}
