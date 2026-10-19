import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPatch, apiPost, errorMessage } from '../../api/client.ts';
import { faDateTime } from '../../lib/fmt.ts';
import { generatePassword, passwordProblem } from '../../lib/password.ts';
import { sessionStore } from '../../state/session.ts';
import { useStore } from '../../state/store.ts';
import { Alert, Badge, Btn, Card, CheckField, Empty, Loading, TextField, useAction } from '../../ui/controls.tsx';
import { openDialog, toast } from '../../ui/dialogs.tsx';

interface AdminUser {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  isSystemAdmin: boolean;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function PasswordInput({ value, onChange, username, label = 'گذرواژه' }: { value: string; onChange: (v: string) => void; username: string; label?: string }) {
  const problem = value === '' ? null : passwordProblem(value, username);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      toast.ok('گذرواژه کپی شد.');
    } catch {
      toast.bad('کپی نشد؛ گذرواژه را دستی انتخاب و کپی کنید.');
    }
  };
  return (
    <div className="field wide">
      <TextField label={label} required wide ltr value={value} onChange={onChange} error={problem} hint="دست‌کم ۱۰ نویسه با تنوع کافی؛ بدون «برابر نام کاربری». گذرواژه را به‌صورت امن به کاربر بدهید." autoComplete="off" maxLength={200} testId="pw-input" />
      <div className="row" style={{ marginTop: 6 }}>
        <Btn size="sm" icon="refresh" onClick={() => onChange(generatePassword())} testId="pw-generate">
          تولید گذرواژه‌ی تصادفی
        </Btn>
        <Btn size="sm" icon="copy" onClick={copy} disabled={value === ''}>
          کپی
        </Btn>
      </div>
    </div>
  );
}

function UserForm({ user, meId, close, onSaved }: { user: AdminUser | null; meId: number; close: () => void; onSaved: () => Promise<void> }) {
  const [username, setUsername] = useState(user?.username ?? '');
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [isSystemAdmin, setIsSystemAdmin] = useState(user?.isSystemAdmin ?? false);
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [mustChange, setMustChange] = useState(true);
  const { busy, run } = useAction();
  const self = user?.id === meId;
  const emailBad = email.trim() !== '' && !EMAIL.test(email.trim()) ? 'نشانی ایمیل معتبر نیست.' : null;
  const nameBad = !user && username !== '' && !/^[A-Za-z0-9._-]{3,64}$/.test(username) ? 'فقط حروف انگلیسی، رقم و . _ - (۳ تا ۶۴ نویسه).' : null;
  const invalid = displayName.trim() === '' || emailBad !== null || (!user && (username === '' || nameBad !== null || passwordProblem(password, username) !== null));
  const patch = (): Record<string, unknown> => {
    const o: Record<string, unknown> = {};
    if (!user) return o;
    if (displayName.trim() !== user.displayName) o['displayName'] = displayName.trim();
    const em = email.trim() === '' ? null : email.trim();
    if (em !== user.email) o['email'] = em;
    if (isActive !== user.isActive) o['isActive'] = isActive;
    if (isSystemAdmin !== user.isSystemAdmin) o['isSystemAdmin'] = isSystemAdmin;
    return o;
  };
  const changed = !user || Object.keys(patch()).length > 0;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid || !changed) return;
        void run(async () => {
          if (user) await apiPatch(`/users/${user.id}`, patch());
          else await apiPost('/users', { username, displayName: displayName.trim(), email: email.trim() === '' ? null : email.trim(), password, isSystemAdmin, mustChangePassword: mustChange });
          await onSaved();
          close();
        }, user ? 'تغییرات ذخیره شد.' : 'کاربر ساخته شد.');
      }}
    >
      <div className="body form-grid">
        {user ? (
          <div className="field">
            <label>نام کاربری</label>
            <div className="num">{user.username}</div>
          </div>
        ) : (
          <TextField label="نام کاربری" required ltr value={username} onChange={setUsername} error={nameBad} hint="برای ورود؛ بعداً قابل تغییر نیست." autoComplete="off" maxLength={64} testId="user-username" />
        )}
        <TextField label="نام نمایشی" required value={displayName} onChange={setDisplayName} maxLength={80} testId="user-display" />
        <TextField label="ایمیل (اختیاری)" ltr value={email} onChange={setEmail} error={emailBad} maxLength={200} testId="user-email" />
        {!user ? <PasswordInput value={password} onChange={setPassword} username={username} /> : null}
        <div className="field wide">
          <CheckField label="ادمین سیستم (دسترسی کامل به همه‌ی پروژه‌ها و کاربران)" checked={isSystemAdmin} onChange={setIsSystemAdmin} disabled={self} hint={self ? 'نمی‌توانید ادمینی خودتان را بردارید.' : undefined} />
          {user ? <CheckField label="حساب فعال است" checked={isActive} onChange={setIsActive} disabled={self} hint={self ? 'نمی‌توانید حساب خودتان را غیرفعال کنید.' : 'با غیرفعال‌کردن، نشست‌های باز کاربر بسته می‌شود؛ سوابق او می‌ماند.'} /> : <CheckField label="در اولین ورود گذرواژه را عوض کند" checked={mustChange} onChange={setMustChange} />}
        </div>
      </div>
      <footer>
        <Btn type="submit" kind="primary" busy={busy} disabled={invalid || !changed} testId="user-save">
          {user ? 'ذخیره' : 'ساخت کاربر'}
        </Btn>
        <Btn onClick={close}>انصراف</Btn>
      </footer>
    </form>
  );
}

