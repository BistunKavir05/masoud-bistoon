import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { actorInfo, writeAudit } from '../audit.ts';
import { many, one, poolDb, withTx } from '../db.ts';
import { forbidden, notFound } from '../errors.ts';
import { actorOf, intParam, projectOf } from '../http/types.ts';
import { projectAccess, requireCap } from '../middleware.ts';

const postBody = z.object({ body: z.string().trim().min(1).max(4000) }).strict();

interface MsgRow {
  id: number;
  user_id: number;
  display_name: string;
  body: string;
  created_at: Date;
  deleted_at: Date | null;
}

const toDto = (m: MsgRow) => ({
  id: m.id,
  userId: m.user_id,
  userName: m.display_name,
  // محتوای پیام حذف‌شده هرگز به کلاینت برنمی‌گردد
  body: m.deleted_at ? '' : m.body,
  createdAt: m.created_at,
  deleted: m.deleted_at !== null,
});

export function chatRouter(pool: Pool): Router {
  const r = Router({ mergeParams: true });
  const base = projectAccess(pool);
  const guard = requireCap('chat.use');

  /** بدون after: آخرین ۱۰۰ پیام؛ با after=<id>: پیام‌های جدیدتر (برای به‌روزرسانی دوره‌ای) */
  r.get('/chat', base, guard, async (req: Request, res: Response) => {
    const access = projectOf(req);
    const after = z.coerce.number().int().min(0).default(0).parse(req.query['after']);
    const limit = z.coerce.number().int().min(1).max(500).default(100).parse(req.query['limit']);
    const rows =
      after > 0
        ? await many<MsgRow>(
            poolDb(pool),
            `SELECT m.id, m.user_id, u.display_name, m.body, m.created_at, m.deleted_at FROM chat_messages m JOIN users u ON u.id = m.user_id
              WHERE m.project_id = $1 AND m.id > $2 ORDER BY m.id LIMIT $3`,
            [access.id, after, limit],
          )
        : (
            await many<MsgRow>(
              poolDb(pool),
              `SELECT m.id, m.user_id, u.display_name, m.body, m.created_at, m.deleted_at FROM chat_messages m JOIN users u ON u.id = m.user_id
                WHERE m.project_id = $1 ORDER BY m.id DESC LIMIT $2`,
              [access.id, limit],
            )
          ).reverse();
    res.json({ messages: rows.map(toDto) });
  });

  r.post('/chat', base, guard, async (req: Request, res: Response) => {
    const access = projectOf(req);
    const b = postBody.parse(req.body);
    const user = actorOf(req);
    const item = await withTx(pool, async (tx) => {
      const id = (await one<{ n: number }>(tx, 'SELECT next_seq($1, $2) AS n', [access.id, 'chat']))!.n;
      await tx.query('INSERT INTO chat_messages (project_id, id, user_id, body) VALUES ($1,$2,$3,$4)', [access.id, id, user.id, b.body]);
      const row = await one<MsgRow>(
        tx,
        `SELECT m.id, m.user_id, u.display_name, m.body, m.created_at, m.deleted_at FROM chat_messages m JOIN users u ON u.id = m.user_id WHERE m.project_id = $1 AND m.id = $2`,
        [access.id, id],
      );
      return toDto(row!);
    });
    res.status(201).json({ item });
  });

  /** حذف نرم: پیام خود کاربر، یا هر پیام برای کسی که chat.moderate دارد */
  r.delete('/chat/:id', base, guard, async (req: Request, res: Response) => {
    const access = projectOf(req);
    const id = intParam(req, 'id');
    const user = actorOf(req);
    await withTx(pool, async (tx) => {
      const m = await one<{ user_id: number; deleted_at: Date | null }>(tx, 'SELECT user_id, deleted_at FROM chat_messages WHERE project_id = $1 AND id = $2 FOR UPDATE', [access.id, id]);
      if (!m) throw notFound('پیام پیدا نشد.', 'NOT_FOUND');
      if (m.user_id !== user.id && !access.capabilities.includes('chat.moderate')) throw forbidden('فقط پیام خودتان را می‌توانید حذف کنید.', 'NOT_YOUR_MESSAGE');
      if (m.deleted_at) return;
      await tx.query('UPDATE chat_messages SET deleted_at = now(), deleted_by = $3 WHERE project_id = $1 AND id = $2', [access.id, id, user.id]);
      await writeAudit(tx, actorInfo(req), { projectId: access.id, action: 'chat.delete', entity: 'chat', entityId: id, details: { author: m.user_id } });
    });
    res.json({ ok: true });
  });

  return r;
}
