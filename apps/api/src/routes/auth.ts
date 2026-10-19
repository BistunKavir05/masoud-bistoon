import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { capabilitiesOf, isRole } from '@bistoon/core';
import type { Role } from '@bistoon/core';
import { actorInfo, writeAudit } from '../audit.ts';
import { burnPasswordCheck, hashPassword, passwordPolicyError, verifyPassword } from '../auth/password.ts';
import { createSession, deleteSession, deleteUserSessions } from '../auth/sessions.ts';
import type { Config } from '../config.ts';
import type { Db } from '../db.ts';
import { many, one, poolDb, withTx } from '../db.ts';
import { badRequest, tooMany, unauthorized } from '../errors.ts';
import { actorOf } from '../http/types.ts';
import type { AuthUser } from '../http/types.ts';
import type { FailureLimiter } from '../middleware.ts';
import { sessionCookieName } from '../middleware.ts';

const loginBody = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(200) });
const changeBody = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) });

export interface ProjectSummaryRow {
  id: number;
  name: string;
  start: string;
  status: string;
  contractEnd: string | null;
  archived: boolean;
  roles: Role[];
  capabilities: string[];
}

/** پروژه‌هایی که کاربر به آن‌ها دسترسی دارد (ادمین سیستم: همه) */
export async function listProjectsFor(db: Db, user: AuthUser): Promise<ProjectSummaryRow[]> {
  const rows = await many<{ id: number; name: string; start_date: string; status_date: string; contract_end: string | null; archived_at: Date | null; roles: string[] }>(
    db,
    `SELECT p.id, p.name, p.start_date, p.status_date, p.contract_end, p.archived_at,
            COALESCE(array_agg(m.role) FILTER (WHERE m.role IS NOT NULL), '{}') AS roles
       FROM projects p
       LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
      WHERE $2::boolean OR m.user_id IS NOT NULL
      GROUP BY p.id
      ORDER BY (p.archived_at IS NOT NULL), p.name, p.id`,
    [user.id, user.isSystemAdmin],
  );
  return rows.map((r) => {
    const roles = r.roles.filter(isRole);
    return {
      id: r.id,
      name: r.name,
      start: r.start_date,
      status: r.status_date,
      contractEnd: r.contract_end,
      archived: r.archived_at !== null,
      roles,
      capabilities: capabilitiesOf(roles, { systemAdmin: user.isSystemAdmin }),
    };
  });
}

export const userDto = (u: AuthUser): AuthUser => ({ id: u.id, username: u.username, displayName: u.displayName, isSystemAdmin: u.isSystemAdmin, mustChangePassword: u.mustChangePassword });

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  is_system_admin: boolean;
  is_active: boolean;
  must_change_password: boolean;
  locked_until: Date | null;
}

const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;

