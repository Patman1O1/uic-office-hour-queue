import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import logo from '../assets/university-logo.svg';
import mark from '../assets/circle-mark.svg';
import { Link } from './Link.tsx';
import type { ConnectionState } from '../lib/socket.ts';
import { ago, timeOfDay } from '../lib/format.ts';

/* ---- Icons (inline so they inherit color) -------------------------------- */

const svg = (path: ReactNode, size = 20) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
);
export const CheckIcon = ({ size }: { size?: number }) => svg(<path d="M5 12.5l4.5 4.5L19 7.5" />, size);
export const WarnIcon = ({ size }: { size?: number }) =>
  svg(
    <>
      <path d="M12 3.5l9.5 16.5h-19z" />
      <path d="M12 10v4.5M12 17.5v.01" />
    </>,
    size,
  );
export const CopyIcon = () =>
  svg(
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6a1.5 1.5 0 00-1.5-1.5H6A1.5 1.5 0 004.5 6v8A1.5 1.5 0 006 15.5h2.5" />
    </>,
    18,
  );
export const QrIcon = () =>
  svg(
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <path d="M14 14h2v2M20 14v.01M14 20h6v-3M17 17v.01" />
    </>,
    18,
  );
export const CloseIcon = () => svg(<path d="M6 6l12 12M18 6L6 18" />, 18);

/* ---- Layout -------------------------------------------------------------- */

export function Header({ children }: { children?: ReactNode }) {
  return (
    <header className="app-header">
      <Link href="/" className="brand" aria-label="MyOfficeHours home">
        <img src={logo} alt="University of Illinois Chicago" className="brand-logo" />
        <img src={mark} alt="UIC" className="brand-mark" />
        <span className="brand-name">MyOfficeHours</span>
      </Link>
      {children}
    </header>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

/* ---- Feedback ------------------------------------------------------------ */

export function Banner({
  tone,
  icon,
  children,
  action,
}: {
  tone: 'success' | 'warning' | 'danger' | 'info';
  icon?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`banner banner-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {icon && <span className="banner-icon">{icon}</span>}
      <div className="banner-body">{children}</div>
      {action}
    </div>
  );
}

/** Fig. 19 / 24 — amber banner while the socket is down. */
export function ConnectionBanner({ state, lastUpdated }: { state: ConnectionState; lastUpdated: number | null }) {
  if (state === 'online') return null;
  return (
    <Banner tone="warning" icon={<WarnIcon />}>
      <strong>Connection lost.</strong> Showing your last known state while we reconnect and verify your membership.
      {lastUpdated && <div className="muted small">Last updated {timeOfDay(lastUpdated)}</div>}
    </Banner>
  );
}

/** Fig. 10 — green dot + "Updated just now". */
export function LiveIndicator({ state, lastUpdated, now }: { state: ConnectionState; lastUpdated: number | null; now: number }) {
  const live = state === 'online';
  return (
    <span className={`live ${live ? 'is-live' : 'is-stale'}`}>
      <span className="live-dot" aria-hidden="true" />
      {live ? `Updated ${lastUpdated ? ago(now - lastUpdated) : 'just now'}` : 'Not updating'}
    </span>
  );
}

/* ---- Modal (Fig. 12 / 26) ------------------------------------------------- */

export function Modal({
  title,
  children,
  onClose,
  actions,
}: {
  title: string;
  children?: ReactNode;
  onClose: () => void;
  actions: ReactNode;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
      if (e.key !== 'Tab') return;
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') ?? []);
      const first = items[0], last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={id} ref={ref}>
        <h2 id={id}>{title}</h2>
        {children && <div className="modal-body">{children}</div>}
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  );
}

/* ---- Forms ----------------------------------------------------------------- */

export function Field({
  label,
  hint,
  children,
  optional,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} {optional && <span className="muted">(optional)</span>}
      </label>
      {children(id)}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function CopyButton({ text, label = 'Copy Link', className = 'btn btn-secondary' }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for http:// on a LAN IP, where the clipboard API is blocked.
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button type="button" className={className} onClick={copy}>
      {copied ? <CheckIcon size={18} /> : <CopyIcon />}
      {copied ? 'Copied' : label}
    </button>
  );
}

export function QrCode({ value, size = 280 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { width: size * 2, margin: 1, color: { dark: '#001E62', light: '#FFFFFF' } })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [value, size]);
  return (
    <div className="qr" style={{ width: size, height: size }}>
      {src ? <img src={src} width={size} height={size} alt={`QR code for ${value}`} /> : null}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
