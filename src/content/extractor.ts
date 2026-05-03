import { Readability } from '@mozilla/readability';
import type { ExtractedContent } from '../shared/types';

export function extractContent(): ExtractedContent | null {
  const clone = document.cloneNode(true) as Document;
  const reader = new Readability(clone);
  const article = reader.parse();

  if (!article || !article.textContent.trim()) {
    return fallbackExtract();
  }

  const wordCount = article.textContent.match(/\S+/g)?.length ?? 0;

  return {
    title: article.title || document.title || '',
    byline: article.byline ?? null,
    textContent: article.textContent.trim(),
    excerpt: article.excerpt ?? null,
    siteName: article.siteName ?? null,
    wordCount,
    lang: document.documentElement.lang || null,
  };
}

function fallbackExtract(): ExtractedContent | null {
  const el =
    document.querySelector('article') ??
    document.querySelector('main') ??
    document.querySelector('[role="main"]');

  if (!el) return null;

  const textContent = (el.textContent ?? '').trim();
  if (!textContent) return null;

  return {
    title: document.title || '',
    byline: null,
    textContent,
    excerpt: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null,
    siteName:
      document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ?? null,
    wordCount: textContent.match(/\S+/g)?.length ?? 0,
    lang: document.documentElement.lang || null,
  };
}
