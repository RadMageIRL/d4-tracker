// Which boss, arena, Helltide region or Legion site comes next, worked out from sightings alone.
//
// Three things are kept apart on purpose:
// 1. Points: one observed value per occurrence of the event, from sightings seen in game.
//    Secondhand reports are counted and shown, never used as evidence. Only occurrences since the
//    last reset boundary (a season start, a patch) and in the schedule now in force count.
// 2. Rules: a repeating order. Either found in the points (the shortest cycle cycleFit accepts),
//    or registered in the data from a source, waiting to be tested.
// 3. Tests: a rule is judged only on sightings it was not formed from. A found rule is tested on
//    the occurrences after the ones it was found in; a registered rule on occurrences after the
//    day it was registered. A rule earns Inferred with MIN_TESTS correct predictions, no miss, and
//    a chance match under MAX_TEST_CHANCE. Any contradiction withdraws it, and learning starts
//    again from the contradicting sighting (the order may have changed or reset there).
//
// Nothing here makes a rule Confirmed from sightings: only Blizzard's own words can do that.

import type { Confidence } from '../data/schema';
import { cycleFit, isSeen, occurrenceOf, type Observation, type ObservedEvent, type Realm } from './observations';
import { indexAt } from './schedule';
import type { Segment } from './segments';

export type SequenceField = 'boss' | 'place' | 'region' | 'pair';

/** The pair field joins boss and place, for when a boss and its arena go together. */
export const PAIR_JOIN = ' @ ';

/** Correct predictions a rule needs, on sightings it was not formed from, before it is Inferred. */
export const MIN_TESTS = 3;
/** The chance those predictions were lucky must be under this. */
export const MAX_TEST_CHANCE = 0.01;

export function fieldValue(o: Observation, field: SequenceField): string | undefined {
  if (field === 'pair') return o.boss && o.place ? `${o.boss}${PAIR_JOIN}${o.place}` : undefined;
  return o[field];
}

const mod = (a: number, b: number) => ((a % b) + b) % b;

// Points

export interface SequencePoint {
  index: number;
  startMs: number;
  value: string;
}

export interface PointSet {
  /** One per occurrence, in time order. */
  points: SequencePoint[];
  /** Secondhand reports with a value, left out. */
  reported: number;
  /** Occurrences recorded with two different values, left out. */
  conflicts: number;
  /** Sightings before the reset boundary, or under another schedule. */
  older: number;
}

export interface PointOptions {
  /** Every schedule segment of the event, to place each sighting in its occurrence. */
  segments: Segment[];
  /** Only occurrences of this segment count: indices from different schedules do not mix. */
  segment: Segment;
  /** Only occurrences that start at or after this instant. */
  sinceMs?: number;
  /** Only sightings from this realm; records without a realm count for either. */
  realm?: Realm;
  /**
   * Only sightings this accepts. Two Helltides can run at once (one in a base-game region, one in
   * an expansion region), and every fourth World Boss brings a second one in an expansion arena, so
   * each is its own sequence.
   */
  include?: (o: Observation) => boolean;
}

export function sequencePoints(observations: Observation[], event: ObservedEvent, field: SequenceField, opts: PointOptions): PointSet {
  const byIndex = new Map<number, SequencePoint>();
  const conflicted = new Set<number>();
  let reported = 0;
  let older = 0;
  for (const o of observations) {
    if (o.event !== event || o.timing === 'none') continue;
    const value = fieldValue(o, field);
    if (!value || (opts.include && !opts.include(o))) continue;
    if (opts.realm && o.realm && o.realm !== opts.realm) continue;
    if (!isSeen(o)) { reported++; continue; }
    const occ = occurrenceOf(opts.segments, o);
    if (!occ || occ.segment !== opts.segment || occ.startMs < (opts.sinceMs ?? -Infinity)) { older++; continue; }
    const prev = byIndex.get(occ.index);
    if (prev && prev.value !== value) conflicted.add(occ.index);
    else if (!prev) byIndex.set(occ.index, { index: occ.index, startMs: occ.startMs, value });
  }
  for (const i of conflicted) byIndex.delete(i);
  const points = [...byIndex.values()].sort((a, b) => a.startMs - b.startMs);
  return { points, reported, conflicts: conflicted.size, older };
}

// Rules

/** A rule from the data: an order someone described, registered so our sightings can test it. */
export interface RegisteredRule {
  id: string;
  event: 'worldBoss' | 'legion' | 'helltide';
  field: SequenceField;
  /** The values in order; the cycle length is the sequence length. */
  sequence: string[];
  /** ISO UTC start of an occurrence that showed sequence[0], or null when the phase must be read from sightings. */
  anchor: string | null;
  /** YYYY-MM-DD. Only occurrences from the next UTC day on test it. */
  registeredOn: string;
  /** Where the rule came from, in a few words. */
  basis: string;
  /** Blizzard's own words describe it (the only way to Confirmed). */
  documented: boolean;
}

