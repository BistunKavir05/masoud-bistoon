// ساخت رابط کاربری با esbuild: یک بسته‌ی JS، یک CSS، فونت‌ها و index.html در dist/
// استفاده:  node build.mjs [--watch] [--dev]
import { build, context } from 'esbuild';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const watch = process.argv.includes('--watch');
const dev = watch || process.argv.includes('--dev');

const options = {
  absWorkingDir: here,
  entryPoints: { app: 'src/main.tsx' },
  outdir: 'dist/assets',
  entryNames: '[name]-[hash]',
  assetNames: '[name]-[hash]',
  bundle: true,
  format: 'esm',
  target: ['chrome110', 'edge110', 'firefox110', 'safari16'],
  jsx: 'automatic',
  loader: { '.woff2': 'file' },
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  metafile: true,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
  logLevel: 'info',
  plugins: [
    {
      name: 'write-index',
      setup(b) {
        b.onEnd(async (result) => {
          if (result.errors.length) return;
          const outs = Object.keys(result.metafile.outputs).map((p) => relative(dist, join(here, p)).replaceAll('\\', '/'));
          const js = outs.find((p) => p.endsWith('.js'));
          const css = outs.find((p) => p.endsWith('.css'));
          const tpl = await readFile(join(here, 'index.html'), 'utf8');
          const html = tpl.replace('<!--CSS-->', css ? `<link rel="stylesheet" href="/${css}">` : '').replace('<!--JS-->', `<script type="module" src="/${js}"></script>`);
          await writeFile(join(dist, 'index.html'), html);
        });
      },
    },
  ],
};

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('در حال مشاهده‌ی تغییرات… (Ctrl+C برای خروج)');
} else {
  await build(options);
}
