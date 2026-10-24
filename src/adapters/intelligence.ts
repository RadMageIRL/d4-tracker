// Details from the player's own sightings and from the orders those sightings bear out. For each
// occurrence, in this order of trust:
//   1. seen in game for this very occurrence (the player's log, or our shared data)
//   2. reported to the player by someone else (shown as such, never as seen)
//   3. predicted from an order that is Inferred or Confirmed (src/engine/prediction.ts)
//   4. otherwise unknown, with the reason
// A sighting belongs to one occurrence, so it stops showing when that event is over.
//
// Two things run side by side and are kept apart: a Helltide in a base-game region and one in an
// expansion region, and every fourth World Boss's second boss in an expansion arena.

import type { EventDetails, EventKind } from '../engine/events';
import { known, unknown, type Fact } from '../engine/facts';
import { isSeen, type Observation } from '../engine/observations';
import {
  buildModel, observedAt, PAIR_JOIN, predictAt, type RegisteredRule, type SequenceField, type SequenceModel,
} from '../engine/prediction';
import type { RadarPrediction } from '../engine/radar';
import type { Occurrence } from '../engine/schedule';
import type { Segment } from '../engine/segments';
import type { DetailReasons } from './offline-details';
import type { DetailsSource } from './types';

export interface IntelligenceInput {
  reasons: DetailReasons;
  /** Shared and local sightings together. */
  sightings: () => Observation[];
  segments: (kind: EventKind) => Segment[];
  registered: RegisteredRule[];
  /** Season starts and other moments an order may reset. */
  boundaries: number[];
  regions: { id: string; name: string; release: string }[];
  arenas: { name: string; region: string }[];
  bosses: string[];
  /** Legion sites by name, to place a logged site in its region. */
  sites?: { name: string; region: string }[];
  /** A record from the repository's shared data (shown to every visitor), not the player's own. */
  isShared?: (o: Observation) => boolean;
}

export interface ModelSpec {
  /** Unique within the event. */
  key: string;
  field: SequenceField;
  /** For the card, e.g. "Boss order". */
  label: string;
  /** How many values are possible (0: count the ones seen). */
  domain: number;
  include?: (o: Observation) => boolean;
}

export type Models = Record<string, SequenceModel>;

export interface Prediction {
  identity?: string;
  location?: string;
}

export class IntelligenceDetailsSource implements DetailsSource {
  readonly id = 'intelligence';
  readonly label = 'your own sightings, and the orders they bear out (none until enough are logged)';
  private cache = new Map<EventKind, { key: unknown[]; models: Models }>();
  private specList: Record<EventKind, ModelSpec[]>;
  private expansionRegions: Set<string>;
  private expansionArenas: Set<string>;

  constructor(private input: IntelligenceInput) {
    this.expansionRegions = new Set(input.regions.filter((r) => r.release !== 'base').map((r) => r.id));
    this.expansionArenas = new Set(input.arenas.filter((a) => this.expansionRegions.has(a.region)).map((a) => a.name));
    const base = input.regions.filter((r) => r.release === 'base').map((r) => r.id);
    const baseArenas = input.arenas.length - this.expansionArenas.size;
    const isBase = (o: Observation) => !!o.region && base.includes(o.region);
    const isExpansion = (o: Observation) => !!o.region && this.expansionRegions.has(o.region);
    this.specList = {
      worldBoss: [
        { key: 'boss', field: 'boss', label: 'Boss order', domain: input.bosses.length, include: (o) => this.isMainSpawn(o) },
        { key: 'place', field: 'place', label: 'Arena order', domain: baseArenas, include: (o) => this.isMainSpawn(o) },
        { key: 'pair', field: 'pair', label: 'Boss and arena order', domain: input.bosses.length * baseArenas, include: (o) => this.isMainSpawn(o) },
      ],
      legion: [
        { key: 'place', field: 'place', label: 'Site order', domain: 0 },
        { key: 'region', field: 'region', label: 'Region order', domain: input.regions.length },
      ],
      helltide: [
        { key: 'base', field: 'region', label: 'Base-game region order', domain: base.length, include: isBase },
        { key: 'expansion', field: 'region', label: 'Expansion region order', domain: this.expansionRegions.size, include: isExpansion },
      ],
    };
  }

  /** A World Boss sighting of the main spawn: not in an expansion region or arena. */
  isMainSpawn(o: Observation): boolean {
    return !(o.region && this.expansionRegions.has(o.region)) && !(o.place && this.expansionArenas.has(o.place));
  }

  specs(kind: EventKind): ModelSpec[] {
    return this.specList[kind];
  }

