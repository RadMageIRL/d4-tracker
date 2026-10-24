import { describe, expect, it } from 'vitest';
import { CLOCK_JUMP_MS, detectResume, estimateClock, LONG_GAP_MS, MAX_ROUND_TRIP_MS, MIN_CORRECTION_MS } from '../src/engine/clock';

const header = (ms: number) => new Date(ms).toUTCString();
const server = Date.UTC(2026, 9, 23, 18, 0, 0); // a whole second

describe('estimateClock', () => {
  it('applies no correction when the clocks agree', () => {
    // Local reads 18:00:00.400 at the midpoint of a 200 ms round trip; the server second is 18:00:00.
    const e = estimateClock(server + 300, server + 500, header(server))!;
    expect(e.applied).toBe(false);
    expect(e.offsetMs).toBe(0);
    expect(Math.abs(e.measuredMs)).toBeLessThan(MIN_CORRECTION_MS);
  });

  it('corrects a local clock that is 10 s fast', () => {
    const e = estimateClock(server + 10000, server + 10200, header(server))!;
    expect(e.applied).toBe(true);
    expect(e.offsetMs).toBe(-9600); // 500 into the server second, minus the local midpoint
  });

  it('corrects a local clock that is 1 minute slow', () => {
    const e = estimateClock(server - 60000, server - 59900, header(server))!;
    expect(e.applied).toBe(true);
    expect(e.offsetMs).toBe(60450);
  });

  it('leaves a 1.5 s difference alone (below the header resolution margin)', () => {
    const e = estimateClock(server - 1000, server - 1000, header(server))!;
    expect(e.measuredMs).toBe(1500);
    expect(e.applied).toBe(false);
  });

  it('applies a difference at exactly the threshold', () => {
    const e = estimateClock(server + 500 - MIN_CORRECTION_MS, server + 500 - MIN_CORRECTION_MS, header(server))!;
    expect(e.measuredMs).toBe(MIN_CORRECTION_MS);
    expect(e.applied).toBe(true);
  });

  it('rejects a missing or unparseable header', () => {
    expect(estimateClock(0, 10, null)).toBeNull();
    expect(estimateClock(0, 10, 'not a date')).toBeNull();
  });

  it('rejects a round trip that is too slow or negative', () => {
    expect(estimateClock(server, server + MAX_ROUND_TRIP_MS + 1, header(server))).toBeNull();
    expect(estimateClock(server, server - 1, header(server))).toBeNull();
    expect(estimateClock(server, server + MAX_ROUND_TRIP_MS, header(server))).not.toBeNull();
  });

  it('widens the uncertainty with the round trip', () => {
    const fast = estimateClock(server, server + 100, header(server))!;
    const slow = estimateClock(server, server + 2000, header(server))!;
    expect(slow.uncertaintyMs).toBeGreaterThan(fast.uncertaintyMs);
  });
});

describe('clock thresholds as numbers', () => {
  it('pins the thresholds: 2 s of difference, round trips up to 3 s', () => {
    expect(MIN_CORRECTION_MS).toBe(2000);
    expect(MAX_ROUND_TRIP_MS).toBe(3000);
    expect(estimateClock(server, server + 2900, header(server))).not.toBeNull();
    expect(estimateClock(server, server + 3100, header(server))).toBeNull();
  });
});

describe('cached responses (Age header)', () => {
  it('adds the Age back: a copy cached 120 s ago does not make the device look 2 min fast', () => {
    // The device is right: at local 18:02:00 a cache returns a response dated 18:00:00, Age 120.
    const now = server + 120000;
    const e = estimateClock(now, now, header(server), '120')!;
    expect(e.applied).toBe(false);
    expect(Math.abs(e.measuredMs)).toBeLessThanOrEqual(1000);
  });

  it('without the Age header the same stale copy would be read as a 2 min error', () => {
    const now = server + 120000;
    expect(estimateClock(now, now, header(server))!.applied).toBe(true);
  });

  it('still corrects a real error behind a cache', () => {
    const now = server + 120000 + 30000; // device 30 s fast
    const e = estimateClock(now, now, header(server), '120')!;
    expect(e.applied).toBe(true);
    expect(e.offsetMs).toBe(-29000);
  });

  it('widens the uncertainty by a second when Age is present', () => {
    const plain = estimateClock(server, server, header(server))!;
    const aged = estimateClock(server, server, header(server), '0')!;
    expect(aged.uncertaintyMs - plain.uncertaintyMs).toBe(500);
  });

  it('rejects a malformed Age', () => {
    expect(estimateClock(server, server, header(server), '-5')).toBeNull();
    expect(estimateClock(server, server, header(server), 'soon')).toBeNull();
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
