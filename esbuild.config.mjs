import { build, context } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const dist = path.join(root, 'dist');

const watch = process.argv.includes('--watch');

const shared = {
  bundle: true,
  format: 'iife',
  target: 'es2022',
  sourcemap: false,
  minify: false,
  logLevel: 'info',
};

const configs = [
  {
    ...shared,
    entryPoints: [path.join(root, 'src', 'background.ts')],
    outfile: path.join(dist, 'background.js'),
  },
  {
    ...shared,
    entryPoints: [path.join(root, 'src', 'content.ts')],
    outfile: path.join(dist, 'content.js'),
  },
  {
    ...shared,
    entryPoints: [path.join(root, 'src', 'popup', 'popup.ts')],
    outfile: path.join(dist, 'popup', 'popup.js'),
  },
];

/** 复制 manifest 与静态资源到 dist */
function copyStatic() {
  mkdirSync(dist, { recursive: true });
  const items = ['manifest.json', 'assets', 'icons'];
  for (const it of items) {
    const from = path.join(root, it);
    try {
      cpSync(from, path.join(dist, it), { recursive: true });
    } catch {
      // 不存在则跳过(icons/assets 可选)
    }
  }
  // popup HTML
  try {
    mkdirSync(path.join(dist, 'popup'), { recursive: true });
    cpSync(path.join(root, 'src', 'popup', 'popup.html'), path.join(dist, 'popup', 'popup.html'));
  } catch {
    // 忽略
  }
}

async function buildAll() {
  rmSync(dist, { recursive: true, force: true });
  copyStatic();
  await Promise.all(configs.map((c) => build(c)));
  copyStatic();
  console.log('[build] 产物输出到 dist/');
}

async function watchAll() {
  rmSync(dist, { recursive: true, force: true });
  copyStatic();
  const ctxs = await Promise.all(configs.map((c) => context(c)));
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log('[watch] 构建完成，监听中…');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function run() {
  if (watch) {
    await watchAll();
  } else {
    await buildAll();
  }
}
