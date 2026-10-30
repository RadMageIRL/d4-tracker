// The settings dialog: which cards show, display options, reminders and notifications.
// Every change is applied and saved at once; there is no Save button to forget.

import { describeState, notifyState, requestPermission } from './notify';
import { playChime, primeSound } from './sound';
import { h } from './dom';
import { RADAR_LEADS, REMINDER_CHOICES, type CardId, type Prefs } from '../store/prefs';

const CARD_LABELS: Record<CardId, string> = {
  helltide: 'Helltide',
  worldBoss: 'World Boss',
  legion: 'Legion',
  map: 'Sanctuary map',
  season: 'Season and timeline',
  sightings: 'Sightings log',
};

export interface SettingsHooks {
  prefs: () => Prefs;
  change: (mutate: (p: Prefs) => void) => void;
  /** Extra lines for the Data section (schedule check dates, clock check result). */
  dataLines: () => string[];
}

function chip(label: string, checked: boolean, onChange: (on: boolean) => void, type: 'checkbox' | 'radio' = 'checkbox', name?: string): HTMLLabelElement {
  const input = h('input', { type, name, checked });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'chip' }, input, label);
}

function radios<T extends string>(name: string, current: T, options: [T, string][], set: (v: T) => void): HTMLElement {
  return h('div', { class: 'options', role: 'radiogroup' },
    ...options.map(([value, label]) => chip(label, current === value, (on) => { if (on) set(value); }, 'radio', name)));
}

function leadLabel(kind: keyof typeof REMINDER_CHOICES, minutes: number): string {
  if (minutes === 0) return kind === 'helltide' ? 'When it begins' : 'When it starts';
  return `${minutes} min before`;
}

