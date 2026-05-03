export interface ExtractedContent {
  title: string;
  byline: string | null;
  textContent: string;
  excerpt: string | null;
  siteName: string | null;
  wordCount: number;
  lang: string | null;
}

export type ReadingStatus =
  | 'idle'
  | 'loading'
  | 'reading'
  | 'paused'
  | 'summarizing'
  | 'done'
  | 'error';

export interface ReaderState {
  status: ReadingStatus;
  progress: number;
  currentWordIndex: number;
  totalWords: number;
  wordsPerMinute: number;
  estimatedTimeRemaining: number;
  tabId?: number;
}

export type AIProvider = 'none' | 'claude' | 'openai';

export interface ReaderSettings {
  voice: string;
  rate: number;
  pitch: number;
  volume: number;
  aiProvider: AIProvider;
  aiApiKey: string;
  highlightEnabled: boolean;
  autoSummarize: boolean;
}

export interface Summary {
  text: string;
  keyPoints: string[];
  readingTimeMs: number;
}
