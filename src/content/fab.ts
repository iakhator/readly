import type { ReadingStatus } from '../shared/types';

const FAB_ID = 'readly-fab';

export class ReadlyFAB {
  private el: HTMLButtonElement | null = null;
  private status: ReadingStatus = 'idle';
  private readonly onClickHandler: () => void;

  constructor(onClick: () => void) {
    this.onClickHandler = onClick;
  }

  mount(): void {
    if (document.getElementById(FAB_ID)) return;

    this.el = document.createElement('button');
    this.el.id = FAB_ID;
    this.el.setAttribute('aria-label', 'Read page with Readly');
    this.el.textContent = '▶';
    this.el.addEventListener('click', () => {
      // Unlock speech synthesis synchronously within the user gesture.
      // Chrome blocks speechSynthesis.speak() until a page interaction has
      // occurred; calling cancel() here satisfies that requirement before the
      // async reading chain begins.
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
      this.onClickHandler();
    });
    document.body.appendChild(this.el);
  }

  update(status: ReadingStatus): void {
    this.status = status;
    if (!this.el) return;

    this.el.dataset.status = status;

    if (status === 'reading') {
      this.el.textContent = '⏸';
      this.el.setAttribute('aria-label', 'Pause Readly');
    } else if (status === 'paused') {
      this.el.textContent = '▶';
      this.el.setAttribute('aria-label', 'Resume Readly');
    } else {
      this.el.textContent = '▶';
      this.el.setAttribute('aria-label', 'Read page with Readly');
    }
  }

  getStatus(): ReadingStatus {
    return this.status;
  }
}
