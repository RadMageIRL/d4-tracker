// System notifications, behind feature checks. The page reports exactly what the browser can do
// and never promises more: notifications come from this page's own timers, so they need the page
// open in a tab, they can arrive late in a background tab, and closing the tab stops them.

export type NotifyState =
  | 'unsupported' // no Notification API (for example Safari on iPhone outside an installed web app)
  | 'insecure' // not https or localhost; browsers refuse notifications there
  | 'default' // not asked yet
  | 'granted'
  | 'denied'
  | 'blocked'; // the API exists but this browser will not show a page notification (Android Chrome)

let constructorBlocked = false;

export function notifyState(): NotifyState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  if (constructorBlocked) return 'blocked';
  return Notification.permission as NotifyState;
}

export async function requestPermission(): Promise<NotifyState> {
  const state = notifyState();
  if (state !== 'default') return state;
  try {
    await Notification.requestPermission();
  } catch {
    // Old callback-only implementations; the state read below tells the outcome.
  }
  return notifyState();
}

/** Show a system notification if allowed. Returns true when the browser accepted it. */
export function showSystemNotification(title: string, body: string, tag: string): boolean {
  if (notifyState() !== 'granted') return false;
  try {
    // The tag makes a second open tab replace the notification instead of stacking a copy.
    new Notification(title, { body, tag });
    return true;
  } catch {
    // Android Chrome throws here: it only shows notifications through a service worker.
    constructorBlocked = true;
    return false;
  }
}

export function describeState(state: NotifyState): { text: string; ok: boolean } {
  switch (state) {
    case 'granted':
      return { text: 'System notifications are allowed for this site.', ok: true };
    case 'default':
      return { text: 'System notifications are off until you allow them.', ok: false };
    case 'denied':
      return { text: 'System notifications are blocked for this site in your browser settings. Reminders still appear in the page.', ok: false };
    case 'insecure':
      return { text: 'This address is not secure (https), so the browser will not show system notifications. Reminders still appear in the page.', ok: false };
    case 'blocked':
      return { text: 'This browser only shows notifications from installed apps, so reminders appear in the page only.', ok: false };
    case 'unsupported':
    default:
      return { text: 'This browser does not support system notifications from web pages. Reminders still appear in the page.', ok: false };
  }
}