export interface Rule {
  origin: 'found' | 'registered';
  id: string;
  /** The value of occurrence index i is sequence[(i + offset) mod length]. */
  sequence: string[];
  /** Offsets still possible; one once the phase is pinned. */
  offsets: number[];
  /** Occurrences starting at or after this instant test the rule. */
  testFromMs: number;
  basis: string;
  documented: boolean;
}

export interface Miss {
  startMs: number;
  expected: string;
  seen: string;
}

export interface RuleTest {
  hits: number;
  misses: Miss[];
  /** Points that did not test it: formed it, came before its test date, or the phase was unclear. */
  untested: number;
  /** Offsets consistent with every point so far (empty after a contradiction). */
  offsets: number[];
  /** The first point the rule could not explain at all. */
  contradiction: Miss | null;
  /**
   * How likely a guesser who knows only how often each value has turned up so far would have
   * matched every hit. Each hit counts against the sightings before it (add-one smoothed), and
   * never as less likely than a uniform guess: a value that is common anyway counts for little.
   */
  chance: number;
}

/** Replay the points in time order against a rule; `domain` is how many values are possible. */
export function testRule(rule: Rule, points: SequencePoint[], domain: number): RuleTest {
  const n = rule.sequence.length;
  const d = Math.max(2, domain);
  let offsets = [...rule.offsets];
  const out: RuleTest = { hits: 0, misses: [], untested: 0, offsets, contradiction: null, chance: 1 };
  const before = new Map<string, number>();
  let seenSoFar = 0;
  for (const pt of points) {
    if (out.contradiction) { out.untested++; continue; }
    const preds = new Set(offsets.map((o) => rule.sequence[mod(pt.index + o, n)]!));
    const next = offsets.filter((o) => rule.sequence[mod(pt.index + o, n)] === pt.value);
    if (pt.startMs >= rule.testFromMs && preds.size === 1) {
      const expected = [...preds][0]!;
      if (expected === pt.value) {
        out.hits++;
        out.chance *= Math.max(1 / d, ((before.get(expected) ?? 0) + 1) / (seenSoFar + d));
      } else {
        out.misses.push({ startMs: pt.startMs, expected, seen: pt.value });
      }
    } else {
      out.untested++;
    }
    if (!next.length) out.contradiction = { startMs: pt.startMs, expected: [...preds].join(' or '), seen: pt.value };
    offsets = next;
    before.set(pt.value, (before.get(pt.value) ?? 0) + 1);
    seenSoFar++;
  }
  out.offsets = out.contradiction ? [] : offsets;
  return out;
}

/** The first rule the points reveal, replaying them in time order, and how many points formed it. */
export function findRule(points: SequencePoint[], domainSize: number, maxPeriod = 12): { rule: Rule; formedBy: number } | null {
  for (let k = 2; k <= points.length; k++) {
    const fit = cycleFit(points.slice(0, k).map((p) => [p.index, p.value]), domainSize, maxPeriod);
    if (fit.verdict !== 'consistent' || !fit.values) continue;
    return {
      formedBy: k,
      rule: {
        origin: 'found', id: 'found', sequence: fit.values, offsets: [0],
        testFromMs: points[k]?.startMs ?? Infinity,
        basis: `found in these sightings (a cycle of ${fit.period}, first seen in ${k} of them)`,
        documented: false,
      },
    };
  }
  return null;
}

export function registeredToRule(r: RegisteredRule, segment: Segment): Rule {
  const n = r.sequence.length;
  const offsets = r.anchor === null
    ? Array.from({ length: n }, (_, i) => i)
    : [mod(-indexAt(segment.schedule, Date.parse(r.anchor)), n)];
  return {
    origin: 'registered', id: r.id, sequence: r.sequence, offsets,
    testFromMs: Date.parse(`${r.registeredOn}T00:00:00Z`) + 86400000,
    basis: r.basis, documented: r.documented,
  };
}

// Models

export type ModelState =
  | 'no-data' // nothing seen yet
  | 'collecting' // too few sightings to test for an order
  | 'no-pattern' // cycles up to MIN_RULED_OUT are ruled out
  | 'testing' // a rule fits and is being tested on new sightings
  | 'ambiguous' // a registered order fits, but where in it we are is not fixed yet
  | 'contradicted' // the last rule was contradicted, and nothing has replaced it yet
  | 'inferred' // a rule passed its tests
  | 'confirmed'; // Blizzard documents the rule, and no sighting contradicts it

