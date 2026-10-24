import { describe, expect, it } from 'vitest';
import { agoWords, calendarDate, clockTime, countdown, dayKey, dayLabel, plainDate, spanWords, zoneName } from '../src/engine/format';

describe('countdown', () => {
  it('shows m:ss under an hour', () => {
    expect(countdown(65000)).toBe('1:05');
    expect(countdown(59 * 60000 + 59000)).toBe('59:59');
  });

  it('shows h:mm:ss from an hour up', () => {
    expect(countdown(3600000)).toBe('1:00:00');
    expect(countdown(3 * 3600000 + 29 * 60000 + 5000)).toBe('3:29:05');
  });

  it('rounds partial seconds up, so 0:00 is reached exactly at the start', () => {
    expect(countdown(1)).toBe('0:01');
    expect(countdown(999)).toBe('0:01');
    expect(countdown(1000)).toBe('0:01');
    expect(countdown(1001)).toBe('0:02');
    expect(countdown(0)).toBe('0:00');
  });

  it('clamps negative spans to 0:00', () => {
    expect(countdown(-5000)).toBe('0:00');
  });
});

describe('spanWords', () => {
  it('rounds up to whole minutes', () => {
    expect(spanWords(1)).toBe('1 min');
    expect(spanWords(60000)).toBe('1 min');
    expect(spanWords(60001)).toBe('2 min');
  });

  it('uses hours past 60 minutes', () => {
    expect(spanWords(60 * 60000)).toBe('1 h');
    expect(spanWords(65 * 60000)).toBe('1 h 5 min');
  });

  it('uses days past 24 hours', () => {
    expect(spanWords(24 * 3600000)).toBe('1 d');
    expect(spanWords((3 * 24 + 20) * 3600000)).toBe('3 d 20 h');
    expect(spanWords(24 * 3600000 + 1)).toBe('1 d'); // 1 d 0 h 1 min: minutes are dropped past a day
  });

  it('says now for zero or less', () => {
    expect(spanWords(0)).toBe('now');
    expect(spanWords(-1)).toBe('now');
  });
});

describe('agoWords', () => {
  it('rounds down, so a minute is not claimed before it has passed', () => {
    expect(agoWords(59999)).toBe('just now');
    expect(agoWords(60000)).toBe('1 min ago');
    expect(agoWords(24 * 60000 + 59999)).toBe('24 min ago');
    expect(agoWords(25 * 60000)).toBe('25 min ago');
  });

  it('uses hours past 60 minutes', () => {
    expect(agoWords(60 * 60000)).toBe('1 h ago');
    expect(agoWords(65 * 60000 + 30000)).toBe('1 h 5 min ago');
  });
});

describe('time zones', () => {
  const t = Date.UTC(2026, 9, 23, 23, 30); // 2026-10-23 23:30 UTC

  it('formats the same instant in each zone (24 h)', () => {
    expect(clockTime(t, 'UTC', '24h', false, 'en-US')).toBe('23:30');
    expect(clockTime(t, 'America/New_York', '24h', false, 'en-US')).toBe('19:30'); // EDT, UTC-4
    expect(clockTime(t, 'Asia/Kolkata', '24h', false, 'en-US')).toBe('05:00'); // UTC+5:30, next day
    expect(clockTime(t, 'Australia/Sydney', '24h', false, 'en-US')).toBe('10:30'); // AEDT, UTC+11
  });

  it('uses the zone calendar day, not the UTC day', () => {
    expect(dayKey(t, 'UTC')).toBe('2026-10-23');
    expect(dayKey(t, 'Asia/Kolkata')).toBe('2026-10-24');
    expect(dayKey(t, 'America/Los_Angeles')).toBe('2026-10-23');
  });

  it('labels today, tomorrow and later days in the zone', () => {
    const now = Date.UTC(2026, 9, 23, 20, 0);
    expect(dayLabel(t, now, 'UTC')).toBe('Today');
    // 20:00 UTC is 01:30 on the 24th in Kolkata, and 23:30 UTC is 05:00 the same day there.
    expect(dayLabel(t, now, 'Asia/Kolkata')).toBe('Today');
    expect(dayLabel(t + 86400000, now, 'UTC')).toBe('Tomorrow');
    expect(dayLabel(t + 2 * 86400000, now, 'UTC')).not.toMatch(/Today|Tomorrow/);
  });

  it('finds tomorrow across a DST change (US fall back, 25-hour day)', () => {
    const now = Date.UTC(2026, 10, 1, 4, 30); // 2026-11-01 00:30 EDT, the fall-back day
    const nextDayLate = Date.UTC(2026, 10, 3, 4, 30); // 2026-11-02 23:30 EST
    expect(dayLabel(nextDayLate, now, 'America/New_York')).toBe('Tomorrow');
  });

  it('finds tomorrow across a DST change (US spring forward, 23-hour day)', () => {
    const now = Date.UTC(2026, 2, 8, 4, 30); // 2026-03-07 23:30 EST, the night before spring forward
    const nextDayLate = Date.UTC(2026, 2, 9, 2, 0); // 2026-03-08 22:00 EDT
    expect(dayLabel(nextDayLate, now, 'America/New_York')).toBe('Tomorrow');
  });

  it('names the zone', () => {
    expect(zoneName(t, 'UTC')).toMatch(/UTC/);
  });
});

describe('dates', () => {
  it('shows an instant on its calendar day in the zone', () => {
    const t = Date.UTC(2026, 3, 27, 23, 30); // Season 13 launch
    expect(calendarDate(t, 'America/Los_Angeles', 'en-US')).toBe('Apr 27, 2026');
    expect(calendarDate(t, 'Europe/Berlin', 'en-US')).toBe('Apr 28, 2026');
  });

  it('shows a plain date unchanged in any zone', () => {
    expect(plainDate('2025-07-01', 'en-US')).toBe('Jul 1, 2025');
  });
});
