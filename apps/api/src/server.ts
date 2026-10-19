import { loadConfig } from './config.ts';
import { createApp, stdoutLogger } from './app.ts';
import { createPool, poolDb } from './db.ts';
import { defaultMigrationsDir, migrate } from './migrate.ts';
import { purgeExpiredSessions } from './auth/sessions.ts';

const config = loadConfig();
const pool = createPool(config.databaseUrl, 10, (e) => stdoutLogger({ level: 'error', msg: 'idle db client error', error: String(e) }));

const applied = await migrate(pool, config.migrationsDir ?? defaultMigrationsDir(), (m) => stdoutLogger({ level: 'info', msg: m }));
if (applied.length > 0) stdoutLogger({ level: 'info', msg: 'migrations applied', applied });

const app = createApp({ pool, config });
const server = app.listen(config.port, config.host, () => {
  stdoutLogger({ level: 'info', msg: 'listening', host: config.host, port: config.port });
});

const purge = setInterval(() => {
  purgeExpiredSessions(poolDb(pool)).catch((e: unknown) => stdoutLogger({ level: 'error', msg: 'session purge failed', error: String(e) }));
}, 60 * 60_000);
purge.unref();

let closing = false;
const shutdown = (signal: string): void => {
  if (closing) return;
  closing = true;
  stdoutLogger({ level: 'info', msg: 'shutting down', signal });
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
