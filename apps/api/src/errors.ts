import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown, code = 'BAD_REQUEST'): HttpError => new HttpError(400, code, message, details);
export const unauthorized = (message = 'ابتدا وارد شوید.', code = 'UNAUTHENTICATED'): HttpError => new HttpError(401, code, message);
export const forbidden = (message = 'اجازه‌ی این کار را ندارید.', code = 'FORBIDDEN', details?: unknown): HttpError => new HttpError(403, code, message, details);
export const notFound = (message = 'پیدا نشد.', code = 'NOT_FOUND'): HttpError => new HttpError(404, code, message);
export const conflict = (message: string, code = 'CONFLICT', details?: unknown): HttpError => new HttpError(409, code, message, details);
export const tooMany = (message: string, code = 'TOO_MANY_REQUESTS'): HttpError => new HttpError(429, code, message);

/** ویرایش هم‌زمان: ردیف از وقتی کاربر آن را خوانده تغییر کرده است. */
export const versionConflict = (current: unknown): HttpError =>
  conflict('این مورد در این فاصله توسط کاربر دیگری تغییر کرده است. صفحه را تازه کنید و دوباره تلاش کنید.', 'VERSION_CONFLICT', { current });

interface PgLikeError {
  code?: string;
  constraint?: string;
  detail?: string;
  table?: string;
}

/** تبدیل خطاهای PostgreSQL به پاسخ قابل‌فهم؛ جزئیات داخلی به کلاینت نمی‌رود. */
export function mapPgError(e: PgLikeError): HttpError | null {
  switch (e.code) {
    case '23505':
      return conflict('مقدار تکراری است.', 'DUPLICATE', { constraint: e.constraint });
    case '23503':
      return conflict('این مورد در جای دیگری استفاده شده یا مرجع آن وجود ندارد.', 'REFERENCE', { constraint: e.constraint });
    case '23514':
      return badRequest('مقدار با قواعد داده سازگار نیست.', { constraint: e.constraint }, 'CONSTRAINT');
    case '23502':
      return badRequest('یک مقدار الزامی خالی است.', { constraint: e.constraint }, 'REQUIRED');
    case '22P02':
    case '22007':
    case '22008':
    case '22003':
      return badRequest('قالب یا محدوده‌ی یکی از مقادیر نامعتبر است.', undefined, 'INVALID_VALUE');
    case '40001':
    case '40P01':
      return new HttpError(503, 'RETRY', 'سیستم مشغول است؛ دوباره تلاش کنید.');
    default:
      return null;
  }
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(notFound(`مسیر ${req.method} ${req.path} وجود ندارد.`, 'NO_ROUTE'));
};

export function makeErrorHandler(log: (line: Record<string, unknown>) => void): ErrorRequestHandler {
  return (err, req, res, _next) => {
    let http: HttpError | null = null;
    if (err instanceof HttpError) http = err;
    else if (err instanceof ZodError) {
      http = badRequest(
        'ورودی نامعتبر است.',
        err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        'VALIDATION',
      );
    } else if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.too.large') {
      http = new HttpError(413, 'TOO_LARGE', 'حجم درخواست بیش از حد مجاز است.');
    } else if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.parse.failed') {
      http = badRequest('بدنه‌ی درخواست JSON معتبر نیست.', undefined, 'BAD_JSON');
    } else if (err && typeof err === 'object') {
      http = mapPgError(err as PgLikeError);
    }
    const requestId = req.ctx?.requestId ?? '';
    if (!http) {
      log({ level: 'error', msg: 'unhandled', requestId, error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err) });
      res.status(500).json({ error: { code: 'INTERNAL', message: 'خطای داخلی سرور.', requestId } });
      return;
    }
    res.status(http.status).json({ error: { code: http.code, message: http.message, details: http.details, requestId } });
  };
}
