import { useSyncExternalStore } from 'react';

/* A tiny history-API router: /, /new, /q/:code, /host/:code?key=… */

const subscribe = (cb: () => void) => {
  window.addEventListener('popstate', cb);
  return () => window.removeEventListener('popstate', cb);
};

export function useLocation(): { path: string; params: URLSearchParams } {
  const href = useSyncExternalStore(subscribe, () => window.location.pathname + window.location.search);
  const url = new URL(href, window.location.origin);
  return { path: url.pathname, params: url.searchParams };
}

export function navigate(to: string, { replace = false } = {}): void {
  if (replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo(0, 0);
}
