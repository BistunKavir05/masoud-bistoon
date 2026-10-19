import { Pool, types } from 'pg';
import type { QueryResult, QueryResultRow } from 'pg';

/** رابط حداقلیِ دسترسی به پایگاه‌داده؛ هم برای اتصال تکی داخل تراکنش و هم برای Pool. */
export interface Db {
  query<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<R>>;
}

/**
 * تبدیل نوع‌ها: date همان رشته‌ی YYYY-MM-DD بماند (نه Date محلی)، numeric و bigint عدد جاوااسکریپت شوند.
 * مبالغ در حوزه اعداد صحیح‌اند و کمتر از 2^53 می‌مانند؛ شناسه‌ها کوچک‌اند.
 */
const customTypes = {
  getTypeParser(oid: number, format?: 'text' | 'binary') {
    if (oid === 1082) return (v: string): string => v;
    if (oid === 1700 || oid === 20) return (v: string): number => Number(v);
    return types.getTypeParser(oid as never, format as never);
  },
};

export function createPool(connectionString: string, max = 10, onError: (e: Error) => void = () => {}): Pool {
  const pool = new Pool({ connectionString, max, types: customTypes as never, idleTimeoutMillis: 30_000 });
  // خطای یک اتصال بیکار (مثلاً ری‌استارت پایگاه‌داده، کد 57P01) نباید کل فرایند را بیندازد؛ اتصال خراب از Pool حذف می‌شود.
  pool.on('error', onError);
  return pool;
}

export function poolDb(pool: Pool): Db {
  return { query: (text, params) => pool.query(text, params as unknown[]) as never };
}

const RETRYABLE = new Set(['40001', '40P01']);
export const isRetryable = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && RETRYABLE.has((e as { code?: string }).code ?? '');

/** اجرای تابع در یک تراکنش؛ در تعارض سریال‌سازی یا بن‌بست تا ۳ بار دوباره تلاش می‌کند. */
export async function withTx<T>(pool: Pool, fn: (db: Db) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const client = await pool.connect();
    const db: Db = { query: (text, params) => client.query(text, params as unknown[]) as never };
    try {
      await client.query('BEGIN');
      const result = await fn(db);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* اتصال خراب است؛ release آن را دور می‌اندازد */
      }
      if (attempt < 3 && isRetryable(e)) continue;
      throw e;
    } finally {
      client.release();
    }
  }
}

export async function many<R extends QueryResultRow>(db: Db, text: string, params: unknown[] = []): Promise<R[]> {
  return (await db.query<R>(text, params)).rows;
}

export async function one<R extends QueryResultRow>(db: Db, text: string, params: unknown[] = []): Promise<R | undefined> {
  return (await db.query<R>(text, params)).rows[0];
}
