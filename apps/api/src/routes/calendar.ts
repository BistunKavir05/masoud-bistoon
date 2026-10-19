import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { validateCalendar } from '@bistoon/core';
import { actorInfo, writeAudit } from '../audit.ts';
import { withTx } from '../db.ts';
import { badRequest } from '../errors.ts';
import { projectOf } from '../http/types.ts';
import { projectAccess, requireCap } from '../middleware.ts';
import { isoDate, text } from '../schemas.ts';
import { loadCalendar, lockProject } from '../services/store.ts';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'ساعت باید به قالب HH:mm باشد.');
const daysBody = z.object({ days: z.array(z.object({ working: z.boolean(), from: time, to: time })).length(7) }).strict();
const holidayBody = z.object({ title: text(120).default('') }).strict();
const bulkBody = z.object({ holidays: z.array(z.object({ date: isoDate, title: text(120).default('') })).max(2000), replace: z.boolean().default(false) }).strict();

export function calendarRouter(pool: Pool): Router {
  const r = Router({ mergeParams: true });
  const base = projectAccess(pool);
  const guard = requireCap('schedule.edit');

  /** هفته‌ی کاری: هفت روز، اندیس ۰ یکشنبه … ۶ شنبه */
  r.put('/calendar/days', base, guard, async (req: Request, res: Response) => {
    const access = projectOf(req);
    const b = daysBody.parse(req.body);
    const cal = await withTx(pool, async (tx) => {
      await lockProject(tx, access.id);
      const before = await loadCalendar(tx, access.id);
      const issues = validateCalendar({ days: b.days, holidays: before.holidays });
      if (issues.length) throw badRequest(issues[0]!.message, { issues }, 'CALENDAR_INVALID');
      for (let d = 0; d < 7; d++) {
        const day = b.days[d]!;
        await tx.query('UPDATE project_workdays SET working = $3, from_time = $4, to_time = $5 WHERE project_id = $1 AND weekday = $2', [access.id, d, day.working, day.from, day.to]);
      }
      const after = await loadCalendar(tx, access.id);
      await writeAudit(tx, actorInfo(req), { projectId: access.id, action: 'calendar.days', entity: 'calendar', oldValue: before.days, newValue: after.days });
      return after;
    });
    res.json({ calendar: cal });
  });

  r.put('/calendar/holidays/:date', base, guard, async (req: Request, res: Response) => {
    const access = projectOf(req);
    const date = isoDate.parse(req.params['date']);
    const b = holidayBody.parse(req.body);
    const cal = await withTx(pool, async (tx) => {
      await lockProject(tx, access.id);
      await tx.query(
        `INSERT INTO project_holidays (project_id, holiday_date, title) VALUES ($1,$2,$3)
         ON CONFLICT (project_id, holiday_date) DO UPDATE SET title = EXCLUDED.title`,
        [access.id, date, b.title],
      );
      await writeAudit(tx, actorInfo(req), { projectId: access.id, action: 'calendar.holiday.set', entity: 'holiday', entityId: date, newValue: b.title });
      return loadCalendar(tx, access.id);
    });
    res.json({ calendar: cal });
  });

  r.delete('/calendar/holidays/:date', base, guard, async (req: Request, res: Response) => {
    const access = projectOf(req);
    const date = isoDate.parse(req.params['date']);
    const cal = await withTx(pool, async (tx) => {
      await lockProject(tx, access.id);
      const del = await tx.query('DELETE FROM project_holidays WHERE project_id = $1 AND holiday_date = $2', [access.id, date]);
      if (del.rowCount) await writeAudit(tx, actorInfo(req), { projectId: access.id, action: 'calendar.holiday.delete', entity: 'holiday', entityId: date });
      return loadCalendar(tx, access.id);
    });
    res.json({ calendar: cal });
  });

  /** افزودن گروهی تعطیلات (مثلاً تقویم رسمی سال)؛ با replace=true فهرست قبلی جایگزین می‌شود */
  r.post('/calendar/holidays', base, guard, async (req: Request, res: Response) => {
    const access = projectOf(req);
    const b = bulkBody.parse(req.body);
    const cal = await withTx(pool, async (tx) => {
      await lockProject(tx, access.id);
      if (b.replace) await tx.query('DELETE FROM project_holidays WHERE project_id = $1', [access.id]);
      for (const h of b.holidays) {
        await tx.query(
          `INSERT INTO project_holidays (project_id, holiday_date, title) VALUES ($1,$2,$3)
           ON CONFLICT (project_id, holiday_date) DO UPDATE SET title = EXCLUDED.title`,
          [access.id, h.date, h.title],
        );
      }
      await writeAudit(tx, actorInfo(req), { projectId: access.id, action: 'calendar.holiday.bulk', entity: 'calendar', newValue: { count: b.holidays.length, replace: b.replace } });
      return loadCalendar(tx, access.id);
    });
    res.json({ calendar: cal });
  });

  return r;
}
