// 本物の API の代わりに手元のサーバーを立てて、送る内容と、失敗したときの動きを確かめる。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, beforeEach, test } from 'node:test';

let replies = [];
let requests = [];
let server;

const message = (fields) => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
  content: [{ type: 'text', text: '{"entries":[],"next_questions":[]}' }],
  ...fields,
});

before(async () => {
  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString()) });
    const { status = 200, body = message({}) } = replies.shift() ?? {};
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = 'test-key';
});

after(() => server.close());

beforeEach(() => {
  replies = [];
  requests = [];
});

const paragraphs = [{ id: 'p.01', text: '霜が降りるまで抜かん。' }];
const { NoApiKeyError, runAssignment, runFarmArchive, runTranslation } = await import('../server/claude.mjs');

test('分類は high、モデルと形の指定、断られたときの備えを送る', async () => {
  await runFarmArchive(paragraphs);
  const { body, headers } = requests[0];
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.output_config.effort, 'high');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.ok(body.output_config.format.schema.properties.entries);
  assert.deepEqual(body.thinking, { type: 'adaptive' });
  assert.equal(body.fallbacks, 'default');
  assert.match(headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.match(body.system, /一字も直しません/);
  assert.match(body.messages[0].content, /p\.01 霜が降りるまで抜かん。/);
});

test('割り当てと英訳は medium', async () => {
  replies = [{ body: message({ content: [{ type: 'text', text: '{"card_teaser_entry_id":null,"land_entry_ids":[],"chapters":[]}' }] }) }, { body: message({ content: [{ type: 'text', text: '{"translations":[]}' }] }) }];
  await runAssignment([]);
  await runTranslation([]);
  assert.equal(requests[0].body.output_config.effort, 'medium');
  assert.equal(requests[1].body.output_config.effort, 'medium');
});

test('通信が落ちたら1回だけ再試行する', async () => {
  replies = [{ status: 500, body: { type: 'error', error: { type: 'api_error', message: 'x' } } }];
  const result = await runFarmArchive(paragraphs);
  assert.deepEqual(result, { entries: [], next_questions: [] });
  assert.equal(requests.length, 2);
});

test('2回失敗したら投げて、保存データに任せる', async () => {
  const failure = { status: 500, body: { type: 'error', error: { type: 'api_error', message: 'x' } } };
  replies = [failure, failure];
  await assert.rejects(runFarmArchive(paragraphs));
  assert.equal(requests.length, 2);
});

test('断られたら本文を読まずに止める', async () => {
  replies = [{ body: message({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'bio' }, content: [] }) }];
  await assert.rejects(runFarmArchive(paragraphs), /断りました（bio）/);
  assert.equal(requests.length, 1);
});

test('上限で切れた出力は使わない', async () => {
  replies = [{ body: message({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"entries":[' }] }) }];
  await assert.rejects(runFarmArchive(paragraphs), /上限で切れ/);
});

test('先頭が fallback のブロックでも、次の text を本文として読む', async () => {
  replies = [{ body: message({ stop_reason: 'end_turn', content: [{ type: 'fallback' }, { type: 'text', text: '{"entries":[],"next_questions":[]}' }] }) }];
  assert.deepEqual(await runFarmArchive(paragraphs), { entries: [], next_questions: [] });
  assert.equal(requests.length, 1);
});

test('断られた理由の分類が null なら「理由不明」と出す', async () => {
  replies = [{ body: message({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: null }, content: [] }) }];
  await assert.rejects(runFarmArchive(paragraphs), /断りました（理由不明）/);
  assert.equal(requests.length, 1);
});

test('API キーがなければ通信しない', async () => {
  const key = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  await assert.rejects(runFarmArchive(paragraphs), NoApiKeyError);
  process.env.ANTHROPIC_API_KEY = key;
  assert.equal(requests.length, 0);
});
