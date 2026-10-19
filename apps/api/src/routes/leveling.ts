/**
 * تسطیح منابع: سرور پیشنهاد را خودش دوباره حساب می‌کند و فقط اگر با پیشنهادی که کاربر دیده یکی باشد اعمال می‌کند
 * (برنامه ممکن است بین نمایش و تأیید تغییر کرده باشد). قیدهای اعمال‌شده با منشأ «leveling» ثبت می‌شوند تا
 * «حذف تأخیرهای تسطیح» فقط همان‌ها را پاک کند و قیدهای دستی/MSP را دست نزند.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { levelResources } from '@bistoon/core';
import { actorInfo, writeAudit } from '../audit.ts';
import { withTx } from '../db.ts';
import { badRequest, conflict } from '../errors.ts';
import { actorOf, projectOf } from '../http/types.ts';
import { projectAccess, requireCap } from '../middleware.ts';
import { isoDate, posInt } from '../schemas.ts';
import { loadCalendar, loadResources, loadTasks, lockProject, saveTasks } from '../services/store.ts';

const applyBody = z.object({ moves: z.array(z.object({ taskId: posInt, startNoEarlierThan: isoDate })).min(1).max(2000) }).strict();

export function levelingRouter(pool: Pool): Router {
  const r = Router({ mergeParams: true });
  const base = projectAccess(pool);

  r.post('/leveling/apply', base, requireCap('schedule.edit'), async (req: Request, res: Response) => {
    const access = projectOf(req);
    const user = actorOf(req);
    const body = applyBody.parse(req.body);
    const out = await withTx(pool, async (tx) => {
      const project = await lockProject(tx, access.id);
      const tasks = await loadTasks(tx, access.id);
      const resources = await loadResources(tx, access.id);
      const calendar = await loadCalendar(tx, access.id);
      const result = levelResources({ start: project.start_date, status: project.status_date, calendar, tasks }, resources);
      if (!result) throw badRequest('برنامه وابستگی دایره‌ای دارد؛ تسطیح ممکن نیست.', undefined, 'CYCLE');
      const want = new Map(result.suggestions.map((s) => [s.taskId, s.startNoEarlierThan]));
      const given = new Map(body.moves.map((m) => [m.taskId, m.startNoEarlierThan]));
      const same = want.size === given.size && [...want].every(([id, d]) => given.get(id) === d);
      if (!same) throw conflict('برنامه یا منابع از زمان نمایش پیشنهاد تغییر کرده است؛ پیشنهاد را دوباره بسازید.', 'LEVELING_STALE', { expected: result.suggestions.length });
      const next = tasks.map((t) => (want.has(t.id) ? { ...t, startNoEarlierThan: want.get(t.id)!, startNoEarlierSource: 'leveling' as const } : t));
      await saveTasks(tx, access.id, tasks, next, user.id);
      await writeAudit(
        tx,
        actorInfo(req),
        result.suggestions.map((s) => ({
          projectId: access.id,
          action: 'task.update',
          entity: 'task',
          entityId: s.taskId,
          field: 'startNoEarlierThan',
          oldValue: tasks.find((t) => t.id === s.taskId)?.startNoEarlierThan ?? null,
          newValue: s.startNoEarlierThan,
          details: { name: s.name, source: 'leveling' },
        })),
      );
      return { applied: result.suggestions.length, tasks: await loadTasks(tx, access.id) };
    });
    res.json(out);
  });

  r.post('/leveling/clear', base, requireCap('schedule.edit'), async (req: Request, res: Response) => {
    const access = projectOf(req);
    const user = actorOf(req);
    const out = await withTx(pool, async (tx) => {
      await lockProject(tx, access.id);
      const tasks = await loadTasks(tx, access.id);
      const mine = tasks.filter((t) => t.startNoEarlierSource === 'leveling');
      if (mine.length === 0) return { cleared: 0, tasks };
      const ids = new Set(mine.map((t) => t.id));
      const next = tasks.map((t) => (ids.has(t.id) ? { ...t, startNoEarlierThan: null, startNoEarlierSource: null } : t));
      await saveTasks(tx, access.id, tasks, next, user.id);
      await writeAudit(
        tx,
        actorInfo(req),
        mine.map((t) => ({ projectId: access.id, action: 'task.update', entity: 'task', entityId: t.id, field: 'startNoEarlierThan', oldValue: t.startNoEarlierThan, newValue: null, details: { name: t.name, source: 'leveling-clear' } })),
      );
      return { cleared: mine.length, tasks: await loadTasks(tx, access.id) };
    });
    res.json(out);
  });

  return r;
}