export function renderSettings(dialog: HTMLDialogElement, hooks: SettingsHooks): void {
  const p = hooks.prefs();
  const close = h('button', { class: 'btn', type: 'button' }, 'Done');
  close.addEventListener('click', () => dialog.close());

  const cards = h('fieldset', {}, h('legend', {}, 'Show'),
    h('div', { class: 'options' }, ...(Object.keys(CARD_LABELS) as CardId[]).map((id) =>
      chip(CARD_LABELS[id], p.cards[id], (on) => hooks.change((q) => { q.cards[id] = on; }))),
    ));

  const display = h('fieldset', {}, h('legend', {}, 'Display'),
    radios('theme', p.theme, [['dark', 'Dark'], ['light', 'Light']], (v) => hooks.change((q) => { q.theme = v; })),
    h('div', { class: 'options', style: 'margin-top:6px' },
      chip('Compact view', p.compact, (on) => hooks.change((q) => { q.compact = on; }))),
    h('p', { class: 'help' }, 'Compact shows just the three countdowns, sized for a narrow window on a second monitor.'),
  );

  const title = h('fieldset', {}, h('legend', {}, 'Tab title'),
    radios('title', p.title, [['next', 'Next event'], ['helltide', 'Helltide'], ['worldBoss', 'World Boss'], ['legion', 'Legion'], ['off', 'Off']],
      (v) => hooks.change((q) => { q.title = v; })),
    h('p', { class: 'help' }, 'The countdown in the browser tab while the tab is in the background, in whole minutes (the browser updates a background tab about once a minute). With the tab in view, the page\'s own name stays in the title. The pop-out window\'s title counts down all the time.'),
  );

  const time = h('fieldset', {}, h('legend', {}, 'Times'),
    radios('clock', p.clock, [['auto', 'Clock: system'], ['12h', '12-hour'], ['24h', '24-hour']], (v) => hooks.change((q) => { q.clock = v; })),
    h('div', { style: 'margin-top:6px' },
      radios('zone', p.zone, [['local', 'My time zone'], ['utc', 'UTC']], (v) => hooks.change((q) => { q.zone = v; }))),
  );

  const reminderRows = (Object.keys(REMINDER_CHOICES) as (keyof typeof REMINDER_CHOICES)[]).map((kind) => {
    const name = kind === 'worldBoss' ? 'World Boss' : kind === 'legion' ? 'Legion' : 'Helltide';
    return h('div', { style: 'margin-bottom:8px' },
      h('div', { class: 'help', style: 'margin:0 0 4px' }, name),
      h('div', { class: 'options' }, ...REMINDER_CHOICES[kind].map((m) =>
        chip(leadLabel(kind, m), p.reminders[kind].includes(m), (on) => hooks.change((q) => {
          const set = new Set(q.reminders[kind]);
          if (on) set.add(m); else set.delete(m);
          q.reminders[kind] = [...set].sort((a, b) => b - a);
        }))),
      ));
  });

  const state = notifyState();
  const described = describeState(state);
  const status = h('p', { class: `status-line ${described.ok ? 'ok' : 'warn'}` }, described.text);
  const ask = h('button', { class: 'btn', type: 'button' }, 'Allow system notifications');
  ask.addEventListener('click', async () => {
    const after = await requestPermission();
    hooks.change((q) => { q.systemNotifications = after === 'granted'; });
  });
  const systemToggle = state === 'granted'
    ? chip('Also show reminders as system notifications', p.systemNotifications, (on) => hooks.change((q) => { q.systemNotifications = on; }))
    : null;
  // Turning the sound on is a click, which lets the browser play it: a sample chime confirms it.
  const sound = chip('Play a sound with each reminder', p.reminderSound, (on) => {
    if (on) void primeSound().then(playChime);
    hooks.change((q) => { q.reminderSound = on; });
  });

  const reminders = h('fieldset', {}, h('legend', {}, 'Reminders'),
    ...reminderRows,
    h('div', { class: 'options', style: 'margin-bottom:8px' }, sound),
    h('p', { class: 'help' },
      'Reminders appear in this page and are not guaranteed. They work only while this page is open in a browser tab: in a ' +
      'background tab the browser can delay them by up to about a minute, and once the tab or browser is closed nothing is ' +
      'sent. The sound plays once you have clicked anywhere in the page since opening it (a browser rule).'),
    status,
    state === 'default' ? h('div', { style: 'margin-top:8px' }, ask) : null,
    systemToggle ? h('div', { class: 'options', style: 'margin-top:8px' }, systemToggle) : null,
  );

  const radar = h('fieldset', {}, h('legend', {}, 'Event radar'),
    h('p', { class: 'help' }, 'How long before a spawn the radar shows it, when its region is known:'),
    h('div', { style: 'margin-bottom:8px' }, h('div', { class: 'help', style: 'margin:0 0 4px' }, 'World Boss'),
      radios('radar-wb', String(p.radarLead.worldBoss), RADAR_LEADS.worldBoss.map((m) => [String(m), `${m} min`] as [string, string]),
        (v) => hooks.change((q) => { q.radarLead.worldBoss = Number(v); }))),
    h('div', { style: 'margin-bottom:8px' }, h('div', { class: 'help', style: 'margin:0 0 4px' }, 'Legion'),
      radios('radar-legion', String(p.radarLead.legion), RADAR_LEADS.legion.map((m) => [String(m), `${m} min`] as [string, string]),
        (v) => hooks.change((q) => { q.radarLead.legion = Number(v); }))),
  );

  const data = h('fieldset', {}, h('legend', {}, 'Data'),
    ...hooks.dataLines().map((line) => h('p', { class: 'help' }, line)),
    h('p', { class: 'help' }, 'Settings are saved in this browser only. Nothing is sent anywhere.'),
  );

  dialog.replaceChildren(
    h('div', { class: 'dialog-head' }, h('h2', { id: 'settings-title' }, 'Settings'), close),
    h('div', { class: 'dialog-body' }, cards, display, title, time, reminders, radar, data),
  );
}
