// آزمون دود: سرور واقعی (node src/server.ts، بدون vitest) را بالا می‌آورد و چند درخواست واقعی می‌زند.
// اجرا: DATABASE_URL=... node scripts/smoke.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const port = 3200 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_REQUESTS: 'false' };
const run = (args) =>
  new Promise((resolve, reject) => {
    const p = spawn('node', args, { env, stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`${args.join(' ')} → ${c}`))));
  });

const fail = (m) => {
  console.error('FAIL:', m);
  process.exitCode = 1;
};
let server;
try {
  await run(['src/cli.ts', 'create-admin', '--username', 'smoke', '--password', 'Smoke-pass-12345']);
  server = spawn('node', ['src/server.ts'], { env, stdio: ['ignore', 'inherit', 'inherit'] });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await sleep(250);
    try {
      up = (await fetch(`${base}/api/health`)).ok;
    } catch {
      /* هنوز بالا نیامده */
    }
  }
  if (!up) throw new Error('سرور بالا نیامد');

  const origin = { origin: base, 'content-type': 'application/json' };
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: origin, body: JSON.stringify({ username: 'smoke', password: 'Smoke-pass-12345' }) });
  if (login.status !== 200) throw new Error(`ورود ${login.status}`);
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const body = await login.json();
  if (!body.csrfToken) throw new Error('csrfToken برنگشت');
  const h = { ...origin, cookie, 'x-csrf-token': body.csrfToken };
  const blocked = await fetch(`${base}/api/projects`, { headers: h });
  if (blocked.status !== 403) fail(`باید تا تغییر گذرواژه مسدود باشد، ${blocked.status}`);
  const ch = await fetch(`${base}/api/auth/change-password`, { method: 'POST', headers: h, body: JSON.stringify({ currentPassword: 'Smoke-pass-12345', newPassword: 'Smoke-pass-67890-x' }) });
  if (ch.status !== 200) throw new Error(`تغییر گذرواژه ${ch.status} ${await ch.text()}`);
  const cookie2 = (ch.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')) || cookie;
  const me = await fetch(`${base}/api/auth/me`, { headers: { ...h, cookie: cookie2 } });
  if (me.status !== 200) throw new Error(`me ${me.status}`);
  console.log('smoke OK');
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
} finally {
  server?.kill('SIGTERM');
}
