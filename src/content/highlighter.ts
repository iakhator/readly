const WORD_CLASS = 'readly-word';
const ACTIVE_CLASS = 'readly-word--active';

export class WordHighlighter {
  private container: HTMLElement | null = null;
  private spans: HTMLSpanElement[] = [];
  private originalHTML = '';
  private activeIndex = -1;

  wrap(container: HTMLElement, text: string): void {
    this.container = container;
    this.originalHTML = container.innerHTML;
    this.spans = [];

    const parts = text.split(/(\s+)/);
    const html = parts
      .map((part) => {
        if (/^\s+$/.test(part)) return part;
        const escaped = part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<span class="${WORD_CLASS}">${escaped}</span>`;
      })
      .join('');

    container.innerHTML = html;
    this.spans = Array.from(container.querySelectorAll<HTMLSpanElement>(`.${WORD_CLASS}`));
  }

  highlight(index: number): void {
    if (this.activeIndex >= 0) {
      this.spans[this.activeIndex]?.classList.remove(ACTIVE_CLASS);
    }
    this.activeIndex = index;
    const span = this.spans[index];
    if (span) {
      span.classList.add(ACTIVE_CLASS);
      span.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  clear(): void {
    this.spans[this.activeIndex]?.classList.remove(ACTIVE_CLASS);
    this.activeIndex = -1;
  }

  destroy(): void {
    if (this.container) {
      this.container.innerHTML = this.originalHTML;
    }
    this.spans = [];
    this.activeIndex = -1;
    this.container = null;
  }
}
