import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Pool } from 'pg';
import { capabilitiesOf, isMutation, isRole } from '@bistoon/core';
import type { Capability, Role } from '@bistoon/core';
import { loadSession, parseCookies, safeEqual } from './auth/sessions.ts';
import type { Config } from './config.ts';
import { many, one, poolDb } from './db.ts';
import { conflict, forbidden, notFound, unauthorized } from './errors.ts';
import type { AuthUser, ProjectAccess } from './http/types.ts';
import { actorOf } from './http/types.ts';

export type Logger = (line: Record<string, unknown>) => void;

export const sessionCookieName = (cfg: Pick<Config, 'cookieSecure'>): string => (cfg.cookieSecure ? '__Host-bistoon_sid' : 'bistoon_sid');

/** شناسه‌ی درخواست، هدرهای امنیتی، و گزارش یک‌خطی هر درخواست */
export function requestContext(cfg: Config, log: Logger): RequestHandler {
  return (req, res, next) => {
    const requestId = randomUUID();
    req.ctx = { requestId, ip: req.ip ?? null };
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (cfg.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    if (cfg.logRequests) {
      const t0 = process.hrtime.bigint();
      res.on('finish', () => {
        log({ level: 'info', msg: 'request', requestId, method: req.method, path: req.path, status: res.statusCode, ms: Number((process.hrtime.bigint() - t0) / 1_000_000n), user: req.ctx.user?.id ?? null });
      });
    }
    next();
  };
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** درخواست‌های تغییردهنده‌ای که Origin دارند باید از همین میزبان (یا فهرست مجاز) بیایند. */
export function originGuard(cfg: Config): RequestHandler {
  return (req, _res, next) => {
    if (SAFE.has(req.method)) return next();
    const origin = req.get('origin');
    if (!origin) return next();
    let host = '';
    try {
      host = new URL(origin).host;
    } catch {
      return next(forbidden('مبدأ درخواست نامعتبر است.', 'BAD_ORIGIN'));
    }
    if (host === req.get('host') || cfg.allowedOrigins.includes(origin)) return next();
    next(forbidden('مبدأ درخواست مجاز نیست.', 'BAD_ORIGIN'));
  };
}

/** نشست را از کوکی می‌خواند؛ بدون نشست معتبر 401. */
export function authenticate(pool: Pool, cfg: Config): RequestHandler {
  const cookie = sessionCookieName(cfg);
  return async (req, _res, next) => {
    const token = parseCookies(req.headers.cookie)[cookie];
    if (!token) return next(unauthorized());
    const s = await loadSession(poolDb(pool), token, cfg.sessionTtlHours);
    if (!s) return next(unauthorized('نشست منقضی شده است؛ دوباره وارد شوید.', 'SESSION_EXPIRED'));
    req.ctx.user = s.user;
    req.ctx.session = { tokenHash: s.tokenHash, csrfToken: s.csrfToken };
    next();
  };
}

export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (SAFE.has(req.method)) return next();
  const given = req.get('x-csrf-token');
  const expected = req.ctx.session?.csrfToken;
  if (!given || !expected || !safeEqual(given, expected)) return next(forbidden('نشانه‌ی CSRF نامعتبر است؛ صفحه را تازه کنید.', 'CSRF'));
  next();
};

const PASSWORD_EXEMPT = new Set(['/api/auth/me', '/api/auth/logout', '/api/auth/change-password']);
export const passwordChangeGuard: RequestHandler = (req, _res, next) => {
  if (req.ctx.user?.mustChangePassword && !PASSWORD_EXEMPT.has(req.originalUrl.split('?')[0] ?? '')) {
    return next(forbidden('پیش از ادامه باید گذرواژه را عوض کنید.', 'PASSWORD_CHANGE_REQUIRED'));
  }
  next();
};

export async function resolveProjectAccess(pool: Pool, user: AuthUser, projectId: number): Promise<(ProjectAccess & { archived: boolean }) | null> {
  const db = poolDb(pool);
  const proj = await one<{ id: number; archived_at: Date | null }>(db, 'SELECT id, archived_at FROM projects WHERE id = $1', [projectId]);
  if (!proj) return null;
  const roleRows = await many<{ role: string }>(db, 'SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, user.id]);
  const roles: Role[] = roleRows.map((r) => r.role).filter(isRole);
  if (!user.isSystemAdmin && roles.length === 0) return null;
  const own = await many<{ id: number }>(db, 'SELECT id FROM resources WHERE project_id = $1 AND user_id = $2', [projectId, user.id]);
  return {
    id: projectId,
    roles,
    capabilities: capabilitiesOf(roles, { systemAdmin: user.isSystemAdmin }),
    isSystemAdmin: user.isSystemAdmin,
    ownResourceIds: own.map((r) => r.id),
    archived: proj.archived_at !== null,
  };
}

/**
 * مسیرهای `/projects/:pid/...`: کاربر باید عضو پروژه (یا ادمین سیستم) باشد.
 * برای نبودِ دسترسی عمداً 404 می‌دهیم تا وجود پروژه‌های دیگر فاش نشود.
 * پروژه‌ی بایگانی‌شده فقط‌خواندنی است.
 */
export function projectAccess(pool: Pool, opts: { allowArchivedWrites?: boolean } = {}): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const raw = req.params['pid'];
    const pid = typeof raw === 'string' && /^\d{1,9}$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(pid) || pid < 1) return next(notFound('پروژه پیدا نشد.', 'NO_PROJECT'));
    const access = await resolveProjectAccess(pool, actorOf(req), pid);
    if (!access) return next(notFound('پروژه پیدا نشد.', 'NO_PROJECT'));
    if (access.archived && !SAFE.has(req.method) && !opts.allowArchivedWrites) return next(conflict('این پروژه بایگانی شده و فقط‌خواندنی است.', 'ARCHIVED'));
    req.ctx.project = access;
    next();
  };
}

/** دسترسی لازم؛ یک یا چند قابلیت (هرکدام کافی است) */
export function requireCap(...caps: Capability[]): RequestHandler {
  return (req, _res, next) => {
    const p = req.ctx.project;
    if (!p) return next(forbidden());
    if (caps.some((c) => p.capabilities.includes(c))) return next();
    next(forbidden('نقش شما اجازه‌ی این کار را ندارد.', 'FORBIDDEN', { required: caps, mutation: caps.some(isMutation) }));
  };
}

export const requireSystemAdmin: RequestHandler = (req, _res, next) => {
  if (!req.ctx.user?.isSystemAdmin) return next(forbidden('فقط ادمین سیستم این کار را می‌تواند انجام دهد.', 'SYSTEM_ADMIN_ONLY'));
  next();
};

/** محدودکننده‌ی ساده‌ی در حافظه برای تلاش‌های ناموفق ورود به‌ازای IP */
export class FailureLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  blocked(key: string, now = Date.now()): boolean {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    this.hits.set(key, list);
    return list.length >= this.max;
  }
  fail(key: string, now = Date.now()): void {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v.every((t) => now - t >= this.windowMs)) this.hits.delete(k);
  }
  clear(key: string): void {
    this.hits.delete(key);
  }
}
