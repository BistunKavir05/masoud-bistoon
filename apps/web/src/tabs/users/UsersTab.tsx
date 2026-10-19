import { useState } from 'react';
import { CAPABILITIES, CAPABILITY_LABELS, PERMISSION_MATRIX, ROLES, ROLE_LABELS, isMutation } from '@bistoon/core';
import type { Role } from '@bistoon/core';
import { apiGet, apiPut, errorMessage } from '../../api/client.ts';
import { faInt } from '../../lib/fmt.ts';
import { useMembers } from '../../state/members.ts';
import type { MemberRow } from '../../state/members.ts';
import { reloadProject, useCan, useProjectState } from '../../state/project.ts';
import { refreshProjects, sessionStore } from '../../state/session.ts';
import { useStore } from '../../state/store.ts';
import { Alert, Badge, Btn, Card, CheckField, Empty, Loading, PageHead, SelectField, useAction } from '../../ui/controls.tsx';
import { confirmDialog, openDialog, toast } from '../../ui/dialogs.tsx';
import { Icon } from '../../ui/icons.tsx';
import { AccountsCard } from './AccountsCard.tsx';

interface DirUser {
  id: number;
  username: string;
  displayName: string;
}

function RoleChecks({ roles, onChange, disabled }: { roles: readonly Role[]; onChange: (r: Role[]) => void; disabled?: boolean }) {
  return (
    <fieldset className="role-checks">
      <legend>نقش‌ها در این پروژه</legend>
      {ROLES.map((r) => (
        <CheckField key={r} label={ROLE_LABELS[r]} checked={roles.includes(r)} disabled={disabled} onChange={(v) => onChange(v ? [...roles, r] : roles.filter((x) => x !== r))} />
      ))}
    </fieldset>
  );
}

function MemberForm({ pid, member, candidates, meId, meIsSystemAdmin, close, onSaved }: { pid: number; member: MemberRow | null; candidates: DirUser[]; meId: number; meIsSystemAdmin: boolean; close: () => void; onSaved: (userId: number) => Promise<void> }) {
  const [userId, setUserId] = useState(member ? String(member.userId) : '');
  const [roles, setRoles] = useState<Role[]>(member ? [...member.roles] : []);
  const { busy, run } = useAction();
  const target = member ? member.userId : userId === '' ? null : Number(userId);
  const losesAdmin = member !== null && member.userId === meId && !meIsSystemAdmin && member.roles.includes('admin') && !roles.includes('admin');
  const changed = member === null || [...roles].sort().join() !== [...member.roles].sort().join();
  const submit = async (): Promise<void> => {
    if (target === null || roles.length === 0) return;
    if (losesAdmin) {
      const ok = await confirmDialog({ title: 'خروج از ادمینی پروژه', message: 'با این تغییر دیگر ادمین این پروژه نیستید و نمی‌توانید نقش‌ها را برگردانید. ادامه می‌دهید؟', confirmLabel: 'ادامه', danger: true });
      if (!ok) return;
    }
    const done = await run(async () => {
      await apiPut(`/projects/${pid}/members/${target}`, { roles });
      await onSaved(target);
      return true;
    }, 'نقش‌ها ذخیره شد.');
    if (done) close();
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="body stack">
        {member ? (
          <p style={{ margin: 0 }}>
            <strong>{member.displayName}</strong> <span className="muted num">({member.username})</span>
          </p>
        ) : (
          <SelectField label="کاربر" required wide value={userId} options={[{ value: '', label: candidates.length ? 'انتخاب کنید…' : 'همه‌ی کاربران فعال عضو این پروژه‌اند' }, ...candidates.map((u) => ({ value: String(u.id), label: `${u.displayName} (${u.username})` }))]} onChange={setUserId} disabled={candidates.length === 0} />
        )}
        <RoleChecks roles={roles} onChange={setRoles} />
        {losesAdmin ? <Alert kind="warn">شما در حال برداشتن نقش «ادمین» از خودتان هستید.</Alert> : null}
        <p className="small muted" style={{ margin: 0 }}>
          دسترسی هر کاربر مجموع دسترسی نقش‌های اوست. جدول دسترسی نقش‌ها در پایین همین صفحه آمده است.
        </p>
      </div>
      <footer>
        <Btn type="submit" kind="primary" busy={busy} disabled={target === null || roles.length === 0 || !changed} testId="member-save">
          ذخیره
        </Btn>
        <Btn onClick={close}>انصراف</Btn>
      </footer>
    </form>
  );
}