  /** The order models for one event, recomputed only when the sightings or the schedule in force change. */
  models(kind: EventKind, nowMs: number): Models {
    const segs = this.input.segments(kind);
    const seg = segs.find((s) => nowMs >= s.fromMs && nowMs < s.untilMs) ?? null;
    const since = Math.max(-Infinity, ...this.input.boundaries.filter((b) => b <= nowMs));
    const next = Math.min(Infinity, ...this.input.boundaries.filter((b) => b > nowMs));
    const sightings = this.input.sightings();
    const key = [sightings, seg, since, next];
    const hit = this.cache.get(kind);
    if (hit && hit.key.every((k, i) => k === key[i])) return hit.models;
    const models: Models = {};
    for (const spec of this.specList[kind]) {
      const allowed = (v: string) => (spec.include ? spec.include({ id: 'x', event: kind, at: '', timing: 'start', recordedAt: '', region: v, place: v }) : true);
      models[spec.key] = buildModel({
        event: kind, field: spec.field, observations: sightings, segments: segs, nowMs,
        boundariesMs: this.input.boundaries, domainSize: spec.domain, registered: this.input.registered,
        include: spec.include,
        // A registered order applies to the spec whose sightings it describes.
        ruleFilter: (r) => r.event === kind && r.field === spec.field && r.sequence.every(allowed),
      });
    }
    this.cache.set(kind, { key, models });
    return models;
  }

  /** What the trusted orders say about the occurrence starting at startMs. */
  predicted(kind: EventKind, startMs: number, nowMs: number): Prediction {
    const m = this.models(kind, nowMs);
    const at = (key: string) => (m[key] ? predictAt(m[key]!, startMs) : null);
    const out: Prediction = {};
    if (kind === 'worldBoss') {
      const [pairBoss, pairPlace] = at('pair')?.split(PAIR_JOIN) ?? [];
      const boss = pairBoss ?? at('boss');
      const place = pairPlace ?? at('place');
      if (boss) out.identity = boss;
      if (place) out.location = this.placeLabel('worldBoss', place, undefined);
    } else if (kind === 'helltide') {
      const regions = [at('base'), at('expansion')].filter((r): r is string => !!r).map((r) => this.regionName(r));
      if (regions.length) out.location = regions.join(' and ');
    } else {
      const place = at('place');
      const region = at('region');
      if (place) out.location = this.placeLabel('legion', place, undefined);
      else if (region) out.location = this.regionName(region);
    }
    return out;
  }

  /**
   * What the trusted orders (Inferred or Confirmed) say about an occurrence, as raw ids for the
   * event radar. A predicted boss without a predicted place gives no region, so it lights nothing.
   */
  radarPredictions(kind: EventKind, startMs: number, nowMs: number): RadarPrediction[] {
    const m = this.models(kind, nowMs);
    const trusted = (key: string): { v: string; confidence: 'confirmed' | 'inferred' } | null => {
      const model = m[key];
      const v = model ? predictAt(model, startMs) : null;
      return model && v ? { v, confidence: model.confidence === 'confirmed' ? 'confirmed' : 'inferred' } : null;
    };
    if (kind === 'worldBoss') {
      const pair = trusted('pair');
      if (pair) {
        const [boss, place] = pair.v.split(PAIR_JOIN);
        return place ? [{ place, ...(boss ? { boss } : {}), confidence: pair.confidence }] : [];
      }
      const place = trusted('place');
      const boss = trusted('boss');
      if (!place) return [];
      const confidence = place.confidence === 'confirmed' && (!boss || boss.confidence === 'confirmed') ? 'confirmed' : 'inferred';
      return [{ place: place.v, ...(boss ? { boss: boss.v } : {}), confidence }];
    }
    if (kind === 'helltide') {
      return ['base', 'expansion'].map(trusted).filter((r): r is NonNullable<typeof r> => !!r).map((r) => ({ region: r.v, confidence: r.confidence }));
    }
    const place = trusted('place');
    if (place) return [{ place: place.v, confidence: place.confidence }];
    const region = trusted('region');
    return region ? [{ region: region.v, confidence: region.confidence }] : [];
  }

  regionName(id: string): string {
    return this.input.regions.find((r) => r.id === id)?.name ?? id;
  }

  /** The region of a named World Boss arena or Legion site, from the data. */
  placeRegion(kind: EventKind, place: string): string | undefined {
    const list = kind === 'worldBoss' ? this.input.arenas : kind === 'legion' ? (this.input.sites ?? []) : [];
    return list.find((x) => x.name === place)?.region;
  }

  /** "Seared Basin, Kehjistan": a place with its region when the region is known. */
  placeLabel(kind: EventKind, place: string | undefined, region: string | undefined): string | undefined {
    const r = region ?? (place ? this.placeRegion(kind, place) : undefined);
    if (place && r) return `${place}, ${this.regionName(r)}`;
    return place ?? (r ? this.regionName(r) : undefined);
  }

