const WORD_CLASS = 'readly-word';
const ACTIVE_CLASS = 'readly-word--active';

/**
 * Element tags whose text we skip entirely.
 * Avoids wrapping infobox tables, code blocks, navs, etc.
 */
const SKIP_TAGS = new Set([
  'script', 'style', 'noscript',
  'svg', 'canvas', 'video', 'audio',
  'input', 'textarea', 'select', 'button',
  'code', 'pre',
  'table',   // infoboxes / data tables (Wikipedia, etc.)
  'aside',
  'nav',
  'figure', 'figcaption',
]);

export class WordHighlighter {
  private container: HTMLElement | null = null;
  private spans: HTMLSpanElement[] = [];
  private activeIndex = -1;

  /**
   * Walks text nodes inside `container`, wrapping each word in a
   * <span class="readly-word"> without touching element structure.
   * The page layout is completely preserved.
   */
  wrap(container: HTMLElement): void {
    this.container = container;
    this.spans = [];
    this.activeIndex = -1;
    this.walkNode(container);
  }

  highlight(index: number): void {
    this.spans[this.activeIndex]?.classList.remove(ACTIVE_CLASS);
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
    for (const span of this.spans) {
      span.replaceWith(document.createTextNode(span.textContent ?? ''));
    }
    // Merge adjacent text nodes that were split by our spans
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

    // Snapshot childNodes — walking modifies the live list
    for (const child of Array.from(node.childNodes)) {
      this.walkNode(child);
    }
  }

  private wrapTextNode(textNode: Text): void {
    const raw = textNode.textContent ?? '';
    // Skip whitespace-only nodes
    if (!raw.trim()) return;

    const parts = raw.split(/(\s+)/);
    // Nothing to wrap if there's only one part (single word)
    if (parts.length <= 1) {
      if (raw.trim()) {
        const span = this.makeSpan(raw);
        textNode.replaceWith(span);
      }
      return;
    }

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
    // Wikipedia-specific noise
    if (el.classList.contains('mw-editsection')) return true;
    if (el.classList.contains('reference')) return true;
    if (el.classList.contains('noprint')) return true;
    if (el.classList.contains('sidebar')) return true;
    return false;
  }
}
