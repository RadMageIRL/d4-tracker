import { describe, expect, it } from 'vitest';
import { icsCalendar } from '../src/engine/ics';

const at = (iso: string) => Date.parse(iso);

describe('the calendar file', () => {
  const ev = { uid: 'worldBoss-1@d4-tracker', startMs: at('2026-10-25T08:00:00Z'), endMs: at('2026-10-25T08:15:00Z'), summary: 'Diablo IV: World Boss' };

  it('is one VCALENDAR of UTC events with CRLF line ends', () => {
    const text = icsCalendar([ev], at('2026-10-25T06:00:00Z'));
    expect(text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//d4-tracker//EN\r\n')).toBe(true);
    expect(text).toContain('\r\nDTSTART:20261025T080000Z\r\nDTEND:20261025T081500Z\r\n');
    expect(text).toContain('\r\nDTSTAMP:20261025T060000Z\r\n');
    expect(text.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n')).toBe(true);
    expect(text.replace(/\r\n/g, '').includes('\n')).toBe(false);
  });

  it('escapes text, writes newlines as \\n, and adds the reminder only when asked', () => {
    const text = icsCalendar([{ ...ev, description: 'Predicted: A, B; C\nFrom here', alarmMinutes: 10 }], 0);
    expect(text).toContain('DESCRIPTION:Predicted: A\\, B\\; C\\nFrom here');
    expect(text).toContain('BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Diablo IV: World Boss\r\nTRIGGER:-PT10M\r\nEND:VALARM');
    expect(icsCalendar([ev], 0)).not.toContain('VALARM');
  });

  it('folds lines longer than 75 octets, continuing with a space', () => {
    const text = icsCalendar([{ ...ev, description: 'x'.repeat(200) }], 0);
    const lines = text.split('\r\n');
    expect(lines.every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    const i = lines.findIndex((l) => l.startsWith('DESCRIPTION:'));
    let j = i + 1;
    while (lines[j]!.startsWith(' ')) j++;
    expect(j - i).toBe(3);
    expect(lines.slice(i, j).map((l, n) => (n ? l.slice(1) : l)).join('')).toBe(`DESCRIPTION:${'x'.repeat(200)}`);
  });
});
