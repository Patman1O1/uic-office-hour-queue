import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationPreference } from './storage.ts';
import { alertStudent, askForNotifications, notificationPermission, stopFlashingTitle } from './notify.ts';

const show = vi.fn();
const vibrate = vi.fn();
const permissionRequest = vi.fn();
const events = new EventTarget();
const BrowserNotification = vi.fn(function () { return { close: vi.fn() }; });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { isSecureContext: true, location: { pathname: '/q/ABC234' }, focus: vi.fn() });
  vi.stubGlobal('navigator', { vibrate });
  vi.stubGlobal('document', {
    title: 'MyOfficeHours', visibilityState: 'hidden',
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  });
  vi.stubGlobal('Notification', Object.assign(BrowserNotification, { permission: 'granted', requestPermission: permissionRequest }));
  Object.assign(window, { Notification: BrowserNotification });
});
afterEach(() => { stopFlashingTitle(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('device notification consent and fallbacks', () => {
  it('requires opt-in even when browser permission was granted previously', async () => {
    await alertStudent('Next', 'Come back');
    expect(BrowserNotification).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
    expect(document.title).toContain('Next');
    stopFlashingTitle();
    expect(document.title).toBe('MyOfficeHours');
  });
  it('does not prompt or notify when denied, unsupported, or insecure', async () => {
    Object.assign(Notification, { permission: 'denied' });
    expect(await askForNotifications()).toBe(false);
    await alertStudent('Next', 'Come back', { device: true });
    expect(permissionRequest).not.toHaveBeenCalled();
    expect(BrowserNotification).not.toHaveBeenCalled();
    Object.assign(window, { isSecureContext: false });
    expect(notificationPermission()).toBe('unsupported');
  });
  it('uses the page API when no service worker is available', async () => {
    await alertStudent('Next', 'Come back', { device: true });
    expect(BrowserNotification).toHaveBeenCalledWith('Next', expect.objectContaining({ tag: 'myofficehours:/q/ABC234' }));
    expect(vibrate).toHaveBeenCalledTimes(1);
  });
  it('prompts only when requested and handles prompt failure', async () => {
    Object.assign(Notification, { permission: 'default' });
    permissionRequest.mockRejectedValueOnce(new Error('blocked'));
    expect(await askForNotifications()).toBe(false);
  });
  it('uses service-worker notifications where available and falls back on failure', async () => {
    // Fresh module so its worker registration is independent of previous tests.
    vi.resetModules();
    Object.assign(navigator, { serviceWorker: { register: vi.fn().mockResolvedValue({}), ready: Promise.resolve({ showNotification: show }) } });
    const notify = await import('./notify.ts');
    show.mockResolvedValueOnce(undefined);
    await notify.alertStudent('Next', 'Come back', { device: true, loud: false });
    expect(show).toHaveBeenCalledWith('Next', expect.objectContaining({ silent: true }));
    expect(BrowserNotification).not.toHaveBeenCalled();
    show.mockRejectedValueOnce(new Error('blocked'));
    await notify.alertStudent('Next', 'Come back', { device: true, loud: false });
    expect(BrowserNotification).toHaveBeenCalledTimes(1);
    notify.stopFlashingTitle();
  });
  it('rechecks saved opt-in if the preference changes while the worker starts', async () => {
    vi.resetModules();
    let enabled = true;
    let ready!: (worker: { showNotification: typeof show }) => void;
    Object.assign(navigator, { serviceWorker: {
      register: vi.fn().mockResolvedValue({}),
      ready: new Promise(resolve => { ready = resolve; }),
    } });
    const notify = await import('./notify.ts');
    const pending = notify.alertStudent('Next', 'Come back', { device: () => enabled });
    enabled = false;
    ready({ showNotification: show });
    await pending;
    expect(show).not.toHaveBeenCalled();
    expect(BrowserNotification).not.toHaveBeenCalled();
    notify.stopFlashingTitle();
  });
  it('persists opt-in separately for each queue and treats invalid preferences as off', () => {
    const values = new Map<string, string>();
    Object.assign(window, { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } });
    expect(notificationPreference.get('ABC234')).toBe(false);
    notificationPreference.set('ABC234', true);
    expect(notificationPreference.get('ABC234')).toBe(true);
    expect(notificationPreference.get('OTHER')).toBe(false);
    notificationPreference.set('ABC234', false);
    expect(notificationPreference.get('ABC234')).toBe(false);
    values.set('myofficehours:notifications:ABC234', '"true"');
    expect(notificationPreference.get('ABC234')).toBe(false);
  });
  it('restores the title on return without leaking visibility listeners', async () => {
    await alertStudent('Next', 'Come back');
    Object.assign(document, { visibilityState: 'visible' });
    events.dispatchEvent(new Event('visibilitychange'));
    expect(document.title).toBe('MyOfficeHours');
    expect(vi.getTimerCount()).toBe(0);
  });
});
