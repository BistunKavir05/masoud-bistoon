import type { Request } from 'express';
import type { Capability, Role } from '@bistoon/core';
import { forbidden, notFound, unauthorized } from '../errors.ts';

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  isSystemAdmin: boolean;
  mustChangePassword: boolean;
}

export interface ProjectAccess {
  id: number;
  roles: Role[];
  capabilities: Capability[];
  isSystemAdmin: boolean;
  /** منابع پروژه که به این کاربر وصل‌اند (برای نقش کارشناس) */
  ownResourceIds: number[];
}

export interface RequestContext {
  requestId: string;
  ip: string | null;
  user?: AuthUser;
  session?: { tokenHash: Buffer; csrfToken: string };
  project?: ProjectAccess;
}

declare module 'express-serve-static-core' {
  interface Request {
    ctx: RequestContext;
  }
}

export function actorOf(req: Request): AuthUser {
  const u = req.ctx.user;
  if (!u) throw unauthorized();
  return u;
}

export function projectOf(req: Request): ProjectAccess {
  const p = req.ctx.project;
  if (!p) throw forbidden('پروژه مشخص نشده است.');
  return p;
}

/** شناسه‌ی عددیِ مثبت از پارامتر مسیر؛ در غیر این‌صورت 404 */
export function intParam(req: Request, name: string): number {
  const raw = req.params[name];
  const v = typeof raw === 'string' && /^\d{1,9}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(v) || v < 1) throw notFound('شناسه نامعتبر است.', 'BAD_ID');
  return v;
}