export interface SequenceModel {
  event: 'worldBoss' | 'legion' | 'helltide';
  field: SequenceField;
  confidence: Confidence;
  state: ModelState;
  rule: Rule | null;
  test: RuleTest | null;
  points: number;
  reported: number;
  conflicts: number;
  older: number;
  /** The reset boundary the analysis starts from (-Infinity for none). */
  sinceMs: number;
  /** The segment the rule's indices belong to. */
  segment: Segment | null;
  /** Predictions stop here: the end of the segment, or the next known reset boundary. */
  validUntilMs: number;
  /** Contradictions met along the way: each restarted the learning from its sighting. */
  changes: Miss[];
  /** Start of the latest occurrence a sighting covered (the last check against the game). */
  latestMs: number | null;
  explanation: string;
}

export interface ModelInput {
  event: 'worldBoss' | 'legion' | 'helltide';
  field: SequenceField;
  observations: Observation[];
  segments: Segment[];
  nowMs: number;
  /** Instants at which an order may reset (season starts, patches). */
  boundariesMs: number[];
  /** How many values are possible (4 bosses, 7 arenas); 0 when not known. */
  domainSize: number;
  registered?: RegisteredRule[];
  realm?: Realm;
  include?: (o: Observation) => boolean;
  /** Which registered rules apply (default: those of this event and field). */
  ruleFilter?: (r: RegisteredRule) => boolean;
  maxPeriod?: number;
}

const pct = (x: number) => (x < 0.001 ? 'under 0.1%' : `${(x * 100).toFixed(x < 0.01 ? 2 : 1)}%`);
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

interface Verdict {
  state: ModelState;
  confidence: Confidence;
}

/**
 * Every restart after a contradiction is another chance for random values to look like an order,
 * so the bar rises with each one: the chance limit is divided by the number of attempts.
 */
export function testChanceLimit(restarts: number): number {
  return MAX_TEST_CHANCE / (restarts + 1);
}

function judge(rule: Rule, test: RuleTest, restarts: number): Verdict {
  if (test.contradiction) return { state: 'contradicted', confidence: 'unknown' };
  if (test.offsets.length !== 1) return { state: 'ambiguous', confidence: 'unknown' };
  if (rule.documented) return { state: 'confirmed', confidence: 'confirmed' };
  if (test.hits >= MIN_TESTS && test.chance < testChanceLimit(restarts)) return { state: 'inferred', confidence: 'inferred' };
  return { state: 'testing', confidence: 'unknown' };
}

/** Learn one rule over points, restarting after each contradiction. */
function learn(
  points: SequencePoint[], make: (from: number) => Rule | null, domain: number,
): { rule: Rule | null; test: RuleTest | null; changes: Miss[] } {
  const changes: Miss[] = [];
  let from = 0;
  for (let guard = 0; guard <= points.length; guard++) {
    const slice = points.slice(from);
    const rule = make(from);
    if (!rule) return { rule: null, test: null, changes };
    const test = testRule(rule, slice, domain);
    if (!test.contradiction) return { rule, test, changes };
    changes.push(test.contradiction);
    const at = points.findIndex((p) => p.startMs === test.contradiction!.startMs);
    // A rule that never fit even its own first points cannot be learned again from there.
    if (at <= from) return { rule, test, changes };
    from = at;
  }
  return { rule: null, test: null, changes };
}

