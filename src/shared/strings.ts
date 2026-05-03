/**
 * All user-visible strings in one place.
 * Replace values with `chrome.i18n.getMessage(key)` calls when adding locales.
 */

export const STATUS_LABELS: Record<string, string> = {
  idle: 'Idle',
  loading: 'Loading…',
  reading: 'Reading',
  paused: 'Paused',
  summarizing: 'Summarising…',
  done: 'Done',
  error: 'Error',
};

export const OVERLAY_STATUS_LABELS: Record<string, string> = {
  idle: 'Ready',
  loading: 'Loading…',
  reading: 'Reading',
  paused: 'Paused',
  summarizing: 'Summarising…',
  done: 'Done',
  error: 'Error',
};
