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
    let answer;
    try {
      answer = answerFor(body);
    } catch {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'down' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'text', text: JSON.stringify(answer) }],
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = 'test-key';
});

after(() => {
  server.close();
  if (runtimeDir) rmSync(runtimeDir, { recursive: true, force: true });
});

const { configure, createDraft, getLetter, isDemo, sealLetter, unsealLetter } = await import('../server/pipeline.mjs');

beforeEach(() => {
  requests = [];
  liveArchive = archive;
  liveTranslations = () => ({ translations: [] });
  if (runtimeDir) rmSync(runtimeDir, { recursive: true, force: true });
  runtimeDir = `${mkdtempSync(join(tmpdir(), 'oyasai-test-'))}/`;
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

test('「本人と一緒に見ている」の値は、封をした原本に残る', async () => {
  configure({ demo: true, runtimeDir });
  const draft = await createDraft(transcript);
  const { published } = await sealLetter(allYes(draft));
  assert.equal(published.checked_with_farmer, false);
  const again = await sealLetter(allYes(draft), true);
  assert.equal(again.published.checked_with_farmer, true);
  assert.ok(again.published.entries.every((e) => e.checked_with_farmer === true));
  assert.equal(requests.length, 0);
});

test('demo に別の文字起こしを貼ると、通信せず次にすることを添えて止める', async () => {
  configure({ demo: true, runtimeDir });
  await assert.rejects(createDraft('みなみ：別の話です。'), (error) => error.next.includes('聞き取りの見本'));
  assert.equal(requests.length, 0);
});

const kinds = () => requests.map((body) => Object.keys(body.output_config.format.schema.properties).join());

test('鍵があっても、原文が同じ訳は取り直さず、id が変わっても同じ英語が出る', async () => {
  configure({ runtimeDir });
  const saved = json('translations.en.json');
  // ライブの下書きは id が保存データと違うことがある
  liveArchive = { ...archive, entries: archive.entries.map((e) => ({ ...e, id: e.id.replace('e-', 'live-') })), next_questions: [] };
  const draft = await createDraft(transcript);
  await sealLetter(allYes(draft));
  assert.ok(!kinds().includes('translations'));
  const letter = await getLetter();
  assert.equal(letter.translations['live-03'].text, saved.translations.find((t) => t.ref_id === 'e-03').text);
});

test('原文が違う項目だけ訳を頼み、頼んだ訳は封をし直しても取り直さない', async () => {
  configure({ runtimeDir });
  const changed = { ...archive.entries[2], id: 'live-new', quote: '葉の先が丸まったら' };
  liveArchive = { entries: [archive.entries[0], changed], next_questions: [] };
  liveTranslations = (list) => ({ translations: list.map((x) => ({ ref_id: x.id, text: `LIVE ${x.quote}`, reason_text: null, title_text: 't', untranslated: [] })) });
  const draft = await createDraft(transcript);
  await sealLetter(allYes(draft));
  assert.equal(kinds().filter((k) => k === 'translations').length, 1);
  const asked = requests.find((body) => body.output_config.format.schema.properties.translations);
  assert.ok(!asked.messages[0].content.includes(archive.entries[0].quote));
  const first = await getLetter();
  assert.equal(first.translations['live-new'].text, 'LIVE 葉の先が丸まったら');
  assert.equal(first.translations['e-01'].text, json('translations.en.json').translations[0].text);

  await unsealLetter();
  await sealLetter(allYes(draft));
  assert.equal(kinds().filter((k) => k === 'translations').length, 1);
  const second = await getLetter();
  assert.equal(second.archive_version, 2);
  assert.equal(second.translations['live-new'].text, first.translations['live-new'].text);
});

test('訳の通信が落ちても、保存してある訳で封をする。原文が違う項目には英語を出さない', async () => {
  configure({ runtimeDir });
  liveArchive = { entries: [archive.entries[0], { ...archive.entries[2], id: 'live-new', quote: '葉の先が丸まったら' }], next_questions: [] };
  liveTranslations = () => {
    throw new Error('down');
  };
  const draft = await createDraft(transcript);
  await sealLetter(allYes(draft)).catch(() => assert.fail('封ができませんでした'));
  const letter = await getLetter();
  assert.ok(letter.translations['e-01']);
  assert.equal(letter.translations['live-new'], undefined);
});

test('API キーがなければ、同梱の文字起こしは保存データで最後まで動き、別の文字起こしは次にすることを添えて止める', async () => {
  configure({ runtimeDir });
  const key = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const draft = await createDraft(transcript);
    assert.equal(draft.source, 'replay');
    assert.match(draft.notice, /ANTHROPIC_API_KEY/);
    await sealLetter(allYes(draft));
    assert.ok(Object.keys((await getLetter()).translations).length > 0);
    await assert.rejects(createDraft('みなみ：別の話です。'), (error) => error.next.includes('ANTHROPIC_API_KEY'));
  } finally {
    process.env.ANTHROPIC_API_KEY = key;
  }
  assert.equal(requests.length, 0);
});