function MembersCard() {
  const ps = useProjectState();
  const b = ps.bundle!;
  const pid = b.project.id;
  const me = useStore(sessionStore, (s) => s.user)!;
  const { members, error, reload } = useMembers(pid);
  const archived = b.project.archived;
  const { busy, run } = useAction();

  const afterSave = async (userId: number): Promise<void> => {
    reload();
    if (userId === me.id) {
      await reloadProject();
      await refreshProjects();
    }
  };

  const openForm = async (member: MemberRow | null): Promise<void> => {
    let candidates: DirUser[] = [];
    if (!member) {
      try {
        const r = await apiGet<{ users: DirUser[] }>('/directory');
        const have = new Set((members ?? []).map((m) => m.userId));
        candidates = r.users.filter((u) => !have.has(u.id));
      } catch (e) {
        toast.bad(errorMessage(e));
        return;
      }
    }
    void openDialog(member ? 'ویرایش نقش‌ها' : 'افزودن عضو به پروژه', (close) => <MemberForm pid={pid} member={member} candidates={candidates} meId={me.id} meIsSystemAdmin={me.isSystemAdmin} close={() => close()} onSaved={afterSave} />);
  };

  const remove = async (m: MemberRow): Promise<void> => {
    const self = m.userId === me.id;
    const ok = await confirmDialog({
      title: 'حذف از پروژه',
      message: self ? 'خودتان را از این پروژه حذف می‌کنید و دیگر به آن دسترسی نخواهید داشت (مگر ادمین سیستم باشید). ادامه می‌دهید؟' : `«${m.displayName}» از این پروژه حذف شود؟ اگر منبعی به او وصل باشد، اتصال برداشته می‌شود (خود منبع می‌ماند).`,
      confirmLabel: 'حذف شود',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await apiPut(`/projects/${pid}/members/${m.userId}`, { roles: [] });
      await afterSave(m.userId);
    }, 'عضو از پروژه حذف شد.');
  };

  return (
    <Card
      title={`اعضای پروژه‌ی «${b.project.name}»`}
      actions={
        !archived ? (
          <Btn icon="plus" kind="primary" onClick={() => openForm(null)} testId="member-add">
            افزودن عضو
          </Btn>
        ) : null
      }
    >
      {archived ? <Alert kind="warn">این پروژه بایگانی شده است؛ اعضا و نقش‌ها تا بازگردانی پروژه قابل تغییر نیست.</Alert> : null}
      {error ? <Alert kind="bad">{error}</Alert> : null}
      {members === null && !error ? (
        <Loading />
      ) : members !== null && members.length === 0 ? (
        <Empty title="عضوی ندارد">با «افزودن عضو»، کاربران را با نقش مناسب به پروژه اضافه کنید.</Empty>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl" data-testid="member-table">
            <thead>
              <tr>
                <th>نام</th>
                <th>نام کاربری</th>
                <th>نقش‌ها</th>
                {!archived ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {members?.map((m) => (
                <tr key={m.userId} data-testid={`member-row-${m.username}`}>
                  <td>
                    {m.displayName} {!m.isActive ? <Badge kind="bad">غیرفعال</Badge> : null} {m.userId === me.id ? <Badge>شما</Badge> : null}
                  </td>
                  <td>
                    <span className="num">{m.username}</span>
                  </td>
                  <td>
                    <span className="chips">
                      {m.roles.map((r) => (
                        <Badge key={r} kind={r === 'admin' ? 'brand' : ''}>
                          {ROLE_LABELS[r]}
                        </Badge>
                      ))}
                    </span>
                  </td>
                  {!archived ? (
                    <td className="c" style={{ whiteSpace: 'nowrap' }}>
                      <Btn size="sm" iconOnly icon="edit" label={`ویرایش نقش‌های ${m.displayName}`} onClick={() => openForm(m)} testId={`member-edit-${m.username}`} />{' '}
                      <Btn size="sm" kind="danger" iconOnly icon="trash" label={`حذف ${m.displayName} از پروژه`} busy={busy} onClick={() => remove(m)} testId={`member-del-${m.username}`} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function MatrixCard() {
  return (
    <Card title="جدول دسترسی نقش‌ها">
      <details data-testid="matrix">
        <summary>نمایش جدول (چه نقشی چه کاری می‌تواند بکند)</summary>
        <p className="small muted">ادمین سیستم خارج از این جدول روی همه‌ی پروژه‌ها دسترسی کامل دارد. بازرگانی فقط مشاهده می‌کند. اگر کاربری چند نقش داشته باشد، مجموع دسترسی‌ها اعمال می‌شود. این جدول فقط نمایشی است.</p>
        <div className="tbl-wrap">
          <table className="tbl matrix-tbl">
            <thead>
              <tr>
                <th>قابلیت</th>
                {ROLES.map((r) => (
                  <th key={r} className="c">
                    {ROLE_LABELS[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map((c) => (
                <tr key={c}>
                  <td>
                    {CAPABILITY_LABELS[c]} {isMutation(c) ? <Badge kind="warn">ویرایشی</Badge> : null}
                  </td>
                  {ROLES.map((r) => {
                    const yes = PERMISSION_MATRIX[c].includes(r);
                    return (
                      <td key={r} className="c" aria-label={yes ? 'دارد' : 'ندارد'}>
                        {yes ? <Icon name="check" size={16} /> : <span className="muted">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">{faInt(CAPABILITIES.length)} قابلیت و {faInt(ROLES.length)} نقش.</p>
      </details>
    </Card>
  );
}

export function UsersTab() {
  const ps = useProjectState();
  const can = useCan();
  const me = useStore(sessionStore, (s) => s.user)!;
  const showMembers = ps.status === 'ready' && ps.bundle !== null && can('members.manage');
  return (
    <>
      <PageHead title="کاربران" />
      <div className="stack">
        {showMembers ? <MembersCard /> : ps.status === 'loading' ? <Loading text="در حال بارگذاری پروژه…" /> : null}
        {me.isSystemAdmin ? <AccountsCard /> : null}
        {showMembers || me.isSystemAdmin ? <MatrixCard /> : null}
      </div>
    </>
  );
}
