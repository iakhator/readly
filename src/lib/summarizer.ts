import type { ReaderSettings, Summary } from '../shared/types';

const MAX_INPUT_CHARS = 4000;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export async function summarize(text: string, settings: ReaderSettings): Promise<Summary> {
  const truncated = text.slice(0, MAX_INPUT_CHARS);

  if (settings.aiProvider === 'claude' && settings.aiApiKey) {
    return summarizeWithClaude(truncated, settings.aiApiKey);
  }

  if (settings.aiProvider === 'openai' && settings.aiApiKey) {
    return summarizeWithOpenAI(truncated, settings.aiApiKey);
  }

  return localFallback(text);
}

// ── Claude (Anthropic) ────────────────────────────────────────────────────────

async function summarizeWithClaude(text: string, apiKey: string): Promise<Summary> {
  return withRetry(async () => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{ role: 'user', content: buildPrompt(text) }],
      }),
    });

    if (!res.ok) throw new ApiError(res.status);

    const data = (await res.json()) as { content: Array<{ text: string }> };
    return parseResponse(data.content[0]?.text ?? '');
  });
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

async function summarizeWithOpenAI(text: string, apiKey: string): Promise<Summary> {
  return withRetry(async () => {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 512,
        messages: [{ role: 'user', content: buildPrompt(text) }],
      }),
    });

    if (!res.ok) throw new ApiError(res.status);

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return parseResponse(data.choices[0]?.message.content ?? '');
  });
}

// ── Retry with exponential backoff ────────────────────────────────────────────

class ApiError extends Error {
  constructor(public readonly status: number) {
    super(`API ${status}`);
  }
}

function isTransient(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 429 || err.status === 503);
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempt === MAX_RETRIES - 1) throw err;
      await sleep(BASE_DELAY_MS * 2 ** attempt);
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildPrompt(text: string): string {
  return (
    `Summarise the following article in 2-3 conversational sentences. ` +
    `Then list 3-5 key takeaways, each on its own line starting with "- ". ` +
    `Write as if you are speaking aloud — avoid markdown headers or bullet symbols other than "- ".\n\n` +
    `Article:\n${text}`
  );
}

function parseResponse(raw: string): Summary {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const summaryLines: string[] = [];
  const keyPoints: string[] = [];

  for (const line of lines) {
    if (line.startsWith('- ')) {
      keyPoints.push(line.slice(2));
    } else {
      summaryLines.push(line);
    }
  }

  return {
    text: summaryLines.join(' ') || raw,
    keyPoints,
    readingTimeMs: 0,
  };
}

function localFallback(text: string): Summary {
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [];
  return {
    text: sentences.slice(0, 3).join(' ').trim() || text.slice(0, 300),
    keyPoints: [],
    readingTimeMs: 0,
  };
}

// ── Friendly error messages (used by background) ──────────────────────────────

export function friendlySummarizeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) return 'Invalid API key — check Settings.';
    if (err.status === 429) return 'Rate limited — try again in a moment.';
    if (err.status === 503) return 'AI service unavailable — try again shortly.';
    return `AI API error (${err.status}).`;
  }
  return 'Summarisation failed — check your connection and API key.';
}