  /**
   * The card's details for one occurrence. They follow the same rule as the event radar, so the
   * card and the map tell the same story: a value is shown only when it was seen in game (by the
   * player, for this occurrence) or predicted by an order the sightings bore out (labeled). The
   * player's own unchecked reports appear only as a hint ("reported: ..., not checked").
   */
  details(kind: EventKind, occurrence: Occurrence | null, nowMs: number): EventDetails {
    const r = this.input.reasons[kind];
    const fallbackLocation = unknown(r.location.reason, r.location.hint);
    const fallbackIdentity = r.identity ? unknown(r.identity.reason, r.identity.hint) : undefined;
    const withIdentity = (location: Fact<string>, identity: Fact<string> | undefined): EventDetails =>
      (identity ? { location, identity } : { location });
    if (!occurrence) return withIdentity(fallbackLocation, fallbackIdentity);

    // Unchecked records that are research, not news, are left out entirely: a third-party
    // prediction (showing it would relay another tracker's prediction) and any report in the
    // shared data (it would reach every visitor).
    const here = observedAt(this.input.sightings(), this.input.segments(kind), kind, occurrence.startMs)
      .filter((o) => isSeen(o) || (!o.thirdParty && !this.input.isShared?.(o)));
    const regionOf = (o: Observation) => (o.region ? this.regionName(o.region) : undefined);
    const distinct = (values: (string | undefined)[]) => [...new Set(values.filter((v): v is string => !!v))];
    /** What was seen (a fact), and what was only reported (for a hint). */
    const gather = (list: Observation[], value: (o: Observation) => string | undefined) => {
      const seen = distinct(list.filter(isSeen).map(value));
      const told = distinct(list.filter((o) => !isSeen(o)).map(value)).filter((v) => !seen.includes(v));
      const source = told.length ? `Seen in game for this one. Also reported to you, not checked: ${told.join(' and ')}.` : 'Seen in game for this one';
      return { fact: seen.length ? known(seen.join(' and '), source, 'seen') : null, told };
    };
    const orElse = (g: { fact: Fact<string> | null; told: string[] }, predicted: Fact<string> | null, fallback: Fact<string>): Fact<string> => {
      if (g.fact) return g.fact;
      if (predicted) return predicted;
      if (g.told.length && !fallback.known) {
        return unknown(`${fallback.reason} Reported to you, not checked in game: ${g.told.join(' and ')}.`, `reported: ${g.told.join(' and ')}, not checked`);
      }
      return fallback;
    };
    const models = this.models(kind, nowMs);
    const p = this.predicted(kind, occurrence.startMs, nowMs);
    const predictedFact = (value: string | undefined, keys: string[]): Fact<string> | null => {
      if (!value) return null;
      const m = keys.map((k) => models[k]).find((x) => x && predictAt(x, occurrence.startMs));
      return known(value, m?.explanation ?? 'Predicted', 'predicted', m?.confidence === 'confirmed' ? 'confirmed' : 'inferred');
    };

    if (kind === 'helltide') {
      // Regions in the data's order (base-game first), whatever order they were logged in.
      const order = (o: Observation) => this.input.regions.findIndex((x) => x.id === o.region);
      const sorted = [...here].sort((a, b) => order(a) - order(b));
      return { location: orElse(gather(sorted, regionOf), predictedFact(p.location, ['base', 'expansion']), fallbackLocation) };
    }
    if (kind === 'legion') {
      const where = (o: Observation) => this.placeLabel('legion', o.place, o.region);
      return { location: orElse(gather(here, where), predictedFact(p.location, ['place', 'region']), fallbackLocation) };
    }
    // World Boss: the main spawn first; a second boss in an expansion arena is added as "also".
    const main = here.filter((o) => this.isMainSpawn(o));
    const extra = here.filter((o) => !this.isMainSpawn(o));
    const both = (value: (o: Observation) => string | undefined) => {
      const a = gather(main, value);
      const b = gather(extra, value);
      let fact = a.fact;
      if (b.fact) fact = fact ? { ...fact, value: `${fact.value}; also ${b.fact.value}` } : known(`also ${b.fact.value}`, b.fact.source, 'seen');
      return { fact, told: [...a.told, ...b.told.map((v) => `also ${v}`)] };
    };
    const where = (o: Observation) => this.placeLabel('worldBoss', o.place, o.region);
    const location = orElse(both(where), predictedFact(p.location, ['pair', 'place']), fallbackLocation);
    const identity = fallbackIdentity ? orElse(both((o) => o.boss), predictedFact(p.identity, ['pair', 'boss']), fallbackIdentity) : undefined;
    return withIdentity(location, identity);
  }
}
