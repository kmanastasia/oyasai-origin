import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UserError } from '../lib/ingest.mjs';
import { configure, createDraft, getDraft, getLetter, getOffer, getUiStrings, isDemo, readSampleTranscript, resetAll, sealLetter, unsealLetter } from './pipeline.mjs';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '127.0.0.1';
const MAX_BODY = 512 * 1024;

if (process.argv.includes('--demo')) configure({ demo: true });

const PAGES = { '/': 'index.html', '/keep': 'keep.html', '/seal': 'seal.html', '/choose': 'choose.html', '/letter': 'letter.html' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif' };

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new UserError('文字起こしが長すぎます。', '500KB 以内に分けて、もう一度貼ってください。');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new UserError('送られた内容を読めませんでした。', 'ページを開き直して、もう一度試してください。');
  }
}

const ROUTES = {
  'GET /api/sample': async () => ({ transcript: await readSampleTranscript() }),
  'GET /api/draft': async () => ({ draft: await getDraft(), demo: isDemo() }),
  'POST /api/draft': async (req) => ({ draft: await createDraft((await readBody(req)).transcript) }),
  'POST /api/seal': async (req) => {
    const { decisions, checked_with_farmer: checkedWithFarmer } = await readBody(req);
    const { letter, published } = await sealLetter(Array.isArray(decisions) ? decisions : [], checkedWithFarmer === true);
    return {
      sealed: true,
      chapters: letter.chapters.map((c) => c.items.length),
      archive_only: published.entries.filter((e) => e.reply === 'archive_only').length,
      checked_with_farmer: published.checked_with_farmer,
    };
  },
  'POST /api/unseal': async () => {
    await unsealLetter();
    return { sealed: false };
  },
  'POST /api/reset': async () => {
    await resetAll();
    return { reset: true };
  },
  'GET /api/letter': async () => ({ letter: await getLetter(), offer: await getOffer() }),
  'GET /api/ui-strings': async () => ({ strings: await getUiStrings() }),
};

async function serveStatic(pathname, res) {
  const file = PAGES[pathname] ?? pathname.slice(1);
  const resolved = normalize(join(publicDir, file));
  if (!resolved.startsWith(publicDir)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const body = await readFile(resolved);
    res.writeHead(200, { 'content-type': TYPES[extname(resolved)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('ページが見つかりません。トップ（/）から始めてください。');
  }
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (!pathname.startsWith('/api/')) {
    await serveStatic(pathname, res);
    return;
  }
  const route = ROUTES[`${req.method} ${pathname}`];
  if (!route) {
    sendJson(res, 404, { error: 'その操作はありません。', next: 'ページを開き直してください。' });
    return;
  }
  try {
    sendJson(res, 200, await route(req));
  } catch (error) {
    if (error instanceof UserError) {
      sendJson(res, 400, { error: error.message, next: error.next });
    } else {
      console.error(error);
      sendJson(res, 500, { error: 'うまく処理できませんでした。', next: 'npm run dev を起動し直して、もう一度試してください。' });
    }
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`ポート ${PORT} はすでに使われています。PORT=3001 npm run dev のように別の番号で起動してください。`);
  } else {
    console.error(error);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`OYASAI ORIGIN: http://localhost:${PORT}/keep`);
  if (isDemo()) {
    console.log('npm run demo：同梱の保存データだけで動きます。API キーがあっても Claude は呼びません。');
  } else if (!process.env.ANTHROPIC_API_KEY) {
    console.log('API キーがないので、同梱の保存データで動きます（.env に ANTHROPIC_API_KEY を入れると Claude を呼びます）。');
  }
});
