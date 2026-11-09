/*
 * R8 — let students know when it's their turn so they can step away.
 *
 * Uses the browser Notifications API when allowed (needs HTTPS or localhost),
 * plus vibration, a short chime, and a flashing tab title as fallbacks.
 * Text/email alerts were out of scope for the semester (proposal).
 */

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && window.isSecureContext;
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

export async function askForNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

let audio: AudioContext | null = null;

/** Create the audio context during a user gesture (e.g. tapping Join) so it can play later. */
export function primeSound(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null;
  }
}

function chime(): void {
  if (!audio) return;
  try {
    const t = audio.currentTime;
    [660, 880].forEach((freq, i) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.25, t + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.35);
      osc.connect(gain).connect(audio!.destination);
      osc.start(t + i * 0.18);
      osc.stop(t + i * 0.18 + 0.4);
    });
  } catch {
    /* ignore */
  }
}

let titleTimer: ReturnType<typeof setInterval> | null = null;

function flashTitle(message: string): void {
  stopFlashingTitle();
  const original = document.title;
  let on = false;
  titleTimer = setInterval(() => {
    on = !on;
    document.title = on ? message : original;
  }, 1000);
  const stop = () => {
    if (document.visibilityState === 'visible') {
      stopFlashingTitle();
      document.title = original;
      document.removeEventListener('visibilitychange', stop);
    }
  };
  document.addEventListener('visibilitychange', stop);
  setTimeout(stop, 0);
}

export function stopFlashingTitle(): void {
  if (titleTimer) clearInterval(titleTimer);
  titleTimer = null;
}

export function alertStudent(title: string, body: string, { loud = true } = {}): void {
  if (notificationsSupported() && Notification.permission === 'granted') {
    try {
      const n = new Notification(title, { body, tag: 'myofficehours', requireInteraction: loud });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      /* some mobile browsers only allow notifications from a service worker */
    }
  }
  if (loud) {
    navigator.vibrate?.([300, 150, 300, 150, 600]);
    chime();
  }
  if (document.visibilityState !== 'visible') flashTitle(`🔔 ${title}`);
}
