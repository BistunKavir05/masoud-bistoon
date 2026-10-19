import { useSyncExternalStore } from 'react';

export const TAB_KEYS = ['dash', 'gantt', 'tasks', 'res', 'chr', 'fin', 'scurve', 'ri', 'chg', 'dec', 'cal', 'rep', 'chat', 'docs', 'usr', 'port', 'log'] as const;
export type TabKey = (typeof TAB_KEYS)[number];

export interface Route {
  pid: number | null;
  tab: TabKey;
}

const isTab = (s: string | undefined): s is TabKey => (TAB_KEYS as readonly string[]).includes(s ?? '');

/** `#/p/12/tasks` یا `#/usr` */
export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  let pid: number | null = null;
  if (parts[0] === 'p' && /^\d+$/.test(parts[1] ?? '')) {
    pid = Number(parts[1]);
    parts.splice(0, 2);
  }
  const tab = isTab(parts[0]) ? parts[0] : 'dash';
  return { pid, tab };
}

export const hrefOf = (r: Route): string => `#/${r.pid !== null ? `p/${r.pid}/` : ''}${r.tab}`;

export function navigate(r: Route, replace = false): void {
  const h = hrefOf(r);
  if (replace) location.replace(h);
  else location.hash = h;
}

const subscribe = (fn: () => void): (() => void) => {
  window.addEventListener('hashchange', fn);
  return () => window.removeEventListener('hashchange', fn);
};

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  return parseHash(hash);
}
