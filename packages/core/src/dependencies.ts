/** تجزیه و قالب‌بندی رشته‌ی پیش‌نیاز مانند `12FS+1,8SS,4FF-2` */
import type { Dependency, DependencyType } from './types.ts';
import { normalizeDigits } from './jalali.ts';

const TOKEN_RE = /^(\d+)(FS|SS|FF|SF)?([+-]\d+)?$/i;

export interface DependencyParseResult {
  dependencies: Dependency[];
  /** قطعه‌هایی که قالب معتبر نداشتند (برای نمایش خطا یا گزارش مهاجرت) */
  invalid: string[];
}

/** جداکننده‌ها: ویرگول انگلیسی و فارسی و فاصله. ارقام فارسی هم پذیرفته می‌شوند. */
export function parseDependencies(text: string): DependencyParseResult {
  const dependencies: Dependency[] = [];
  const invalid: string[] = [];
  const parts = normalizeDigits(String(text ?? ''))
    .split(/[,،\s]+/)
    .filter(Boolean);
  for (const part of parts) {
    const m = TOKEN_RE.exec(part);
    if (!m) {
      invalid.push(part);
      continue;
    }
    dependencies.push({ predecessorId: Number(m[1]), type: (m[2] ?? 'FS').toUpperCase() as DependencyType, lag: Number(m[3] ?? 0) });
  }
  return { dependencies, invalid };
}

export function formatDependencies(deps: readonly Dependency[]): string {
  return deps.map((d) => `${d.predecessorId}${d.type}${d.lag === 0 ? '' : d.lag > 0 ? `+${d.lag}` : String(d.lag)}`).join(',');
}
