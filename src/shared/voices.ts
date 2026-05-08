/**
 * Known high-quality / natural-sounding voice names, in priority order.
 * Substring-matched so "Samantha (Premium)" still matches "Samantha".
 */
export const PREFERRED_VOICE_NAMES = [
  'Samantha',               // macOS US English (often Premium)
  'Alex',                   // macOS classic natural voice
  'Karen',                  // macOS Australian English
  'Daniel',                 // macOS UK English
  'Moira',                  // macOS Irish English
  'Tessa',                  // macOS South African English
  'Serena',                 // macOS UK (premium)
  'Martha',                 // macOS
  'David',                  // Windows 10/11 US English
  'Mark',                   // Windows US English
  'Zira',                   // Windows US English (female)
  'George',                 // Windows UK English
  'Susan',                  // Windows UK English
  'Google UK English Female',
  'Google UK English Male',
  'Google US English',
];

/**
 * Priority-ranked voice selection.
 *
 * 1. User's saved voice name (exact match)
 * 2. Known high-quality named voices (Mac premium → Windows → Google)
 * 3. Any local-service (OS-native) English voice — avoids remote/robotic synth
 * 4. Any English voice
 * 5. null — let the browser pick its default
 */
export function selectBestVoice(
  voices: SpeechSynthesisVoice[],
  savedName: string,
): SpeechSynthesisVoice | null {
  if (!voices.length) return null;

  if (savedName) {
    const saved = voices.find((v) => v.name === savedName);
    if (saved) return saved;
  }

  for (const name of PREFERRED_VOICE_NAMES) {
    const match = voices.find((v) => v.name.includes(name));
    if (match) return match;
  }

  const localEn = voices.find((v) => v.localService && v.lang.startsWith('en'));
  if (localEn) return localEn;

  const anyEn = voices.find((v) => v.lang.startsWith('en'));
  if (anyEn) return anyEn;

  return null;
}

/**
 * Sorts voices so natural/local-service voices float to the top.
 * Returns a new array; does not mutate the input.
 */
export function sortVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const preferred = PREFERRED_VOICE_NAMES;
  return [...voices].sort((a, b) => {
    const aScore = scoreVoice(a, preferred);
    const bScore = scoreVoice(b, preferred);
    return bScore - aScore;
  });
}

function scoreVoice(v: SpeechSynthesisVoice, preferred: string[]): number {
  const prefIdx = preferred.findIndex((name) => v.name.includes(name));
  if (prefIdx !== -1) return 1000 - prefIdx;          // preferred names rank highest
  if (v.localService && v.lang.startsWith('en')) return 500;
  if (v.lang.startsWith('en')) return 100;
  if (v.localService) return 10;
  return 0;
}
