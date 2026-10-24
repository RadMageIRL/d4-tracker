// Preferences in localStorage. One origin can host several apps (a github.io account serves
// every project it has), so every key carries this app's prefix. Storage can be missing, full or
// blocked (private windows, blocked site data); every call then degrades to the defaults, and
// anything malformed or out of range in what was saved is replaced by its default.

import type { ClockStyle } from '../engine/format';
import { TITLE_CHOICES, type TitleChoice } from '../engine/title';

export const PREFIX = 'd4-tracker:v1:';
const KEY = 'prefs';

export type Theme = 'dark' | 'light';
export type ZoneChoice = 'local' | 'utc';
export type CardId = 'helltide' | 'worldBoss' | 'legion' | 'map' | 'season' | 'sightings';
export type LayerId = 'regions' | 'worldBoss' | 'legion' | 'waypoint' | 'helltide' | 'chests';
export type ConfidenceId = 'confirmed' | 'inferred' | 'unknown';
/** Any: chest marks from both realms count; otherwise only that realm's (and those with none noted). */
export type RealmChoice = 'any' | 'seasonal' | 'eternal';
export type RadarId = 'helltide' | 'worldBoss' | 'legion';
export const RADAR_IDS: RadarId[] = ['helltide', 'worldBoss', 'legion'];
/** How many minutes before a spawn the event radar shows it. */
export const RADAR_LEADS = { worldBoss: [15, 30, 60], legion: [5, 10, 15] } as const;

/** The lead times offered for each event, in minutes (0 = when it starts). */
export const REMINDER_CHOICES = {
  worldBoss: [15, 10, 5],
  legion: [5],
  helltide: [0],
} as const;

export interface Prefs {
  cards: Record<CardId, boolean>;
  layers: Record<LayerId, boolean>;
  compact: boolean;
  theme: Theme;
  clock: ClockStyle;
  zone: ZoneChoice;
  /** Chosen lead times per event; empty means no reminder. */
  reminders: { worldBoss: number[]; legion: number[]; helltide: number[] };
  /** The player asked for system notifications (the browser's permission is separate). */
  systemNotifications: boolean;
  /** What the browser tab title counts down to. */
  title: TitleChoice;
  /** Which confidence levels the atlas shows. */
  confidences: Record<ConfidenceId, boolean>;
  /** The realm the player plays: chest marks from the other realm are not shown as active. */
  realm: RealmChoice;
  /** Which events the event radar shows. */
  radar: Record<RadarId, boolean>;
  /** Minutes before a spawn its radar marker appears. */
  radarLead: { worldBoss: number; legion: number };
}

export const CARD_IDS: CardId[] = ['helltide', 'worldBoss', 'legion', 'map', 'season', 'sightings'];
export const LAYER_IDS: LayerId[] = ['regions', 'worldBoss', 'legion', 'waypoint', 'helltide', 'chests'];
export const CONFIDENCE_IDS: ConfidenceId[] = ['confirmed', 'inferred', 'unknown'];

export function defaultPrefs(): Prefs {
  return {
    cards: { helltide: true, worldBoss: true, legion: true, map: true, season: true, sightings: true },
    layers: { regions: true, worldBoss: true, legion: true, waypoint: true, helltide: true, chests: true },
    compact: false,
    theme: 'dark',
    clock: 'auto',
    zone: 'local',
    reminders: { worldBoss: [], legion: [], helltide: [] },
    systemNotifications: false,
    title: 'next',
    confidences: { confirmed: true, inferred: true, unknown: true },
    realm: 'any',
    radar: { helltide: true, worldBoss: true, legion: true },
    radarLead: { worldBoss: 30, legion: 10 },
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pickBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function pickOne<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function pickLeads(v: unknown, allowed: readonly number[]): number[] {
  if (!Array.isArray(v)) return [];
  const kept = allowed.filter((n) => v.includes(n));
  return [...kept].sort((a, b) => b - a);
}

/** Turn whatever was stored into valid Prefs, keeping each valid field. */
export function sanitize(raw: unknown): Prefs {
  const d = defaultPrefs();
  if (!isRecord(raw)) return d;
  const cards = isRecord(raw.cards) ? raw.cards : {};
  const layers = isRecord(raw.layers) ? raw.layers : {};
  const rem = isRecord(raw.reminders) ? raw.reminders : {};
  const conf = isRecord(raw.confidences) ? raw.confidences : {};
  const radar = isRecord(raw.radar) ? raw.radar : {};
  const lead = isRecord(raw.radarLead) ? raw.radarLead : {};
  const pickLead = (v: unknown, allowed: readonly number[], fallback: number) => (typeof v === 'number' && allowed.includes(v) ? v : fallback);
  return {
    cards: Object.fromEntries(CARD_IDS.map((id) => [id, pickBool(cards[id], d.cards[id])])) as Prefs['cards'],
    layers: Object.fromEntries(LAYER_IDS.map((id) => [id, pickBool(layers[id], d.layers[id])])) as Prefs['layers'],
    compact: pickBool(raw.compact, d.compact),
    theme: pickOne(raw.theme, ['dark', 'light'] as const, d.theme),
    clock: pickOne(raw.clock, ['auto', '12h', '24h'] as const, d.clock),
    zone: pickOne(raw.zone, ['local', 'utc'] as const, d.zone),
    reminders: {
      worldBoss: pickLeads(rem.worldBoss, REMINDER_CHOICES.worldBoss),
      legion: pickLeads(rem.legion, REMINDER_CHOICES.legion),
      helltide: pickLeads(rem.helltide, REMINDER_CHOICES.helltide),
    },
    systemNotifications: pickBool(raw.systemNotifications, d.systemNotifications),
    title: pickOne(raw.title, TITLE_CHOICES, d.title),
    confidences: Object.fromEntries(CONFIDENCE_IDS.map((id) => [id, pickBool(conf[id], d.confidences[id])])) as Prefs['confidences'],
    realm: pickOne(raw.realm, ['any', 'seasonal', 'eternal'] as const, d.realm),
    radar: Object.fromEntries(RADAR_IDS.map((id) => [id, pickBool(radar[id], d.radar[id])])) as Prefs['radar'],
    radarLead: {
      worldBoss: pickLead(lead.worldBoss, RADAR_LEADS.worldBoss, d.radarLead.worldBoss),
      legion: pickLead(lead.legion, RADAR_LEADS.legion, d.radarLead.legion),
    },
  };
}

/** The storage the app uses, or null when the browser refuses access. */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadPrefs(store: Storage | null = storage()): Prefs {
  try {
    const text = store?.getItem(PREFIX + KEY);
    return sanitize(text == null ? null : JSON.parse(text));
  } catch {
    return defaultPrefs();
  }
}

/** Save; returns false when the browser did not keep it. */
export function savePrefs(prefs: Prefs, store: Storage | null = storage()): boolean {
  try {
    if (!store) return false;
    store.setItem(PREFIX + KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}
