import { useEffect, useRef, useState } from 'react';
import { ROLE_LABELS } from '@bistoon/core';
import type { ProjectListItem } from '@bistoon/core';
import { apiPatch, apiPost } from '../api/client.ts';
import { faDate } from '../lib/fmt.ts';
import { currentTheme, toggleTheme } from '../lib/theme.ts';
import { closeProject, openProject, reloadProject, useCan, useProjectState } from '../state/project.ts';
import { navigate, useRoute } from '../state/route.ts';
import { logout, sessionStore } from '../state/session.ts';
import { useStore } from '../state/store.ts';
import { Alert, Badge, Btn, Loading, TextField, useAction } from '../ui/controls.tsx';
import { DateField } from '../ui/DateField.tsx';
import { openDialog, toast } from '../ui/dialogs.tsx';
import { BrandGlyph, Icon } from '../ui/icons.tsx';
import { NewProjectForm } from '../dataio/NewProject.tsx';
import { ExportMenu } from '../dataio/ExportMenu.tsx';
import { TabView } from '../tabs/TabView.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { Nav, navDef } from './Nav.tsx';
import type { NavCtx } from './Nav.tsx';

const LAST_KEY = 'bistoon.lastProject';

function lastProject(): number | null {
  try {
    const v = Number(localStorage.getItem(LAST_KEY));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function pickProject(list: readonly ProjectListItem[]): number | null {
  const last = lastProject();
  if (last && list.some((p) => p.id === last)) return last;
  return (list.find((p) => !p.archived) ?? list[0])?.id ?? null;
}

export function Shell() {
  const route = useRoute();
  const user = useStore(sessionStore, (s) => s.user)!;
  const projects = useStore(sessionStore, (s) => s.projects);
  const ps = useProjectState();
  const can = useCan();
  const [navOpen, setNavOpen] = useState(false);

  // بدون شناسه‌ی پروژه در نشانی: پروژه‌ی آخر یا اولین پروژه
  useEffect(() => {
    if (route.pid === null && projects.length > 0) {
      const pid = pickProject(projects);
      if (pid !== null) navigate({ pid, tab: route.tab }, true);
    }
  }, [route.pid, route.tab, projects]);

  useEffect(() => {
    if (route.pid !== null) {
      try {
        localStorage.setItem(LAST_KEY, String(route.pid));
      } catch {
        /* ذخیره‌ی ترجیح ضروری نیست */
      }
      void openProject(route.pid);
    } else {
      closeProject();
    }
  }, [route.pid]);

  const ctx: NavCtx = { can, isSystemAdmin: user.isSystemAdmin, projectLoaded: ps.status === 'ready' };
  const def = navDef(route.tab);
  const allowed = def.global ? def.visible(ctx) : ps.status === 'ready' && def.visible(ctx);

  return (
    <div className="shell">
      <Topbar projects={projects} pid={route.pid} onMenu={() => setNavOpen((o) => !o)} />
      <Nav route={route} ctx={ctx} open={navOpen} onNavigate={() => setNavOpen(false)} />
      <main className="main" id="main" tabIndex={-1}>
        {route.pid === null && projects.length === 0 ? (
          <NoProject isAdmin={user.isSystemAdmin} />
        ) : ps.status === 'error' && !def.global ? (
          <Alert kind="bad">
            <strong>پروژه باز نشد.</strong> {ps.error}
            <div className="row" style={{ marginTop: 8 }}>
              <Btn onClick={async () => { if (route.pid !== null) await openProject(route.pid); }}>تلاش دوباره</Btn>
            </div>
          </Alert>
        ) : !def.global && ps.status !== 'ready' ? (
          <Loading text="در حال بارگذاری پروژه…" />
        ) : !allowed ? (
          <Alert kind="warn">
            نقش شما در این پروژه به بخش «{def.label}» دسترسی ندارد.
            <div className="row" style={{ marginTop: 8 }}>
              <a className="btn" href={`#/p/${route.pid ?? ''}/dash`}>
                بازگشت به داشبورد
              </a>
            </div>
          </Alert>
        ) : (
          <ErrorBoundary resetKey={`${route.pid}-${route.tab}`}>
            <TabView tab={route.tab} />
          </ErrorBoundary>
        )}
      </main>
    </div>
  );
}

function NoProject({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="card" style={{ maxWidth: 520, margin: '40px auto' }}>
      <h2>هنوز پروژه‌ای در دسترس شما نیست</h2>
      <p className="muted" style={{ margin: '8px 0 14px' }}>
        {isAdmin ? 'اولین پروژه را بسازید؛ سپس کاربران و نقش‌ها را به آن اضافه کنید.' : 'ادمین سیستم باید شما را به یک پروژه اضافه کند.'}
      </p>
      {isAdmin ? <Btn kind="primary" icon="plus" onClick={newProjectDialog}>پروژه‌ی جدید</Btn> : null}
    </div>
  );
}

function Topbar({ projects, pid, onMenu }: { projects: ProjectListItem[]; pid: number | null; onMenu: () => void }) {
  const user = useStore(sessionStore, (s) => s.user)!;
  const ps = useProjectState();
  const can = useCan();
  const route = useRoute();
  const [theme, setTheme] = useState(currentTheme());
  const bundle = ps.bundle;
  const roles = bundle?.me.roles ?? [];
  return (
    <header className="topbar">
      <button type="button" className="btn ghost icon menu-btn" aria-label="باز و بسته کردن منو" onClick={onMenu}>
        <Icon name="menu" />
      </button>
      <span className="brand-mark">
        <BrandGlyph />
        بیستون
      </span>
      <div className="row gap-s" style={{ marginInlineStart: 14 }}>
        <label className="sr-only" htmlFor="project-select">
          پروژه
        </label>
        <select id="project-select" className="sel" style={{ width: 'auto', minWidth: 180, maxWidth: 300 }} value={pid ?? ''} onChange={(e) => navigate({ pid: Number(e.target.value), tab: route.tab })} data-testid="project-select">
          {pid === null ? <option value="">— پروژه را انتخاب کنید —</option> : null}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.archived ? ' (بایگانی)' : ''}
            </option>
          ))}
        </select>
        {user.isSystemAdmin ? <Btn size="sm" icon="plus" onClick={newProjectDialog} testId="new-project">پروژه‌ی جدید</Btn> : null}
      </div>
      {bundle ? (
        <div className="row gap-s">
          <span className="muted small">تاریخ وضعیت:</span>
          <strong className="num" data-testid="status-date">{faDate(bundle.project.status)}</strong>
          {can('project.settings') && !bundle.project.archived ? <Btn size="sm" kind="ghost" iconOnly icon="edit" label="تغییر تاریخ وضعیت" onClick={() => statusDateDialog()} /> : null}
        </div>
      ) : null}
      {bundle?.project.archived ? <Badge kind="warn">بایگانی‌شده؛ فقط خواندنی</Badge> : null}
      {ps.refreshing ? <span className="spin" role="status" aria-label="در حال به‌روزرسانی" /> : null}
      <span className="grow" />
      <div className="row gap-s no-print">
        {user.isSystemAdmin ? <Badge kind="brand">ادمین سیستم</Badge> : null}
        {roles.map((r) => (
          <Badge key={r}>{ROLE_LABELS[r]}</Badge>
        ))}
      </div>
      <ExportMenu />
      <Btn kind="ghost" iconOnly icon={theme === 'dark' ? 'sun' : 'moon'} label={theme === 'dark' ? 'حالت روشن' : 'حالت تیره'} onClick={() => setTheme(toggleTheme())} />
      <UserMenu />
    </header>
  );
}

