import { useEffect, useState } from 'react';
import { Role } from '../../shared/protocol.ts';

/** Re-render every `ms` with the current time (timers, "updated 2 min ago"). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** 2:05, 12:40, 1:02:03 */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "~15 min", "< 1 min" */
export function approxMinutes(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return '< 1 min';
  if (min < 60) return `~${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `~${h} h ${rest} min` : `~${h} h`;
}

/** "2:14 PM" */
export function timeOfDay(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function ago(ms: number): string {
  if (ms < 15_000) return 'just now';
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  return `${Math.floor(ms / 60_000)} min ago`;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export function roleLabel(role: Role): string {
  return role === Role.INSTRUCTOR ? 'Instructor' : 'TA';
}

/** ABC234 → "ABC 234" for reading aloud / off a screen. */
export function spacedCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
