import type { Capability } from '@bistoon/core';
import { TAB_KEYS, hrefOf } from '../state/route.ts';
import type { Route, TabKey } from '../state/route.ts';
import { Icon } from '../ui/icons.tsx';
import type { IconName } from '../ui/icons.tsx';

export interface NavCtx {
  can: (c: Capability) => boolean;
  isSystemAdmin: boolean;
  projectLoaded: boolean;
}

interface NavDef {
  key: TabKey;
  label: string;
  icon: IconName;
  group: string;
  visible: (c: NavCtx) => boolean;
  /** بدون پروژه هم باز می‌شود */
  global?: boolean;
}

export const NAV: readonly NavDef[] = [
  { key: 'dash', label: 'داشبورد', icon: 'dashboard', group: 'نمای کلی', visible: (c) => c.can('summary.view') },
  { key: 'rep', label: 'گزارش وضعیت', icon: 'report', group: 'نمای کلی', visible: (c) => c.can('summary.view') },
  { key: 'tasks', label: 'فعالیت‌ها', icon: 'tasks', group: 'برنامه‌ریزی', visible: (c) => c.can('schedule.view') },
  { key: 'gantt', label: 'گانت', icon: 'gantt', group: 'برنامه‌ریزی', visible: (c) => c.can('schedule.view') },
  { key: 'res', label: 'منابع', icon: 'resources', group: 'برنامه‌ریزی', visible: (c) => c.can('schedule.view') },
  { key: 'cal', label: 'تقویم کاری', icon: 'calendar', group: 'برنامه‌ریزی', visible: (c) => c.can('schedule.view') },
  { key: 'scurve', label: 'منحنی S', icon: 'scurve', group: 'کنترل', visible: (c) => c.can('schedule.view') },
  { key: 'chr', label: 'منشور و قرارداد', icon: 'charter', group: 'مالی و قرارداد', visible: (c) => c.can('charter.view') || c.can('contract.view') },
  { key: 'fin', label: 'مالی', icon: 'finance', group: 'مالی و قرارداد', visible: (c) => c.can('costs.view') },
  { key: 'ri', label: 'ریسک و مسئله', icon: 'risk', group: 'ریسک و تغییر', visible: (c) => c.can('risks.view') },
  { key: 'chg', label: 'درخواست تغییر', icon: 'change', group: 'ریسک و تغییر', visible: (c) => c.can('risks.view') },
  { key: 'dec', label: 'تصمیم‌ها', icon: 'decision', group: 'ریسک و تغییر', visible: (c) => c.can('risks.view') },
  { key: 'chat', label: 'گفتگو', icon: 'chat', group: 'همکاری', visible: (c) => c.can('chat.use') },
  { key: 'docs', label: 'مستندات', icon: 'docs', group: 'همکاری', visible: (c) => c.can('documents.view') },
  { key: 'log', label: 'گزارش تغییرات', icon: 'history', group: 'همکاری', visible: (c) => c.can('audit.view') },
  { key: 'usr', label: 'کاربران', icon: 'user', group: 'مدیریت', visible: (c) => c.isSystemAdmin || c.can('members.manage'), global: true },
  { key: 'port', label: 'مدیریت پروژه‌ها', icon: 'portfolio', group: 'مدیریت', visible: (c) => c.isSystemAdmin, global: true },
];

if (NAV.length !== TAB_KEYS.length) throw new Error('فهرست ناوبری با کلیدهای تب هم‌خوان نیست.');

export const navDef = (k: TabKey): NavDef => NAV.find((n) => n.key === k)!;

export function Nav({ route, ctx, open, onNavigate }: { route: Route; ctx: NavCtx; open: boolean; onNavigate: () => void }) {
  const groups: { name: string; items: NavDef[] }[] = [];
  for (const n of NAV) {
    if (!(n.global ? n.visible(ctx) : ctx.projectLoaded && n.visible(ctx))) continue;
    let g = groups.find((x) => x.name === n.group);
    if (!g) groups.push((g = { name: n.group, items: [] }));
    g.items.push(n);
  }
  return (
    <nav className={`nav${open ? ' open' : ''}`} aria-label="بخش‌های برنامه">
      {groups.map((g) => (
        <div key={g.name} className="nav-group">
          <div className="nav-title">{g.name}</div>
          {g.items.map((n) => (
            <a key={n.key} href={hrefOf({ pid: route.pid, tab: n.key })} aria-current={route.tab === n.key ? 'page' : undefined} onClick={onNavigate} data-testid={`nav-${n.key}`}>
              <Icon name={n.icon} />
              {n.label}
            </a>
          ))}
        </div>
      ))}
    </nav>
  );
}
