// The reminder chime, made in the page with Web Audio (no sound file, nothing fetched). Browsers
// keep a page silent until the player has clicked or typed in it, so the audio is started from
// such a gesture and the chime only plays once it is running.

let audio: AudioContext | null = null;

/** Start (or resume) the audio from a click or key press; resolves once it is running or refused. */
export async function primeSound(): Promise<void> {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') await audio.resume();
  } catch {
    // No Web Audio in this browser, or it refused: reminders stay silent.
  }
}

/** Two short rising tones. Returns false when the browser has not allowed sound yet. */
export function playChime(): boolean {
  if (!audio || audio.state !== 'running') return false;
  const t = audio.currentTime;
  for (const [i, freq] of [[0, 880], [1, 1175]] as const) {
    const at = t + i * 0.18;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.2, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
    osc.connect(gain).connect(audio.destination);
    osc.start(at);
    osc.stop(at + 0.4);
  }
  return true;
}

/** Prime the audio on the page's first click or key press while `wanted()` says sound is on. */
export function primeOnGesture(wanted: () => boolean): void {
  const go = () => {
    if (!wanted()) return;
    void primeSound().then(() => {
      if (audio?.state === 'running') for (const t of ['pointerdown', 'keydown']) document.removeEventListener(t, go, true);
    });
  };
  for (const t of ['pointerdown', 'keydown']) document.addEventListener(t, go, true);
}
