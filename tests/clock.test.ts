import { describe, expect, it } from 'vitest';
import {
  CLOCK_JUMP_MS, detectResume, estimateClock, LONG_GAP_MS, MAX_PLAUSIBLE_OFFSET_MS, MAX_ROUND_TRIP_MS,
  MIN_CORRECTION_MS, MIN_SAMPLE_GAP_MS, SAMPLE_GAP_MS, type ClockSample,
} from '../src/engine/clock';

// True time of the first reading (a whole second) and of the second, SAMPLE_GAP_MS later.
const T1 = Date.UTC(2026, 9, 24, 3, 0, 0);
const T2 = T1 + SAMPLE_GAP_MS;
const httpDate = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toUTCString();

interface Server { date: (trueMs: number) => string | null; age?: (trueMs: number) => string | null }

/** A reading at true time t, with the device clock `deviceErrorMs` off and a round trip of rt. */
function sample(t: number, deviceErrorMs: number, server: Server, rt = 0): ClockSample {
  const sentMs = t - rt / 2 + deviceErrorMs;
  return { sentMs, receivedMs: sentMs + rt, date: server.date(t), age: server.age ? server.age(t) : null };
}
const pair = (err: number, server: Server, rt = 0) => [sample(T1, err, server, rt), sample(T2, err, server, rt)];

// How servers and caches answer (all observed or standard behavior):
const origin: Server = { date: (t) => httpDate(t) }; // no cache: current Date, no Age
const stored = T1 - 112000; // a copy cached 112 s before the first reading
const ageAt = (t: number) => String(Math.floor((t - stored) / 1000));
const githubCdn: Server = { date: (t) => httpDate(t), age: ageAt }; // current Date plus Age (seen live)
const standardCache: Server = { date: () => httpDate(stored), age: ageAt }; // origin's old Date plus Age
const staleNoAge: Server = { date: () => httpDate(stored) }; // old Date, no Age (misbehaving)

describe('no cache (origin answers)', () => {
  it('leaves a right clock alone', () => {
    const e = estimateClock(pair(0, origin))!;
    expect(e).toMatchObject({ applied: false, offsetMs: 0, measuredMs: 0, basis: 'date' });
  });

  it('corrects a clock 30 s fast to within a second', () => {
    const e = estimateClock(pair(30000, origin))!;
    expect(e.applied).toBe(true);
    expect(Math.abs(e.offsetMs + 30000)).toBeLessThanOrEqual(1000);
  });

  it('corrects a clock 1 minute slow to within a second', () => {
    const e = estimateClock(pair(-60000, origin))!;
    expect(e.applied).toBe(true);
    expect(Math.abs(e.offsetMs - 60000)).toBeLessThanOrEqual(1000);
  });
});

describe('GitHub Pages CDN: current Date plus a growing Age', () => {
  it('reads Date as the live clock and leaves a right clock alone, whatever the Age', () => {
    const e = estimateClock(pair(0, githubCdn))!;
    expect(e).toMatchObject({ applied: false, offsetMs: 0, basis: 'date' });
  });

  it('still corrects a clock 30 s slow precisely (the Age does not widen the window)', () => {
    const e = estimateClock(pair(-30000, githubCdn))!;
    expect(e.applied).toBe(true);
    expect(Math.abs(e.offsetMs - 30000)).toBeLessThanOrEqual(1000);
  });

  it('never adds the Age: the v0.2 mistake would have read a right clock as 112 s slow', () => {
    const e = estimateClock(pair(0, githubCdn))!;
    expect(Math.abs(e.measuredMs)).toBeLessThan(1000);
  });
});

describe('standard cache: the origin\'s old Date plus a growing Age', () => {
  it('reads Date + Age and leaves a right clock alone', () => {
    const e = estimateClock(pair(0, standardCache))!;
    expect(e).toMatchObject({ applied: false, offsetMs: 0, basis: 'date+age' });
  });

  it('corrects a clock 30 s fast to within two seconds', () => {
    const e = estimateClock(pair(30000, standardCache))!;
    expect(e.applied).toBe(true);
    expect(Math.abs(e.offsetMs + 30000)).toBeLessThanOrEqual(2000);
  });
});

describe('a live Date with a constant Age (a proxy that always says the same Age)', () => {
  it('trusts the moving Date, not Date + Age, and leaves a right clock alone', () => {
    const fixedAge: Server = { date: (t) => httpDate(t), age: () => '30' };
    expect(estimateClock(pair(0, fixedAge))).toMatchObject({ basis: 'date', applied: false, offsetMs: 0 });
  });
});

