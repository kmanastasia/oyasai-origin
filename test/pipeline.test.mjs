// 封をする流れを、手元のサーバーを本物の API の代わりにして確かめる。実行中のデータは一時フォルダに置く。
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';

const json = (path) => JSON.parse(readFileSync(new URL(`../data/${path}`, import.meta.url), 'utf8'));
const transcript = readFileSync(new URL('../data/transcript.md', import.meta.url), 'utf8');
const archive = json('replay/farm_archive.json');

let requests = [];
let liveArchive = archive;
let liveTranslations = () => ({ translations: [] });
let server;
let runtimeDir;

const answerFor = (body) => {
  const { properties } = body.output_config.format.schema;
  if (properties.entries) return liveArchive;
  if (properties.chapters) return { card_teaser_entry_id: null, land_entry_ids: [], chapters: [] };
  return liveTranslations(JSON.parse(body.messages[0].content.slice(body.messages[0].content.indexOf('['))));
};

before(async () => {
  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(body);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'text', text: JSON.stringify(answerFor(body)) }],
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = 'test-key';
});

after(() => server.close());

const { configure, createDraft, getLetter, isDemo, sealLetter, unsealLetter } = await import('../server/pipeline.mjs');

beforeEach(() => {
  requests = [];
  liveArchive = archive;
  liveTranslations = () => ({ translations: [] });
  if (runtimeDir) rmSync(runtimeDir, { recursive: true, force: true });
  runtimeDir = mkdtempSync(join(tmpdir(), 'oyasai-test-'));
});

const allYes = (draft) => draft.entries.map((e) => ({ id: e.id, reply: 'yes' }));

test('demo は API キーがあっても通信せず、最後まで動く', async () => {
  configure({ demo: true, runtimeDir });
  assert.equal(isDemo(), true);
  const draft = await createDraft(transcript);
  assert.equal(draft.source, 'replay');
  assert.match(draft.notice, /npm run demo/);
  await sealLetter(allYes(draft));
  const letter = await getLetter();
  assert.ok(letter.chapters.some((c) => c.items.length > 0));
  assert.ok(Object.keys(letter.translations).length > 0);
  assert.equal(requests.length, 0);
});

test('demo に別の文字起こしを貼ると、通信せず次にすることを添えて止める', async () => {
  configure({ demo: true, runtimeDir });
  await assert.rejects(createDraft('みなみ：別の話です。'), (error) => error.next.includes('聞き取りの見本'));
  assert.equal(requests.length, 0);
});
