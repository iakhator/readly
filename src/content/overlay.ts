import type { ReaderState } from '../shared/types';

const OVERLAY_ID = 'readly-overlay';

interface OverlayCallbacks {
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSpeedChange: (rate: number) => void;
  onClose: () => void;
}

export class ReaderOverlay {
  private el: HTMLDivElement | null = null;
  private callbacks: OverlayCallbacks;

  constructor(callbacks: OverlayCallbacks) {
    this.callbacks = callbacks;
  }

  mount(): void {
    if (document.getElementById(OVERLAY_ID)) return;

    this.el = document.createElement('div');
    this.el.id = OVERLAY_ID;
    this.el.setAttribute('role', 'toolbar');
    this.el.setAttribute('aria-label', 'Readly controls');
    this.el.innerHTML = this.template();
    document.body.appendChild(this.el);
    this.bindEvents();
  }

  unmount(): void {
    this.el?.remove();
    this.el = null;
  }

  update(state: ReaderState): void {
    if (!this.el) return;

    const playBtn = this.el.querySelector<HTMLButtonElement>('.readly-btn-play');
    const pauseBtn = this.el.querySelector<HTMLButtonElement>('.readly-btn-pause');
    const progressFill = this.el.querySelector<HTMLElement>('.readly-progress-fill');
    const statusEl = this.el.querySelector<HTMLElement>('.readly-status');
    const etaEl = this.el.querySelector<HTMLElement>('.readly-eta');
    const wordCountEl = this.el.querySelector<HTMLElement>('.readly-wordcount');

    const isReading = state.status === 'reading';
    const isPausedOrIdle = state.status === 'paused' || state.status === 'idle';

    if (playBtn) playBtn.hidden = !isPausedOrIdle;
    if (pauseBtn) pauseBtn.hidden = !isReading;
    if (progressFill) progressFill.style.width = `${state.progress}%`;
    if (statusEl) statusEl.textContent = STATUS_LABELS[state.status] ?? state.status;

    if (etaEl && state.estimatedTimeRemaining > 0) {
      const m = Math.floor(state.estimatedTimeRemaining / 60);
      const s = state.estimatedTimeRemaining % 60;
      etaEl.textContent = m > 0 ? `${m}m ${s}s left` : `${s}s left`;
    } else if (etaEl) {
      etaEl.textContent = '';
    }

    if (wordCountEl && state.totalWords > 0) {
      wordCountEl.textContent = `${state.currentWordIndex} / ${state.totalWords} words`;
    }
  }

  private template(): string {
    return `
      <div class="readly-header">
        <span class="readly-logo" aria-hidden="true">▶</span>
        <span class="readly-title">Readly</span>
        <span class="readly-status">Ready</span>
        <span class="readly-eta"></span>
        <button class="readly-btn readly-btn-close" aria-label="Close Readly">✕</button>
      </div>
      <div class="readly-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div class="readly-progress-fill"></div>
      </div>
      <div class="readly-controls">
        <button class="readly-btn readly-btn-play" aria-label="Play">▶</button>
        <button class="readly-btn readly-btn-pause" aria-label="Pause" hidden>⏸</button>
        <button class="readly-btn readly-btn-stop" aria-label="Stop">⏹</button>
        <div class="readly-speed-control">
          <span class="readly-speed-label">0.5×</span>
          <input
            class="readly-speed-slider"
            type="range"
            min="0.5"
            max="2.5"
            step="0.1"
            value="1.0"
            aria-label="Reading speed"
          />
          <span class="readly-speed-label">2.5×</span>
          <span class="readly-speed-value">1.0×</span>
        </div>
      </div>
      <div class="readly-wordcount"></div>
    `;
  }

  private bindEvents(): void {
    if (!this.el) return;

    this.el.querySelector('.readly-btn-play')?.addEventListener('click', this.callbacks.onPlay);
    this.el.querySelector('.readly-btn-pause')?.addEventListener('click', this.callbacks.onPause);
    this.el.querySelector('.readly-btn-stop')?.addEventListener('click', this.callbacks.onStop);
    this.el.querySelector('.readly-btn-close')?.addEventListener('click', this.callbacks.onClose);

    const slider = this.el.querySelector<HTMLInputElement>('.readly-speed-slider');
    const speedVal = this.el.querySelector<HTMLElement>('.readly-speed-value');
    slider?.addEventListener('input', () => {
      const rate = parseFloat(slider.value);
      if (speedVal) speedVal.textContent = `${rate.toFixed(1)}×`;
      this.callbacks.onSpeedChange(rate);
    });
  }
}

const STATUS_LABELS: Record<string, string> = {
  idle: 'Ready',
  loading: 'Loading…',
  reading: 'Reading',
  paused: 'Paused',
  summarizing: 'Summarising…',
  done: 'Done',
  error: 'Error',
};
