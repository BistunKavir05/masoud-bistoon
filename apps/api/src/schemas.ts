import { z } from 'zod';
import { isIsoDate } from '@bistoon/core';

export const isoDate = z.string().refine((s) => isIsoDate(s), 'تاریخ نامعتبر است (قالب YYYY-MM-DD).');
export const isoDateOrNull = isoDate.nullable();
export const text = (max: number) => z.string().trim().max(max);
export const longText = z.string().max(20000);
export const version = z.number().int().min(1);
export const money = z.number().finite().min(0).max(9e15);
export const posInt = z.number().int().min(1).max(2_000_000_000);