export function buildModel(input: ModelInput): SequenceModel {
  const { event, field, nowMs } = input;
  const segment = input.segments.find((s) => nowMs >= s.fromMs && nowMs < s.untilMs) ?? null;
  const sinceMs = Math.max(-Infinity, ...input.boundariesMs.filter((b) => b <= nowMs));
  const nextBoundary = Math.min(Infinity, ...input.boundariesMs.filter((b) => b > nowMs));
  const base = {
    event, field, rule: null, test: null, segment, sinceMs, changes: [] as Miss[],
    validUntilMs: Math.min(segment?.untilMs ?? -Infinity, nextBoundary),
  };
  if (!segment) {
    return { ...base, confidence: 'unknown', state: 'no-data', points: 0, reported: 0, conflicts: 0, older: 0, latestMs: null, explanation: 'No schedule is in force now.' };
  }
  const set = sequencePoints(input.observations, event, field, {
    segments: input.segments, segment, sinceMs, realm: input.realm, include: input.include,
  });
  const { points } = set;
  const counts = { points: points.length, reported: set.reported, conflicts: set.conflicts, older: set.older, latestMs: points.at(-1)?.startMs ?? null };
  // When the number of possible values is not known (Legion sites), count the ones seen.
  const domain = Math.max(2, input.domainSize || new Set(points.map((p) => p.value)).size);

  // A registered rule first: it was written down before these sightings, so every one tests it.
  const applies = input.ruleFilter ?? ((x: RegisteredRule) => x.event === event && x.field === field);
  for (const r of (input.registered ?? []).filter(applies)) {
    const learned = learn(points, (from) => {
      const rule = registeredToRule(r, segment);
      // After a contradiction an unanchored order is pinned afresh; an anchored one cannot move.
      return from === 0 || r.anchor === null ? rule : null;
    }, domain);
    if (!learned.rule || !learned.test) continue;
    const v = judge(learned.rule, learned.test, learned.changes.length);
    if (v.state === 'inferred' || v.state === 'confirmed' || v.state === 'testing' || v.state === 'ambiguous') {
      return { ...base, ...counts, ...v, rule: learned.rule, test: learned.test, changes: learned.changes, explanation: explain(v.state, learned.rule, learned.test, learned.changes, points.length) };
    }
  }

  // Otherwise a rule found in the sightings themselves.
  const learned = learn(points, (from) => {
    const found = findRule(points.slice(from), domain, input.maxPeriod);
    return found?.rule ?? null;
  }, domain);
  if (learned.rule && learned.test) {
    const v = judge(learned.rule, learned.test, learned.changes.length);
    return { ...base, ...counts, ...v, rule: learned.rule, test: learned.test, changes: learned.changes, explanation: explain(v.state, learned.rule, learned.test, learned.changes, points.length) };
  }
  const restartFrom = learned.changes.length ? points.findIndex((p) => p.startMs === learned.changes.at(-1)!.startMs) : 0;
  const fit = cycleFit(points.slice(Math.max(0, restartFrom)).map((p) => [p.index, p.value]), domain, input.maxPeriod);
  const state: ModelState = !points.length ? 'no-data' : learned.changes.length ? 'contradicted' : fit.verdict === 'no-pattern' ? 'no-pattern' : 'collecting';
  const changeNote = learned.changes.length ? ` ${changeText(learned.changes)}` : '';
  return { ...base, ...counts, confidence: 'unknown', state, changes: learned.changes, explanation: `${fit.explanation}${changeNote}` };
}

function changeText(changes: Miss[]): string {
  const c = changes.at(-1)!;
  return `On ${day(c.startMs)} a sighting broke the order seen before (expected ${c.expected}, seen ${c.seen}): the order may have changed or reset then, or the sighting was mistyped. Sightings from then on are tested afresh.`;
}

function explain(state: ModelState, rule: Rule, test: RuleTest, changes: Miss[], points: number): string {
  const order = `${rule.sequence.length === 1 ? 'Always' : `A cycle of ${rule.sequence.length}`} (${rule.basis})`;
  const tested = `${test.hits} correct prediction${test.hits === 1 ? '' : 's'} on sightings it was not formed from`;
  const change = changes.length ? ` ${changeText(changes)}` : '';
  switch (state) {
    case 'confirmed':
      return `${order}. Documented by Blizzard; ${tested}, none wrong.${change}`;
    case 'inferred':
      return `${order}: ${tested}, none wrong (a lucky match is about ${pct(test.chance)}). Inferred, not proven: one more sighting can break it.${change}`;
    case 'testing':
      return `${order} fits the ${points} sightings so far. Being tested: ${test.hits} of ${MIN_TESTS} correct predictions needed on new sightings, none wrong yet.${change}`;
    case 'ambiguous':
      return `${order} fits, but the sightings do not yet fix where in it the next one falls. One more sighting can.${change}`;
    default:
      return `${order} was contradicted.${change}`;
  }
}

/** The predicted value for the occurrence starting at startMs, or null when there is no trusted rule. */
export function predictAt(m: SequenceModel, startMs: number): string | null {
  if (m.confidence === 'unknown' || !m.rule || !m.test || !m.segment || m.test.offsets.length !== 1) return null;
  if (startMs < m.segment.fromMs || startMs >= m.validUntilMs) return null;
  const n = m.rule.sequence.length;
  return m.rule.sequence[mod(indexAt(m.segment.schedule, startMs) + m.test.offsets[0]!, n)] ?? null;
}

/** What was seen (or reported) for the occurrence starting at startMs, newest record first. */
export function observedAt(observations: Observation[], segments: Segment[], event: ObservedEvent, startMs: number, realm?: Realm): Observation[] {
  return observations
    .filter((o) => o.event === event && o.timing !== 'none' && !(realm && o.realm && o.realm !== realm))
    .filter((o) => occurrenceOf(segments, o)?.startMs === startMs)
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
}
