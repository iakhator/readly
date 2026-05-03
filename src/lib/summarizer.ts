import type { ReaderSettings, Summary } from '../shared/types';

const MAX_INPUT_CHARS = 4000;

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

  if (!res.ok) throw new Error(`Claude API ${res.status}`);

  const data = (await res.json()) as { content: Array<{ text: string }> };
  return parseResponse(data.content[0]?.text ?? '');
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

async function summarizeWithOpenAI(text: string, apiKey: string): Promise<Summary> {
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

  if (!res.ok) throw new Error(`OpenAI API ${res.status}`);

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return parseResponse(data.choices[0]?.message.content ?? '');
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
