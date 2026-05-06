const WORD_CLASS  = 'readly-word';
const ACTIVE_CLASS = 'readly-word--active';
const PAUSE_CLASS  = 'readly-pause'; // hidden pause-token spans

/**
 * Tags we skip entirely — their text is irrelevant to the article body.
 */
const SKIP_TAGS = new Set([
  'script', 'style', 'noscript',
  'svg', 'canvas', 'video', 'audio',
  'input', 'textarea', 'select', 'button',
  'code', 'pre',
  'table',
  'aside', 'nav',
  'figure', 'figcaption',
]);

/**
 * Block-level tags that signal a reading pause.
 * After processing each of these, if the last word has no sentence-ending
 * punctuation we inject a hidden "." span so TTS pauses naturally and
 * splitIntoChunks can do its job.
 */
const BLOCK_TAGS = new Set([
  'p',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'blockquote',
  'dt', 'dd',
  'td', 'th',
]);

export class WordHighlighter {
  private container: HTMLElement | null = null;
  private spans: HTMLSpanElement[] = [];
  private activeIndex = -1;

  /**
   * Walks text nodes inside `container`, wrapping each word in a
   * <span class="readly-word">. Block boundaries get a hidden "." span
   * so the returned TTS text has natural sentence breaks that both the
   * chunker and the TTS engine can pause on.
   *
   * Returns the space-joined text of all spans (including hidden pauses)
   * so TTS word indices stay perfectly aligned with span indices.
   */
  wrap(container: HTMLElement): string {
    this.container = container;
    this.spans = [];
    this.activeIndex = -1;
    // Walk children of the root directly — don't treat the root as a block
    for (const child of Array.from(container.childNodes)) {
      this.walkNode(child);
    }
    return this.spans.map((s) => s.textContent ?? '').join(' ');
  }

  highlight(index: number): void {
    this.spans[this.activeIndex]?.classList.remove(ACTIVE_CLASS);
    this.activeIndex = index;
    const span = this.spans[index];
    if (span && !span.classList.contains(PAUSE_CLASS)) {
      span.classList.add(ACTIVE_CLASS);
      span.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  clear(): void {
    this.spans[this.activeIndex]?.classList.remove(ACTIVE_CLASS);
    this.activeIndex = -1;
  }

  destroy(): void {
    for (const span of this.spans) {
      if (span.classList.contains(PAUSE_CLASS)) {
        // Pause spans were invisible helpers — just remove them
        span.remove();
      } else {
        span.replaceWith(document.createTextNode(span.textContent ?? ''));
      }
    }
    this.container?.normalize();
    this.spans = [];
    this.activeIndex = -1;
    this.container = null;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private walkNode(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      this.wrapTextNode(node as Text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    if (this.isSkippable(el)) return;

    const isBlock = BLOCK_TAGS.has(el.tagName.toLowerCase());

    for (const child of Array.from(el.childNodes)) {
      this.walkNode(child);
    }

    // After a block element ensure the last word ends with sentence punctuation.
    // This gives splitIntoChunks a break point and makes TTS pause naturally.
    if (isBlock) {
      this.ensureSentenceBreak();
    }
  }

  /**
   * If the last span in this.spans doesn't end with sentence-ending
   * punctuation, append a hidden "." span directly after it in the DOM
   * and push it onto this.spans so TTS word indices stay in sync.
   */
  private ensureSentenceBreak(): void {
    if (this.spans.length === 0) return;
    const last = this.spans[this.spans.length - 1];
    const text = last.textContent?.trimEnd() ?? '';
    // Skip if already a pause span or already ends with sentence punctuation
    if (!text || last.classList.contains(PAUSE_CLASS) || /[.!?…]$/.test(text)) return;

    const pause = document.createElement('span');
    pause.className = `${WORD_CLASS} ${PAUSE_CLASS}`;
    pause.textContent = '.';
    pause.setAttribute('aria-hidden', 'true');
    last.after(pause);
    this.spans.push(pause);
  }

  private wrapTextNode(textNode: Text): void {
    const raw = textNode.textContent ?? '';
    if (!raw.trim()) return;

    const parts = raw.split(/(\s+)/);
    const fragment = document.createDocumentFragment();

    for (const part of parts) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        fragment.appendChild(document.createTextNode(part));
      } else {
        fragment.appendChild(this.makeSpan(part));
      }
    }
    textNode.replaceWith(fragment);
  }

  private makeSpan(word: string): HTMLSpanElement {
    const span = document.createElement('span');
    span.className = WORD_CLASS;
    span.textContent = word;
    this.spans.push(span);
    return span;
  }

  private isSkippable(el: Element): boolean {
    if (SKIP_TAGS.has(el.tagName.toLowerCase())) return true;
    if (el.getAttribute('role') === 'navigation') return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    if (el.classList.contains('mw-editsection')) return true;
    if (el.classList.contains('reference')) return true;
    if (el.classList.contains('noprint')) return true;
    if (el.classList.contains('sidebar')) return true;
    return false;
  }
}
