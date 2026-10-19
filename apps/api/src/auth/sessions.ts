import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db.ts';
import { one } from '../db.ts';
import type { AuthUser } from '../http/types.ts';

export const SESSION_COOKIE = 'bistoon_sid';
/** حداکثر عمر مطلق نشست، فارغ از فعالیت */
export const SESSION_ABSOLUTE_DAYS = 14;

export const newToken = (): string => randomBytes(32).toString('base64url');
export const hashToken = (token: string): Buffer => createHash('sha256').update(token).digest();

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* کوکی خراب را نادیده بگیر */
    }
  }
  return out;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export interface CreatedSession {
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

export async function createSession(db: Db, userId: number, ttlHours: number, ip: string | null, userAgent: string | null): Promise<CreatedSession> {
  const token = newToken();
  const csrfToken = newToken();
  const row = await one<{ expires_at: Date }>(
    db,
    `INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, now() + make_interval(hours => $4), $5, left($6, 300))
     RETURNING expires_at`,
    [hashToken(token), userId, csrfToken, ttlHours, ip, userAgent],
  );
  return { token, csrfToken, expiresAt: row!.expires_at };
}

export interface LoadedSession {
  user: AuthUser;
  tokenHash: Buffer;
  csrfToken: string;
}

interface SessionRow {
  csrf_token: string;
  user_id: number;
  username: string;
  display_name: string;
  is_system_admin: boolean;
  must_change_password: boolean;
  last_seen_at: Date;
}

/** نشست معتبر را برمی‌گرداند و (حداکثر هر ۵ دقیقه یک‌بار) انقضا را جلو می‌برد. */
export async function loadSession(db: Db, token: string, ttlHours: number): Promise<LoadedSession | null> {
  const tokenHash = hashToken(token);
  const row = await one<SessionRow>(
    db,
    `SELECT s.csrf_token, s.last_seen_at, u.id AS user_id, u.username, u.display_name, u.is_system_admin, u.must_change_password
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active
        AND s.created_at > now() - make_interval(days => $2)`,
    [tokenHash, SESSION_ABSOLUTE_DAYS],
  );
  if (!row) return null;
  if (Date.now() - row.last_seen_at.getTime() > 5 * 60_000) {
    await db.query(
      `UPDATE sessions SET last_seen_at = now(),
              expires_at = LEAST(now() + make_interval(hours => $2), created_at + make_interval(days => $3))
        WHERE token_hash = $1`,
      [tokenHash, ttlHours, SESSION_ABSOLUTE_DAYS],
    );
  }
  return {
    tokenHash,
    csrfToken: row.csrf_token,
    user: {
      id: row.user_id,
      username: row.username,
      displayName: row.display_name,
      isSystemAdmin: row.is_system_admin,
      mustChangePassword: row.must_change_password,
    },
  };
}

export async function deleteSession(db: Db, tokenHash: Buffer): Promise<void> {
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
}

export async function deleteUserSessions(db: Db, userId: number, exceptTokenHash?: Buffer): Promise<void> {
  if (exceptTokenHash) await db.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [userId, exceptTokenHash]);
  else await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

export async function purgeExpiredSessions(db: Db): Promise<number> {
  const r = await db.query('DELETE FROM sessions WHERE expires_at < now()');
  return r.rowCount ?? 0;
}