function UserMenu() {
  const user = useStore(sessionStore, (s) => s.user)!;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="user-menu">
        <Icon name="user" />
        {user.displayName}
      </button>
      {open && (
        <div className="popover" role="menu" style={{ insetBlockStart: 'calc(100% + 4px)', insetInlineEnd: 0, minWidth: 180 }}>
          <div className="stack gap-s">
            <span className="muted small ltr">{user.username}</span>
            <Btn kind="ghost" onClick={() => { setOpen(false); changePasswordDialog(); }}>تغییر گذرواژه</Btn>
            <Btn kind="ghost" icon="logout" onClick={async () => { await logout(); }} testId="logout">خروج</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ───── دیالوگ‌ها ─────

export function changePasswordDialog(): void {
  void openDialog('تغییر گذرواژه', (close) => <ChangePasswordForm close={() => close()} />);
}

function ChangePasswordForm({ close }: { close: () => void }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const { busy, run } = useAction();
  const user = useStore(sessionStore, (s) => s.user)!;
  const bad = again !== '' && next !== again ? 'تکرار گذرواژه یکی نیست.' : null;
  return (
    <>
      <div className="body stack">
        <TextField label="گذرواژه‌ی فعلی" type="password" value={cur} onChange={setCur} ltr autoComplete="current-password" autoFocus />
        <TextField label="گذرواژه‌ی جدید" type="password" value={next} onChange={setNext} ltr autoComplete="new-password" hint={`دست‌کم ۱۰ نویسه و بدون «${user.username}»؛ نشست‌های دیگر شما بسته می‌شوند.`} />
        <TextField label="تکرار گذرواژه‌ی جدید" type="password" value={again} onChange={setAgain} ltr autoComplete="new-password" error={bad} />
      </div>
      <footer>
        <Btn kind="primary" busy={busy} disabled={!cur || next.length < 10 || next !== again} onClick={async () => {
          const ok = await run(async () => { await apiPost('/auth/change-password', { currentPassword: cur, newPassword: next }); return true; }, 'گذرواژه تغییر کرد.');
          if (ok) close();
        }}>ذخیره</Btn>
        <Btn onClick={close}>انصراف</Btn>
      </footer>
    </>
  );
}

export function newProjectDialog(): void {
  void openDialog('پروژه‌ی جدید', (close) => <NewProjectForm close={() => close()} />, { wide: true });
}

function statusDateDialog(): void {
  void openDialog('تاریخ وضعیت', (close) => <StatusDateForm close={() => close()} />);
}

function StatusDateForm({ close }: { close: () => void }) {
  const ps = useProjectState();
  const project = ps.bundle!.project;
  const [d, setD] = useState<string | null>(project.status);
  const { busy, run } = useAction();
  return (
    <>
      <div className="body stack">
        <DateField label="تاریخ وضعیت (امروزِ گزارش)" value={d} onChange={setD} required />
        <Alert kind="info">اگر تاریخ وضعیت روز غیرکاری باشد، محاسبات از روز کاری بعد استفاده می‌کنند و اگر پیش از شروع پروژه باشد، از ابتدای برنامه. پیشرفت، برنامه‌ای و شاخص‌ها با این تاریخ سنجیده می‌شوند.</Alert>
      </div>
      <footer>
        <Btn kind="primary" busy={busy} disabled={!d || d === project.status} onClick={async () => {
          const ok = await run(async () => { await apiPatch(`/projects/${project.id}`, { version: project.version, status: d }); await reloadProject(); return true; }, 'تاریخ وضعیت تغییر کرد.');
          if (ok) close();
        }}>ذخیره</Btn>
        <Btn onClick={close}>انصراف</Btn>
      </footer>
    </>
  );
}

export { toast };