export function authRouters(pool: Pool, cfg: Config, limiter: FailureLimiter): { pub: Router; session: Router } {
  const cookieName = sessionCookieName(cfg);
  const setCookie = (res: Response, token: string, expiresAt: Date): void => {
    res.cookie(cookieName, token, { httpOnly: true, sameSite: 'strict', secure: cfg.cookieSecure, path: '/', expires: expiresAt });
  };

  const pub = Router();
  pub.post('/login', async (req: Request, res: Response) => {
    const body = loginBody.parse(req.body);
    const ipKey = req.ctx.ip ?? 'unknown';
    if (limiter.blocked(ipKey)) throw tooMany('تلاش‌های ناموفق زیاد بوده است؛ چند دقیقه بعد دوباره تلاش کنید.', 'IP_THROTTLED');
    const db = poolDb(pool);
    const fail = async (userId: number | null): Promise<never> => {
      limiter.fail(ipKey);
      await writeAudit(db, { id: userId, name: '', ip: req.ctx.ip, requestId: req.ctx.requestId }, { action: 'login.failed', entity: 'user', entityId: userId ?? '', details: { username: body.username.slice(0, 64) } });
      throw unauthorized('نام کاربری یا گذرواژه نادرست است.', 'BAD_CREDENTIALS');
    };
    const user = await one<UserRow>(db, 'SELECT * FROM users WHERE lower(username) = lower($1)', [body.username]);
    if (!user || !user.is_active) {
      await burnPasswordCheck(body.password);
      return fail(user?.id ?? null);
    }
    if (user.locked_until && user.locked_until.getTime() > Date.now()) {
      throw tooMany('حساب به‌دلیل تلاش‌های ناموفق موقتاً قفل شده است؛ بعداً دوباره تلاش کنید.', 'ACCOUNT_LOCKED');
    }
    if (!(await verifyPassword(body.password, user.password_hash))) {
      await db.query(
        `UPDATE users SET
           locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END,
           failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0 ELSE failed_logins + 1 END
         WHERE id = $1`,
        [user.id, LOCK_AFTER, LOCK_MINUTES],
      );
      return fail(user.id);
    }
    limiter.clear(ipKey);
    const authUser: AuthUser = { id: user.id, username: user.username, displayName: user.display_name, isSystemAdmin: user.is_system_admin, mustChangePassword: user.must_change_password };
    const out = await withTx(pool, async (tx) => {
      await tx.query('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [user.id]);
      const s = await createSession(tx, user.id, cfg.sessionTtlHours, req.ctx.ip, req.get('user-agent') ?? null);
      await writeAudit(tx, { id: user.id, name: user.display_name, ip: req.ctx.ip, requestId: req.ctx.requestId }, { action: 'login', entity: 'user', entityId: user.id });
      return s;
    });
    setCookie(res, out.token, out.expiresAt);
    res.json({ user: userDto(authUser), csrfToken: out.csrfToken, projects: await listProjectsFor(db, authUser) });
  });

  const session = Router();
  session.get('/me', async (req: Request, res: Response) => {
    const user = actorOf(req);
    res.json({ user: userDto(user), csrfToken: req.ctx.session?.csrfToken, projects: await listProjectsFor(poolDb(pool), user) });
  });

  session.post('/logout', async (req: Request, res: Response) => {
    const user = actorOf(req);
    const db = poolDb(pool);
    if (req.ctx.session) await deleteSession(db, req.ctx.session.tokenHash);
    await writeAudit(db, actorInfo(req), { action: 'logout', entity: 'user', entityId: user.id });
    res.clearCookie(cookieName, { httpOnly: true, sameSite: 'strict', secure: cfg.cookieSecure, path: '/' });
    res.json({ ok: true });
  });

  session.post('/change-password', async (req: Request, res: Response) => {
    const user = actorOf(req);
    const body = changeBody.parse(req.body);
    const row = await one<UserRow>(poolDb(pool), 'SELECT * FROM users WHERE id = $1', [user.id]);
    if (!row || !(await verifyPassword(body.currentPassword, row.password_hash))) throw badRequest('گذرواژه‌ی فعلی نادرست است.', undefined, 'BAD_CURRENT_PASSWORD');
    const policy = passwordPolicyError(body.newPassword, user.username);
    if (policy) throw badRequest(policy, undefined, 'WEAK_PASSWORD');
    if (body.newPassword === body.currentPassword) throw badRequest('گذرواژه‌ی جدید باید با گذرواژه‌ی فعلی فرق داشته باشد.', undefined, 'SAME_PASSWORD');
    const hash = await hashPassword(body.newPassword);
    await withTx(pool, async (tx) => {
      await tx.query('UPDATE users SET password_hash = $2, must_change_password = false, updated_at = now() WHERE id = $1', [user.id, hash]);
      if (req.ctx.session) await deleteUserSessions(tx, user.id, req.ctx.session.tokenHash);
      await writeAudit(tx, actorInfo(req), { action: 'password.change', entity: 'user', entityId: user.id });
    });
    res.json({ ok: true });
  });

  return { pub, session };
}
