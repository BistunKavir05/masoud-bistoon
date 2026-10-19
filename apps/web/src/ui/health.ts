import type { HealthStatus } from '@bistoon/core';

/** برچسب و رنگ نشان‌دهنده‌ی سلامت پروژه (مشترک بین داشبورد و گزارش وضعیت) */
export const HEALTH: Record<HealthStatus, { label: string; kind: 'ok' | 'warn' | 'bad' | '' }> = {
  ok: { label: 'طبق برنامه', kind: 'ok' },
  watch: { label: 'نیازمند توجه', kind: 'warn' },
  late: { label: 'عقب از برنامه', kind: 'bad' },
  unknown: { label: 'نامشخص', kind: '' },
};
