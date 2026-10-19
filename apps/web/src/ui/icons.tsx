import type { ReactNode } from 'react';

const P: Record<string, ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  gantt: <><path d="M3 6h9M7 12h12M5 18h8" /><path d="M3 3v18" /></>,
  tasks: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="m3.5 6 1.2 1.2L6.6 5M3.5 12l1.2 1.2L6.6 11M3.5 18l1.2 1.2L6.6 17" /></>,
  resources: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16.5 5.2a3 3 0 0 1 0 5.6M18 14.4c1.8.8 3 2.7 3 5.6" /></>,
  charter: <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h7M9 17h7" /></>,
  finance: <><circle cx="12" cy="12" r="9" /><path d="M14.5 9c-.5-.9-1.5-1.4-2.5-1.4-1.5 0-2.6.8-2.6 2s1 1.7 2.6 2.1c1.6.4 2.6.9 2.6 2.1s-1.1 2-2.6 2c-1.100 0-2.100-.5-2.600-1.500M12 6v1.600M12 16.400V18" /></>,
  scurve: <><path d="M3 20h18M3 4v16" /><path d="M5 18c4 0 3-12 7-12s3 12 7 12" /></>,
  risk: <><path d="M12 3 2.500 20h19z" /><path d="M12 10v4.500M12 17.500v.5" /></>,
  change: <><path d="M4 8h13l-3-3M20 16H7l3 3" /></>,
  decision: <><path d="M5 20h8M9 14l7-7 3 3-7 7z" /><path d="m13 4 3 3" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  report: <><path d="M7 3h10v18H7z" /><path d="M10 8h4M10 12h4M10 16h2" /></>,
  chat: <><path d="M4 5h16v11H9l-5 4z" /></>,
  docs: <><path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1" /><path d="M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.600-7 8-7s8 3 8 7" /></>,
  portfolio: <><path d="M3 7h6l2 2h10v10H3z" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.700L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16z" /></>,
  up: <path d="m6 14 6-6 6 6" />,
  down: <path d="m6 10 6 6 6-6" />,
  left: <path d="m14 6-6 6 6 6" />,
  right: <path d="m10 6 6 6-6 6" />,
  indent: <><path d="M3 5h18M13 10h8M13 15h8M3 20h18M3 9l4 3-4 3z" /></>,
  outdent: <><path d="M3 5h18M13 10h8M13 15h8M3 20h18M7 9l-4 3 4 3z" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.500 1.500M17.500 17.500 19 19M5 19l1.500-1.500M17.500 6.500 19 5" /></>,
  moon: <path d="M20 14.500A8 8 0 0 1 9.500 4 8 8 0 1 0 20 14.500z" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  download: <><path d="M12 4v11m-4-4 4 4 4-4M4 20h16" /></>,
  upload: <><path d="M12 15V4m-4 4 4-4 4 4M4 20h16" /></>,
  x: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m5 12.500 4.500 4.500L19 7" />,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.300-5.700L20 8" /><path d="M20 3v5h-5" /></>,
  logout: <><path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9" /></>,
  search: <><circle cx="11" cy="11" r="6.500" /><path d="m16 16 5 5" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></>,
  print: <><path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z" /></>,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
};

export type IconName = keyof typeof P;

export function Icon({ name, size }: { name: IconName; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size ?? 18} height={size ?? 18} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {P[name]}
    </svg>
  );
}

/** نشان برنامه: خطوط کنده‌کاری‌شده‌ی سنگ‌نگاره (سه ردیف پله‌ای) */
export function BrandGlyph() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="28" height="28" rx="7" fill="currentColor" opacity="0.14" />
      <path d="M8 10h10M8 16h16M8 22h12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
