/**
 * کلاینت HTTP: کوکی نشست خودکار می‌رود، توکن CSRF به همه‌ی درخواست‌های تغییردهنده اضافه می‌شود
 * و خطاها به ApiError با پیام فارسیِ سرور تبدیل می‌شوند.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | null;
  constructor(status: number, code: string, message: string, details?: unknown, requestId?: string | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId ?? null;
  }
  /** ویرایش هم‌زمان یا تغییر ساختار توسط دیگری */
  get isConflict(): boolean {
    return this.code === 'VERSION_CONFLICT' || this.code === 'STRUCTURE_CHANGED';
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'خطای ناشناخته';
}

let csrfToken: string | null = null;
export const setCsrfToken = (t: string | null): void => {
  csrfToken = t;
};

type Handler = () => void;
let onSessionExpired: Handler | null = null;
export const setSessionExpiredHandler = (h: Handler | null): void => {
  onSessionExpired = h;
};

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    if (csrfToken) headers['x-csrf-token'] = csrfToken;
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'ارتباط با سرور برقرار نشد. اتصال شبکه را بررسی کنید و دوباره تلاش کنید.');
  }
  const type = res.headers.get('content-type') ?? '';
  const data: unknown = type.includes('application/json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown; requestId?: string } } | null)?.error;
    const apiErr = new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? `خطای سرور (${res.status})`, err?.details, err?.requestId);
    if (res.status === 401 && apiErr.code === 'UNAUTHENTICATED') onSessionExpired?.();
    throw apiErr;
  }
  return data as T;
}

export const apiGet = <T>(path: string, signal?: AbortSignal): Promise<T> => request<T>('GET', path, undefined, signal);
export const apiPost = <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body ?? {});
export const apiPut = <T>(path: string, body?: unknown): Promise<T> => request<T>('PUT', path, body ?? {});
export const apiPatch = <T>(path: string, body: unknown): Promise<T> => request<T>('PATCH', path, body);
export const apiDelete = <T>(path: string, body?: unknown): Promise<T> => request<T>('DELETE', path, body ?? {});
