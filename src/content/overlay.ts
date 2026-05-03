import type { ReaderState } from '../shared/types';
import { OVERLAY_STATUS_LABELS as STATUS_LABELS } from '../shared/strings';

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
  private isDragged = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private isPlaying = false;

  constructor(callbacks: OverlayCallbacks) {
    this.callbacks = callbacks;
  }

  mount(): void {
    if (document.getElementById(OVERLAY_ID)) return;

    this.el = document.createElement('div');
    this.el.id = OVERLAY_ID;
    this.el.setAttribute('role', 'toolbar');
    this.el.setAttribute('aria-label', 'Readly reader controls');
    this.el.setAttribute('tabindex', '-1');
    this.el.innerHTML = this.template();
    document.body.appendChild(this.el);
    this.bindEvents();
    // Focus the play button so keyboard nav works immediately
    this.el.querySelector<HTMLButtonElement>('.readly-btn-play')?.focus();
  }

  unmount(): void {
    if (!this.el) return;
    const el = this.el;
    this.el = null; // stop update() from touching a removing element

    el.classList.add(this.isDragged ? 'readly-overlay--hiding-dragged' : 'readly-overlay--hiding');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    // Safety net: remove even if animationend never fires (e.g. reduced-motion)
    setTimeout(() => el.remove(), 400);
  }

  update(state: ReaderState): void {
    if (!this.el) return;

    const el = this.el;
    const playBtn = el.querySelector<HTMLButtonElement>('.readly-btn-play');
    const pauseBtn = el.querySelector<HTMLButtonElement>('.readly-btn-pause');
    const progressBar = el.querySelector<HTMLElement>('.readly-progress');
    const progressFill = el.querySelector<HTMLElement>('.readly-progress-fill');
    const progressPct = el.querySelector<HTMLElement>('.readly-progress-pct');
    const statusEl = el.querySelector<HTMLElement>('.readly-status');
    const etaEl = el.querySelector<HTMLElement>('.readly-eta');
    const wordCountEl = el.querySelector<HTMLElement>('.readly-wordcount');
    const articleTitleEl = el.querySelector<HTMLElement>('.readly-article-title');

    const isReading = state.status === 'reading';
    this.isPlaying = isReading;
    const isPausedOrIdle = state.status === 'paused' || state.status === 'idle';

    if (playBtn) {
      playBtn.hidden = !isPausedOrIdle;
      playBtn.setAttribute('aria-label', state.status === 'paused' ? 'Resume' : 'Play');
    }
    if (pauseBtn) pauseBtn.hidden = !isReading;

    if (progressBar) progressBar.setAttribute('aria-valuenow', String(state.progress));
    if (progressFill) progressFill.style.width = `${state.progress}%`;
    if (progressPct) progressPct.textContent = `${state.progress}%`;
    if (statusEl) statusEl.textContent = STATUS_LABELS[state.status] ?? state.status;

    if (articleTitleEl && state.title) {
      articleTitleEl.textContent = state.title;
      articleTitleEl.hidden = false;
    }

    if (etaEl) {
      if (state.estimatedTimeRemaining > 0) {
        const m = Math.floor(state.estimatedTimeRemaining / 60);
        const s = state.estimatedTimeRemaining % 60;
        etaEl.textContent = m > 0 ? `${m}m ${s}s left` : `${s}s left`;
      } else {
        etaEl.textContent = '';
      }
    }

    if (wordCountEl && state.totalWords > 0) {
      wordCountEl.textContent = `${state.currentWordIndex} / ${state.totalWords} words`;
    }
  }

  private template(): string {
    return `
      <div class="readly-header">
        <span class="readly-drag-handle" aria-hidden="true">⠿</span>
        <span class="readly-logo" aria-hidden="true">▶</span>
        <div class="readly-title-group">
          <span class="readly-brand">Readly</span>
          <span class="readly-article-title" hidden></span>
        </div>
        <span class="readly-status" aria-live="polite" aria-atomic="true">Ready</span>
        <span class="readly-eta" aria-live="polite"></span>
        <button class="readly-btn readly-btn-close" aria-label="Close Readly">✕</button>
      </div>
      <div class="readly-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Reading progress">
        <div class="readly-progress-fill"></div>
        <span class="readly-progress-pct" aria-hidden="true">0%</span>
      </div>
      <div class="readly-controls">
        <button class="readly-btn readly-btn-play" aria-label="Play">▶</button>
        <button class="readly-btn readly-btn-pause" aria-label="Pause" hidden>⏸</button>
        <button class="readly-btn readly-btn-stop" aria-label="Stop">⏹</button>
        <div class="readly-speed-control">
          <span class="readly-speed-label" aria-hidden="true">0.5×</span>
          <input
            class="readly-speed-slider"
            type="range"
            min="0.5"
            max="2.5"
            step="0.1"
            value="1.0"
            aria-label="Reading speed, current 1.0x"
          />
          <span class="readly-speed-label" aria-hidden="true">2.5×</span>
          <span class="readly-speed-value" aria-live="polite">1.0×</span>
        </div>
      </div>
      <div class="readly-wordcount" aria-live="polite"></div>
    `;
  }

  private bindEvents(): void {
    if (!this.el) return;
    const el = this.el;

    el.querySelector('.readly-btn-play')?.addEventListener('click', this.callbacks.onPlay);
    el.querySelector('.readly-btn-pause')?.addEventListener('click', this.callbacks.onPause);
    el.querySelector('.readly-btn-stop')?.addEventListener('click', this.callbacks.onStop);
    el.querySelector('.readly-btn-close')?.addEventListener('click', this.callbacks.onClose);

    const slider = el.querySelector<HTMLInputElement>('.readly-speed-slider');
    const speedVal = el.querySelector<HTMLElement>('.readly-speed-value');
    slider?.addEventListener('input', () => {
      const rate = parseFloat(slider.value);
      if (speedVal) speedVal.textContent = `${rate.toFixed(1)}×`;
      slider.setAttribute('aria-label', `Reading speed, current ${rate.toFixed(1)}x`);
      this.callbacks.onSpeedChange(rate);
    });

    el.querySelector<HTMLElement>('.readly-header')
      ?.addEventListener('mousedown', (e) => this.onDragStart(e));

    el.addEventListener('keydown', (e) => this.onKeydown(e));
  }

  // ── Drag to reposition ────────────────────────────────────────────────────

  private onDragStart(e: MouseEvent): void {
    if (!this.el) return;
    if ((e.target as Element).closest('button')) return; // let button clicks through

    const rect = this.el.getBoundingClientRect();

    if (!this.isDragged) {
      // Switch from CSS-centered to JS-positioned so drag works absolutely
      this.el.style.transform = 'none';
      this.el.style.left = `${rect.left}px`;
      this.el.style.top = `${rect.top}px`;
      this.el.style.bottom = 'auto';
      this.isDragged = true;
    }

    this.dragOffsetX = e.clientX - rect.left;
    this.dragOffsetY = e.clientY - rect.top;
    this.el.style.cursor = 'grabbing';

    const onMove = (ev: MouseEvent) => {
      if (!this.el) return;
      const maxX = window.innerWidth - this.el.offsetWidth;
      const maxY = window.innerHeight - this.el.offsetHeight;
      const x = Math.max(0, Math.min(ev.clientX - this.dragOffsetX, maxX));
      const y = Math.max(0, Math.min(ev.clientY - this.dragOffsetY, maxY));
      this.el.style.left = `${x}px`;
      this.el.style.top = `${y}px`;
    };

    const onUp = () => {
      if (this.el) this.el.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  }

  // ── Keyboard navigation ───────────────────────────────────────────────────

  private onKeydown(e: KeyboardEvent): void {
    // Don't intercept keys when typing in the speed slider
    if (e.target instanceof HTMLInputElement && e.key !== 'Escape') return;

    switch (e.key) {
      case 'Escape':
        e.stopPropagation();
        this.callbacks.onClose();
        break;
      case ' ':
        e.preventDefault();
        if (this.isPlaying) this.callbacks.onPause();
        else this.callbacks.onPlay();
        break;
      case 's':
      case 'S':
        this.callbacks.onStop();
        break;
      case 'Tab':
        this.trapFocus(e);
        break;
    }
  }

  private trapFocus(e: KeyboardEvent): void {
    if (!this.el) return;
    const focusable = Array.from(
      this.el.querySelectorAll<HTMLElement>('button:not([hidden]), input, [tabindex]:not([tabindex="-1"])')
    );
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

