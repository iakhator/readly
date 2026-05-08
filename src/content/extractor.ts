import { Readability } from '@mozilla/readability';
import type { ExtractedContent } from '../shared/types';

const WORDS_PER_MINUTE = 200;

/**
 * Elements to strip from the DOM clone before Readability runs.
 * Only targets things that are unambiguously not article content — avoids
 * removing elements that Readability's scoring relies on.
 */
const PRE_NOISE_SELECTORS = [
  // Layout chrome
  'nav', 'header', 'footer',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  // Cookie / GDPR banners
  '[class*="cookie"]', '[id*="cookie"]',
  '[class*="gdpr"]',   '[id*="gdpr"]',
  '[class*="consent"]',
  // Popups / modals
  '[role="dialog"]', '[class*="modal"]', '[class*="popup"]',
  // Scripts / styles (should be gone, but just in case)
  'script', 'style', 'noscript',
].join(', ');

/**
 * Fallback CSS selectors tried in priority order when Readability
 * doesn't find enough content. Covers the most common CMS class names.
 */
const FALLBACK_SELECTORS = [
  'article',
  'main',
  '[role="main"]',
  '[itemprop="articleBody"]',
  '.post-content',
  '.post-body',
  '.article-content',
  '.article-body',
  '.entry-content',
  '.entry-body',
  '.story-content',
  '.story-body',
  '.content-body',
  '.prose',
  '#content',
  '#main',
];

// ── Public API ────────────────────────────────────────────────────────────────

export function extractContent(): ExtractedContent | null {
  const clone = document.cloneNode(true) as Document;
  removeNoise(clone);

  const reader = new Readability(clone, {
    charThreshold: 300,
    keepClasses: false,
  });
  const article = reader.parse();

  if (article && (article.textContent ?? '').trim().length > 150) {
    return build(
      article.textContent ?? '',
      article.title || document.title || '',
      article.byline ?? metaByline(),
      article.excerpt ?? metaDescription(),
      article.siteName ?? metaSiteName(),
    );
  }

  return fallback();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function removeNoise(doc: Document): void {
  doc.querySelectorAll(PRE_NOISE_SELECTORS).forEach((el) => el.remove());
}

function fallback(): ExtractedContent | null {
  for (const selector of FALLBACK_SELECTORS) {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) continue;

    const clone = el.cloneNode(true) as HTMLElement;
    // Remove the same noise classes from the candidate
    clone.querySelectorAll(PRE_NOISE_SELECTORS).forEach((n) => n.remove());
    // Also strip sidebars and comment sections that may live inside <main>
    clone
      .querySelectorAll('[class*="sidebar"],[id*="sidebar"],[id*="comment"],[class*="comment"],[class*="related"],[class*="newsletter"],[class*="subscribe"]')
      .forEach((n) => n.remove());

    const text = (clone.textContent ?? '').trim();
    if (text.length > 150) {
      return build(text, document.title, metaByline(), metaDescription(), metaSiteName());
    }
  }

  return null;
}

function build(
  rawText: string,
  title: string,
  byline: string | null,
  excerpt: string | null,
  siteName: string | null,
): ExtractedContent {
  const textContent = cleanForTTS(rawText);
  const wordCount = countWords(textContent);

  return {
    title: title.trim(),
    byline,
    textContent,
    excerpt,
    siteName,
    wordCount,
    estimatedReadingTime: Math.ceil(wordCount / WORDS_PER_MINUTE),
    lang: document.documentElement.lang || null,
  };
}

// ── Text cleaning ─────────────────────────────────────────────────────────────

/**
 * Normalises raw extracted text so it sounds natural when fed to SpeechSynthesis.
 * Removes artefacts that TTS reads out awkwardly (URLs, excessive punctuation, etc.)
 */
function cleanForTTS(text: string): string {
  return text
    // Remove bare URLs — they sound terrible read aloud
    .replace(/https?:\/\/[^\s)>\]"']+/g, '')
    // Remove email addresses
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '')
    // Em dash / en dash → natural spoken pause
    .replace(/\s*[—–]\s*/g, ', ')
    // Standalone hyphen surrounded by spaces → comma pause
    .replace(/ - /g, ', ')
    // Ellipsis → single period
    .replace(/\.{2,}/g, '.')
    // Markdown heading markers (#, ##, …)
    .replace(/^#{1,6}\s+/gm, '')
    // Bold/italic markers (*word*, **word**, _word_)
    .replace(/\*{1,2}([^*\n]+)\*{1,2}/g, '$1')
    .replace(/_{1,2}([^_\n]+)_{1,2}/g, '$1')
    // Inline code — just keep the content
    .replace(/`([^`]+)`/g, '$1')
    // Collapse horizontal whitespace
    .replace(/[ \t]+/g, ' ')
    // Fold excessive blank lines into a single sentence boundary
    .replace(/(\s*\n){3,}/g, '\n\n')
    // Flatten remaining single newlines into spaces
    .replace(/\n/g, ' ')
    .trim();
}

function countWords(text: string): number {
  return text.match(/\S+/g)?.length ?? 0;
}

// ── Meta tag helpers ──────────────────────────────────────────────────────────

function metaByline(): string | null {
  return (
    document.querySelector<HTMLElement>('[rel="author"]')?.textContent?.trim() ??
    document.querySelector<HTMLElement>('.author')?.textContent?.trim() ??
    document.querySelector<HTMLElement>('[class*="byline"]')?.textContent?.trim() ??
    document.querySelector<HTMLMetaElement>('meta[name="author"]')?.content ??
    null
  );
}

function metaDescription(): string | null {
  return (
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ??
    document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.content ??
    null
  );
}

function metaSiteName(): string | null {
  return (
    document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content ??
    document.querySelector<HTMLMetaElement>('meta[name="application-name"]')?.content ??
    null
  );
}