function ResetForm({ user, close, onSaved }: { user: AdminUser; close: () => void; onSaved: () => Promise<void> }) {
  const [password, setPassword] = useState('');
  const { busy, run } = useAction();
  const invalid = passwordProblem(password, user.username) !== null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid) return;
        void run(async () => {
          await apiPost(`/users/${user.id}/reset-password`, { password });
          await onSaved();
          close();
        }, 'گذرواژه بازنشانی شد.');
      }}
    >
      <div className="body stack">
        <p style={{ margin: 0 }}>
          گذرواژه‌ی جدید برای <strong>{user.displayName}</strong> <span className="muted num">({user.username})</span>
        </p>
        <PasswordInput label="گذرواژه‌ی جدید" value={password} onChange={setPassword} username={user.username} />
        <Alert kind="info">نشست‌های باز این کاربر بسته می‌شود، قفل ورود برداشته می‌شود و در اولین ورود باید گذرواژه را عوض کند.</Alert>
      </div>
      <footer>
        <Btn type="submit" kind="primary" busy={busy} disabled={invalid} testId="reset-save">
          بازنشانی
        </Btn>
        <Btn onClick={close}>انصراف</Btn>
      </footer>
    </form>
  );
}

export function AccountsCard() {
  const meId = useStore(sessionStore, (s) => s.user?.id ?? 0);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (): Promise<void> => {
    try {
      const r = await apiGet<{ users: AdminUser[] }>('/users');
      setUsers(r.users);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const edit = (u: AdminUser | null): void => void openDialog(u ? 'ویرایش کاربر' : 'کاربر جدید', (close) => <UserForm user={u} meId={meId} close={() => close()} onSaved={load} />);
  const reset = (u: AdminUser): void => void openDialog('بازنشانی گذرواژه', (close) => <ResetForm user={u} close={() => close()} onSaved={load} />);
  const now = Date.now();

  return (
    <Card
      title="حساب‌های کاربری سیستم"
      actions={
        <Btn icon="plus" kind="primary" onClick={() => edit(null)} testId="user-add">
          کاربر جدید
        </Btn>
      }
    >
      {error ? <Alert kind="bad">{error}</Alert> : null}
      {users === null && !error ? (
        <Loading />
      ) : users !== null && users.length === 0 ? (
        <Empty title="کاربری نیست" />
      ) : (
        <div className="tbl-wrap">
          <table className="tbl" data-testid="user-table">
            <thead>
              <tr>
                <th>نام</th>
                <th>نام کاربری</th>
                <th>ایمیل</th>
                <th>وضعیت</th>
                <th>آخرین ورود</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users?.map((u) => {
                const locked = u.lockedUntil !== null && Date.parse(u.lockedUntil) > now;
                return (
                  <tr key={u.id} data-testid={`user-row-${u.username}`} className={u.isActive ? '' : 'inactive'}>
                    <td>{u.displayName}</td>
                    <td>
                      <span className="num">{u.username}</span>
                    </td>
                    <td>{u.email ? <span className="num">{u.email}</span> : <span className="muted">—</span>}</td>
                    <td>
                      <span className="chips">
                        {u.isSystemAdmin ? <Badge kind="brand">ادمین سیستم</Badge> : null}
                        {!u.isActive ? <Badge kind="bad">غیرفعال</Badge> : null}
                        {locked ? <Badge kind="warn">قفل موقت (ورود ناموفق)</Badge> : null}
                        {u.mustChangePassword ? <Badge kind="warn">باید گذرواژه را عوض کند</Badge> : null}
                        {u.id === meId ? <Badge>شما</Badge> : null}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{u.lastLoginAt ? faDateTime(u.lastLoginAt) : <span className="muted">هرگز</span>}</td>
                    <td className="c" style={{ whiteSpace: 'nowrap' }}>
                      <Btn size="sm" iconOnly icon="edit" label={`ویرایش ${u.displayName}`} onClick={() => edit(u)} testId={`user-edit-${u.username}`} />{' '}
                      <Btn size="sm" iconOnly icon="lock" label={`بازنشانی گذرواژه‌ی ${u.displayName}`} onClick={() => reset(u)} testId={`user-reset-${u.username}`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
