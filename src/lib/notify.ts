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

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

function notificationWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!registration) {
    registration = 'serviceWorker' in navigator && window.isSecureContext
      ? navigator.serviceWorker.register('/notification-worker.js')
          .then(() => navigator.serviceWorker.ready).catch(() => null)
      : Promise.resolve(null);
  }
  return registration;
}

let audio: AudioContext | null = null;

/** Create the audio context during a user gesture (e.g. tapping Join) so it can play later. */
export function primeSound(): void {
  void notificationWorker();
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume().catch(() => {});
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
let titleCleanup: (() => void) | null = null;

function flashTitle(message: string): void {
  stopFlashingTitle();
  const original = document.title;
  let on = false;
  const stop = () => {
    if (document.visibilityState === 'visible') stopFlashingTitle();
  };
  titleCleanup = () => {
    document.title = original;
    document.removeEventListener('visibilitychange', stop);
  };
  document.title = message;
  titleTimer = setInterval(() => {
    on = !on;
    document.title = on ? original : message;
  }, 1000);
  document.addEventListener('visibilitychange', stop);
}

export function stopFlashingTitle(): void {
  if (titleTimer) clearInterval(titleTimer);
  titleTimer = null;
  titleCleanup?.();
  titleCleanup = null;
}

/** Sound and in-app feedback remain available independently of device permission. */
export async function alertStudent(
  title: string, body: string,
  { loud = true, device = false }: { loud?: boolean; device?: boolean | (() => boolean) } = {},
): Promise<void> {
  const optedIn = () => typeof device === 'function' ? device() : device;
  if (loud) chime();
  if (document.visibilityState !== 'visible') flashTitle(`🔔 ${title}`);
  if (!optedIn() || notificationPermission() !== 'granted') return;
  try { if (loud) navigator.vibrate?.([300, 150, 300, 150, 600]); } catch { /* optional API */ }
  const options: NotificationOptions = {
    body, tag: `myofficehours:${window.location.pathname}`,
    requireInteraction: loud, silent: !loud,
    data: { url: window.location.pathname },
  };
  try {
    // Mobile browsers commonly require the service-worker API. Do not wait
    // indefinitely for activation: the ordinary API is still a useful fallback.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const worker = await Promise.race([
      notificationWorker(),
      new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), 1500); }),
    ]);
    clearTimeout(timeout);
    if (!optedIn() || notificationPermission() !== 'granted') return;
    if (worker) {
      try { await worker.showNotification(title, options); return; } catch { /* try desktop API */ }
    }
    const n = new Notification(title, options);
    n.onclick = () => { window.focus(); n.close(); };
  } catch {
    // Permission, OS settings, or browser policy can still prevent delivery.
  }
}
