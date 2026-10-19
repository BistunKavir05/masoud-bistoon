import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { actorInfo, diffFields, writeAudit } from '../audit.ts';
import { hashPassword, passwordPolicyError } from '../auth/password.ts';
import { deleteUserSessions } from '../auth/sessions.ts';
import type { Db } from '../db.ts';
import { many, one, poolDb, withTx } from '../db.ts';
import { badRequest, conflict, forbidden, notFound } from '../errors.ts';
import { actorOf, intParam } from '../http/types.ts';
import { requireSystemAdmin } from '../middleware.ts';
import { text } from '../schemas.ts';

interface UserListRow {
  id: number;
  username: string;
  display_name: string;
  email: string | null;
  is_system_admin: boolean;
  is_active: boolean;
  must_change_password: boolean;
  last_login_at: Date | null;
  locked_until: Date | null;
}

const toDto = (r: UserListRow) => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  email: r.email,
  isSystemAdmin: r.is_system_admin,
  isActive: r.is_active,
  mustChangePassword: r.must_change_password,
  lastLoginAt: r.last_login_at,
  lockedUntil: r.locked_until,
});

const COLS = 'id, username, display_name, email, is_system_admin, is_active, must_change_password, last_login_at, locked_until';

const createBody = z.object({
  username: z.string().regex(/^[A-Za-z0-9._-]{3,64}$/, 'نام کاربری فقط حروف انگلیسی، رقم و . _ - (۳ تا ۶۴ نویسه) باشد.'),
  displayName: text(80).min(1),
  email: z.string().trim().email().max(200).nullable().optional(),
  password: z.string().min(1).max(200),
  isSystemAdmin: z.boolean().default(false),
  mustChangePassword: z.boolean().default(true),
});

const patchBody = z
  .object({
    displayName: text(80).min(1),
    email: z.string().trim().email().max(200).nullable(),
    isActive: z.boolean(),
    isSystemAdmin: z.boolean(),
  })
  .partial()
  .strict();

const resetBody = z.object({ password: z.string().min(1).max(200) });

/** مطمئن می‌شود دست‌کم یک ادمین فعال دیگر می‌ماند (ردیف‌ها قفل می‌شوند تا دو درخواست هم‌زمان رد نشوند) */
async function assertAnotherAdmin(db: Db, exceptUserId: number): Promise<void> {
  const others = await many<{ id: number }>(db, 'SELECT id FROM users WHERE is_system_admin AND is_active AND id <> $1 FOR UPDATE', [exceptUserId]);
  if (others.length === 0) throw conflict('باید دست‌کم یک ادمین فعال سیستم باقی بماند.', 'LAST_ADMIN');
}

export function usersRouter(pool: Pool): Router {
  const r = Router();

  /** فهرست حداقلی برای انتخاب عضو پروژه: ادمین سیستم یا ادمین یک پروژه */
  r.get('/directory', async (req: Request, res: Response) => {
    const u = actorOf(req);
    if (!u.isSystemAdmin) {
      const adm = await one(poolDb(pool), "SELECT 1 FROM project_members WHERE user_id = $1 AND role = 'admin' LIMIT 1", [u.id]);
      if (!adm) throw forbidden();
    }
    const rows = await many<{ id: number; username: string; display_name: string }>(poolDb(pool), 'SELECT id, username, display_name FROM users WHERE is_active ORDER BY display_name, id');
    res.json({ users: rows.map((x) => ({ id: x.id, username: x.username, displayName: x.display_name })) });
  });

  r.get('/users', requireSystemAdmin, async (_req: Request, res: Response) => {
    const rows = await many<UserListRow>(poolDb(pool), `SELECT ${COLS} FROM users ORDER BY lower(username)`);
    res.json({ users: rows.map(toDto) });
  });

  r.post('/users', requireSystemAdmin, async (req: Request, res: Response) => {
    const b = createBody.parse(req.body);
    const policy = passwordPolicyError(b.password, b.username);
    if (policy) throw badRequest(policy, undefined, 'WEAK_PASSWORD');
    const hash = await hashPassword(b.password);
    const row = await withTx(pool, async (tx) => {
      const created = await one<UserListRow>(
        tx,
        `INSERT INTO users (username, display_name, email, password_hash, is_system_admin, must_change_password)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLS}`,
        [b.username, b.displayName, b.email ?? null, hash, b.isSystemAdmin, b.mustChangePassword],
      );
      await writeAudit(tx, actorInfo(req), { action: 'user.create', entity: 'user', entityId: created!.id, newValue: { username: b.username, displayName: b.displayName, isSystemAdmin: b.isSystemAdmin } });
      return created!;
    });
    res.status(201).json({ user: toDto(row) });
  });

  r.patch('/users/:id', requireSystemAdmin, async (req: Request, res: Response) => {
    const id = intParam(req, 'id');
    const patch = patchBody.parse(req.body);
    const me = actorOf(req);
    const row = await withTx(pool, async (tx) => {
      const before = await one<UserListRow>(tx, `SELECT ${COLS} FROM users WHERE id = $1 FOR UPDATE`, [id]);
      if (!before) throw notFound('کاربر پیدا نشد.', 'NO_USER');
      const next = {
        display_name: patch.displayName ?? before.display_name,
        email: patch.email === undefined ? before.email : patch.email,
        is_active: patch.isActive ?? before.is_active,
        is_system_admin: patch.isSystemAdmin ?? before.is_system_admin,
      };
      if (id === me.id && (!next.is_active || !next.is_system_admin)) throw conflict('نمی‌توانید حساب خودتان را غیرفعال یا از ادمینی خارج کنید.', 'SELF_LOCKOUT');
      if (before.is_system_admin && before.is_active && (!next.is_active || !next.is_system_admin)) await assertAnotherAdmin(tx, id);
      const after = await one<UserListRow>(
        tx,
        `UPDATE users SET display_name = $2, email = $3, is_active = $4, is_system_admin = $5, updated_at = now()
          WHERE id = $1 RETURNING ${COLS}`,
        [id, next.display_name, next.email, next.is_active, next.is_system_admin],
      );
      if (before.is_active && !next.is_active) await deleteUserSessions(tx, id);
      const changes = diffFields(toDto(before) as never, toDto(after!) as never, ['displayName', 'email', 'isActive', 'isSystemAdmin']);
      await writeAudit(tx, actorInfo(req), changes.map((c) => ({ action: 'user.update', entity: 'user', entityId: id, field: c.field, oldValue: c.from, newValue: c.to })));
      return after!;
    });
    res.json({ user: toDto(row) });
  });

  r.post('/users/:id/reset-password', requireSystemAdmin, async (req: Request, res: Response) => {
    const id = intParam(req, 'id');
    const b = resetBody.parse(req.body);
    const target = await one<{ username: string }>(poolDb(pool), 'SELECT username FROM users WHERE id = $1', [id]);
    if (!target) throw notFound('کاربر پیدا نشد.', 'NO_USER');
    const policy = passwordPolicyError(b.password, target.username);
    if (policy) throw badRequest(policy, undefined, 'WEAK_PASSWORD');
    const hash = await hashPassword(b.password);
    await withTx(pool, async (tx) => {
      await tx.query('UPDATE users SET password_hash = $2, must_change_password = true, failed_logins = 0, locked_until = NULL, updated_at = now() WHERE id = $1', [id, hash]);
      await deleteUserSessions(tx, id);
      await writeAudit(tx, actorInfo(req), { action: 'user.reset_password', entity: 'user', entityId: id });
    });
    res.json({ ok: true });
  });

  return r;
}
