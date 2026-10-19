import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import type { Express, Request, Response } from 'express';
import type { Pool } from 'pg';
import type { Config } from './config.ts';
import { poolDb } from './db.ts';
import { makeErrorHandler, notFoundHandler } from './errors.ts';
import { FailureLimiter, authenticate, csrfGuard, originGuard, passwordChangeGuard, requestContext } from './middleware.ts';
import type { Logger } from './middleware.ts';
import { auditRouter } from './routes/audit.ts';
import { authRouters } from './routes/auth.ts';
import { baselinesRouter } from './routes/baselines.ts';
import { calendarRouter } from './routes/calendar.ts';
import { charterContractRouter } from './routes/charterContract.ts';
import { chatRouter } from './routes/chat.ts';
import { costsRouter } from './routes/costs.ts';
import { documentsRouter } from './routes/documents.ts';
import { importExportRouter } from './routes/importExport.ts';
import { levelingRouter } from './routes/leveling.ts';
import { modelRouter } from './routes/model.ts';
import { portfolioRouter } from './routes/portfolio.ts';
import { projectsRouter } from './routes/projects.ts';
import { recordsRouter } from './routes/records.ts';
import { resourcesRouter } from './routes/resources.ts';
import { tasksRouter } from './routes/tasks.ts';
import { usersRouter } from './routes/users.ts';

export interface AppDeps {
  pool: Pool;
  config: Config;
  log?: Logger;
}

export const stdoutLogger: Logger = (line) => {
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), ...line })}\n`);
};

export function createApp({ pool, config, log = stdoutLogger }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  if (config.trustProxy) {
    const v = config.trustProxy;
    app.set('trust proxy', /^\d+$/.test(v) ? Number(v) : v === 'true' ? true : v);
  }

  app.use(requestContext(config, log));

  const api = express.Router();
  api.use(express.json({ limit: config.bodyLimit, type: 'application/json' }));
  api.use(originGuard(config));

  api.get('/health', async (_req: Request, res: Response) => {
    await poolDb(pool).query('SELECT 1');
    res.json({ ok: true, time: new Date().toISOString() });
  });

  const limiter = new FailureLimiter(20, 10 * 60_000);
  const auth = authRouters(pool, config, limiter);
  api.use('/auth', auth.pub);

  // از این‌جا به بعد نشست معتبر، CSRF و (در صورت لزوم) تغییر گذرواژه الزامی است
  api.use(authenticate(pool, config), csrfGuard, passwordChangeGuard);
  api.use('/auth', auth.session);
  api.use(usersRouter(pool));
  api.use(projectsRouter(pool));
  api.use(portfolioRouter(pool));
  api.use(importExportRouter(pool));
  api.use('/projects/:pid', modelRouter(pool));
  api.use('/projects/:pid', tasksRouter(pool));
  api.use('/projects/:pid', resourcesRouter(pool));
  api.use('/projects/:pid', levelingRouter(pool));
  api.use('/projects/:pid', calendarRouter(pool));
  api.use('/projects/:pid', baselinesRouter(pool));
  api.use('/projects/:pid', costsRouter(pool));
  api.use('/projects/:pid', charterContractRouter(pool));
  api.use('/projects/:pid', recordsRouter(pool));
  api.use('/projects/:pid', documentsRouter(pool));
  api.use('/projects/:pid', chatRouter(pool));
  api.use('/projects/:pid', auditRouter(pool));

  app.use('/api', api);
  app.use('/api', notFoundHandler);

  if (config.webDist) {
    const dist = resolve(config.webDist);
    const index = resolve(dist, 'index.html');
    if (existsSync(index)) {
      app.use(express.static(dist, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (p.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
      app.get(/^\/(?!api\/).*/, (_req: Request, res: Response) => {
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(index);
      });
    }
  }

  app.use(makeErrorHandler(log));
  return app;
}
