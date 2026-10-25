// An iCalendar file (RFC 5545) of timed events, for a calendar app to import. Times are UTC; text
// is escaped, and lines are folded at 75 octets with continuation lines starting with a space.

export interface CalendarEvent {
  /** Stable, so importing the same start again updates it instead of adding a copy. */
  uid: string;
  startMs: number;
  endMs: number;
  summary: string;
  description?: string;
  /** A reminder this many minutes before the start. */
  alarmMinutes?: number;
}

const icsTime = (t: number) => new Date(t).toISOString().replace(/\.\d{3}/, '').replace(/[-:]/g, '');
const icsText = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');

function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let octets = 0;
  for (const ch of line) {
    const cp = ch.codePointAt(0)!;
    const n = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (octets + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; octets = 0; }
    cur += ch;
    octets += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** The file's text; `stampMs` is when it was made. */
export function icsCalendar(events: CalendarEvent[], stampMs: number): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//d4-tracker//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${icsTime(stampMs)}`, `DTSTART:${icsTime(e.startMs)}`, `DTEND:${icsTime(e.endMs)}`,
      `SUMMARY:${icsText(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsText(e.description)}`);
    if (e.alarmMinutes !== undefined) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(e.summary)}`, `TRIGGER:-PT${e.alarmMinutes}M`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
