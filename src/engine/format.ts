// Display formatting. Pure functions: the caller passes the instant, the time zone and the
// clock style, so the same code is testable in any zone.

export type ClockStyle = 'auto' | '12h' | '24h';

/**
 * Countdown text for a span in ms. Seconds round up, so the display reaches 0:00 exactly when
 * the event starts rather than a second early. Under an hour: m:ss. Otherwise h:mm:ss.
 */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h === 0) return `${m}:${ss}`;
  return `${h}:${String(m).padStart(2, '0')}:${ss}`;
}

/** Short span: "4 min", "1 h 5 min", "3 d 20 h". Rounds up to the minute. */
export function spanWords(ms: number): string {
  if (ms <= 0) return 'now';
  const minutes = Math.ceil(ms / 60000);
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return h === 0 ? `${d} d` : `${d} d ${h} h`;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** How long ago, rounded down: "24 min ago" stays 24 until a full 25 minutes have passed. */
export function agoWords(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60000);
  if (minutes < 1) return 'just now';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min ago`;
  return m === 0 ? `${h} h ago` : `${h} h ${m} min ago`;
}

function hour12For(style: ClockStyle): boolean | undefined {
  return style === 'auto' ? undefined : style === '12h';
}

/** Wall-clock time, e.g. "3:30 PM" or "15:30", in the given IANA zone. */
export function clockTime(
  ms: number, timeZone: string, style: ClockStyle, withSeconds = false, locale?: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    second: withSeconds ? '2-digit' : undefined,
    hour12: hour12For(style),
    timeZone,
  }).format(ms);
}

/** Calendar day key (YYYY-MM-DD) of an instant in a zone. */
export function dayKey(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone,
  }).formatToParts(ms);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** "Today", "Tomorrow", or a short weekday, judged in the given zone. */
export function dayLabel(ms: number, nowMs: number, timeZone: string): string {
  const target = dayKey(ms, timeZone);
  if (target === dayKey(nowMs, timeZone)) return 'Today';
  // The next calendar day in the zone: step forward until the key changes (handles DST days).
  const today = dayKey(nowMs, timeZone);
  let probe = nowMs;
  let next = today;
  while (next === today) {
    probe += 3600000;
    next = dayKey(probe, timeZone);
  }
  if (target === next) return 'Tomorrow';
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone }).format(ms);
}

/** Short zone name for display, e.g. "EDT", "UTC", "GMT+5:30". */
export function zoneName(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short', timeZone }).formatToParts(ms);
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
}

/** Calendar date of an instant in a zone, e.g. "Sep 15, 2026". */
export function calendarDate(ms: number, timeZone: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone }).format(ms);
}

/** A YYYY-MM-DD date as written, with no zone shift, e.g. "Jul 1, 2025". */
export function plainDate(date: string, locale?: string): string {
  return calendarDate(Date.parse(`${date}T12:00:00Z`), 'UTC', locale);
}