describe('unreliable answers never move the countdowns', () => {
  it('stale: an old Date with no Age is refused, even though the clock "looks" 112 s fast', () => {
    expect(estimateClock(pair(0, staleNoAge))).toBeNull();
    expect(estimateClock(pair(112000, staleNoAge))).toBeNull();
  });

  it('inconsistent: a Date that jumps an hour between readings is refused', () => {
    const jumping: Server = { date: (t) => httpDate(t === T1 ? t : t + 3600000) };
    expect(estimateClock(pair(0, jumping))).toBeNull();
  });

  it('inconsistent: a Date that runs backwards is refused', () => {
    const backwards: Server = { date: (t) => httpDate(T1 + T2 - t) };
    expect(estimateClock(pair(0, backwards))).toBeNull();
  });

  it('inconsistent: Date and Age that both stand still are refused', () => {
    const frozen: Server = { date: () => httpDate(stored), age: () => '112' };
    expect(estimateClock(pair(0, frozen))).toBeNull();
  });

  it('garbage: a missing or unparseable Date, or an Age that is not a whole number, is refused', () => {
    expect(estimateClock(pair(0, { date: () => null }))).toBeNull();
    expect(estimateClock(pair(0, { date: () => 'not a date' }))).toBeNull();
    for (const bad of ['-1', 'soon', '1.5', '120, 3']) {
      expect(estimateClock(pair(0, { date: (t) => httpDate(t), age: () => bad }))).toBeNull();
    }
  });

  it('implausible: a consistent server more than a day off is treated as broken, not believed', () => {
    expect(MAX_PLAUSIBLE_OFFSET_MS).toBe(86400000);
    const dayOff: Server = { date: (t) => httpDate(t + 2 * 86400000) };
    expect(estimateClock(pair(0, dayOff))).toBeNull();
  });

  it('needs two readings at least 4 s apart', () => {
    expect(MIN_SAMPLE_GAP_MS).toBe(4000);
    expect(estimateClock([sample(T1, 0, origin)])).toBeNull();
    expect(estimateClock([sample(T1, 0, origin), sample(T1 + 3900, 0, origin)])).toBeNull();
    expect(estimateClock([sample(T1, 0, origin), sample(T1 + 4000, 0, origin)])).not.toBeNull();
  });

  it('refuses round trips over 1.5 s', () => {
    expect(MAX_ROUND_TRIP_MS).toBe(1500);
    expect(estimateClock(pair(0, origin, 1500))).not.toBeNull();
    expect(estimateClock(pair(0, origin, 1600))).toBeNull();
  });
});

describe('timing edges', () => {
  it('refuses a negative round trip (a clock that stepped back mid-request)', () => {
    const bad: ClockSample = { sentMs: T1, receivedMs: T1 - 1, date: httpDate(T1), age: null };
    expect(estimateClock([bad, sample(T2, 0, origin)])).toBeNull();
  });

  it('standard cache, sub-second timing: Date + Age can trail the truth by almost 2 s and still fits', () => {
    // Stored at .9 of a second and read at .8: both headers round down, and Date + Age reads 1.8 s
    // behind the true time, still inside its two-second resolution, so the truth fits exactly.
    const storedFrac = T1 - 112100;
    const cache: Server = { date: () => httpDate(storedFrac), age: (t) => String(Math.floor((t - storedFrac) / 1000)) };
    const e = estimateClock([sample(T1 + 800, 0, cache), sample(T2 + 800, 0, cache)]);
    expect(e).toMatchObject({ basis: 'date+age', applied: false, offsetMs: 0, measuredMs: 0 });
  });

  it('allows for the server reading its clock anywhere within a slow round trip', () => {
    // 1.5 s round trips; the server reads its clock at the very start of one and the very end of
    // the other. Without allowing for that, the two readings would contradict each other.
    const rt = 1500;
    const at = (t: number, readAt: number): ClockSample => ({ sentMs: t - rt / 2, receivedMs: t + rt / 2, date: httpDate(readAt), age: null });
    // Start of the first, end of the second:
    expect(estimateClock([at(T1 + 740, T1 + 740 - rt / 2), at(T2, T2 + rt / 2)])).toMatchObject({ basis: 'date', applied: false, offsetMs: 0 });
    // End of the first, start of the second (the readings disagree by 1.48 s, inside the 1.5 s allowance):
    expect(estimateClock([at(T1 - 740, T1 - 740 + rt / 2), at(T2 + 740, T2 + 740 - rt / 2)])).toMatchObject({ basis: 'date', applied: false, offsetMs: 0 });
  });
});

describe('thresholds', () => {
  it('corrects only from 1.5 s beyond what the headers allow', () => {
    expect(MIN_CORRECTION_MS).toBe(1500);
    // With whole-second readings, a slow clock is off by exactly its error.
    expect(estimateClock(pair(-1499, origin))!.applied).toBe(false);
    expect(estimateClock(pair(-1500, origin))!.applied).toBe(true);
  });

  it('reports a wider uncertainty for slower round trips', () => {
    const fast = estimateClock(pair(0, origin, 100))!;
    const slow = estimateClock(pair(0, origin, 1400))!;
    expect(slow.uncertaintyMs).toBeGreaterThan(fast.uncertaintyMs);
  });

  it('a right clock is never corrected under any cache style, across round trips', () => {
    for (const server of [origin, githubCdn, standardCache]) {
      for (const rt of [0, 300, 1500]) {
        const e = estimateClock(pair(0, server, rt));
        expect(e?.applied ?? false).toBe(false);
      }
    }
  });
});

describe('detectResume', () => {
  it('sees nothing on a normal one-second tick', () => {
    expect(detectResume(0, 0, 1000, 1000)).toBeNull();
  });

  it('sees nothing on a throttled background tick a minute later', () => {
    expect(detectResume(0, 0, 60000, 60000)).toBeNull();
  });

  it('sees a clock jump when the wall clock moves 30 s more than elapsed time', () => {
    expect(detectResume(0, 0, 31000, 1000)).toBe('clock-jump');
    expect(detectResume(0, 0, 1000 - 30000, 1000)).toBe('clock-jump');
  });

  it('pins the jump threshold: 2 s is ignored, just over is a jump', () => {
    expect(CLOCK_JUMP_MS).toBe(2000);
    expect(detectResume(0, 0, 3000, 1000)).toBeNull();
    expect(detectResume(0, 0, 3001, 1000)).toBe('clock-jump');
  });

  it('sees a long gap after sleep even when both clocks advanced together', () => {
    expect(LONG_GAP_MS).toBe(300000);
    expect(detectResume(0, 0, 300001, 300001)).toBe('long-gap');
    expect(detectResume(0, 0, 300000, 300000)).toBeNull();
  });
});
