// generate と verify を、一時フォルダのコピーで実際に走らせて確かめる（本体のデータは触らない）。
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('..', import.meta.url));
let copy;

before(() => {
  copy = mkdtempSync(join(tmpdir(), 'oyasai-copy-'));
  for (const name of ['data', 'lib', 'scripts', 'server', 'public', 'schemas', '.claude', '.gitignore']) {
    cpSync(join(project, name), join(copy, name), { recursive: true, filter: (from) => !from.includes('/data/runtime') });
  }
  symlinkSync(join(project, 'node_modules'), join(copy, 'node_modules'));
});

after(() => rmSync(copy, { recursive: true, force: true }));

const run = (script, ...args) => {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  return spawnSync(process.execPath, [join(copy, 'scripts', script), ...args], { cwd: copy, encoding: 'utf8', env });
};
const readCopy = (path) => readFileSync(join(copy, path), 'utf8');
const editJson = (path, change) => writeFileSync(join(copy, path), JSON.stringify(change(JSON.parse(readCopy(path))), null, 2));

test('generate は確認済みの英訳があれば、通信も書き換えもせずに止まる', () => {
  editJson('data/translations.en.json', (file) => ({
    ...file,
    translations: file.translations.map((t, i) => (i === 0 ? { ...t, reviewed_by: 'karen' } : t)),
  }));
  const before = readCopy('data/translations.en.json');
  const result = run('generate.mjs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /確認済みの英訳が 1 件/);
  assert.doesNotMatch(result.stderr, /API キー/);
  assert.equal(readCopy('data/translations.en.json'), before);
  editJson('data/translations.en.json', (file) => ({ ...file, translations: file.translations.map((t) => ({ ...t, reviewed_by: null })) }));
});

test('verify --final は【仮】と未確認の英訳で止まり、通常の verify はそのまま通る', () => {
  const plain = run('verify.mjs');
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /△ .*【仮】/);
  const final = run('verify.mjs', '--final');
  assert.equal(final.status, 1);
  assert.match(final.stderr, /まだ【仮】/);
  assert.match(final.stderr, /項目の英訳 \d+ 件が未確認/);
  assert.match(final.stderr, /画面の文言の英語 \d+ 件が未確認/);
});

test('verify --final は本番の文字起こしで全部確認済みなら通る', () => {
  const transcript = readCopy('data/transcript.md');
  const translations = readCopy('data/translations.en.json');
  const strings = readCopy('data/ui_strings.json');
  writeFileSync(join(copy, 'data/transcript.md'), transcript.replaceAll('【仮】', '【架空】'));
  editJson('data/translations.en.json', (file) => ({ ...file, translations: file.translations.map((t) => ({ ...t, reviewed_by: 'karen' })) }));
  editJson('data/ui_strings.json', (list) => list.map((s) => ({ ...s, en_reviewed_by: 'karen' })));
  const final = run('verify.mjs', '--final');
  assert.equal(final.status, 0, final.stderr);
  writeFileSync(join(copy, 'data/transcript.md'), transcript);
  writeFileSync(join(copy, 'data/translations.en.json'), translations);
  writeFileSync(join(copy, 'data/ui_strings.json'), strings);
});

test('verify は作り手の画面から Translated by Claude の部品が消えると止まる', () => {
  const source = readCopy('public/farmer.js');
  writeFileSync(join(copy, 'public/farmer.js'), source.replace('translationTag([translation]),', ''));
  const result = run('verify.mjs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /teaserView に「Translated by Claude」/);
  writeFileSync(join(copy, 'public/farmer.js'), source);
});

test('verify は訳が指す原文が項目とずれると止まる', () => {
  const saved = readCopy('data/translations.en.json');
  editJson('data/translations.en.json', (file) => ({ ...file, translations: file.translations.map((t, i) => (i === 0 ? { ...t, source_quote: 'ちがう文' } : t)) }));
  const result = run('verify.mjs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /原文（source_quote/);
  writeFileSync(join(copy, 'data/translations.en.json'), saved);
});

test('generate --keep-reviewed は原文が同じ確認済みの英訳を残し、残りだけ訳を頼む', async () => {
  const files = ['data/translations.en.json', 'data/replay/farm_archive.json', 'data/replay/letter_assignment.json'];
  const saved = files.map(readCopy);
  const archive = JSON.parse(saved[1]);
  const assigned = JSON.parse(saved[2]);
  const asked = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const { properties } = body.output_config.format.schema;
    let answer = properties.entries ? archive : assigned;
    if (properties.translations) {
      const list = JSON.parse(body.messages[0].content.slice(body.messages[0].content.indexOf('[')));
      asked.push(...list.map((x) => x.id));
      answer = { translations: list.map((x) => ({ ref_id: x.id, text: 'NEW', reason_text: null, title_text: 't', untranslated: [] })) };
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: JSON.stringify(answer) }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  editJson(files[0], (file) => ({ ...file, translations: file.translations.map((t) => (t.ref_id === 'e-02' ? { ...t, reviewed_by: 'karen' } : t)) }));
  const checkedText = JSON.parse(readCopy(files[0])).translations.find((t) => t.ref_id === 'e-02').text;
  await new Promise((resolve, reject) => {
    execFile(process.execPath, [join(copy, 'scripts/generate.mjs'), '--keep-reviewed'], {
      cwd: copy,
      env: { ...process.env, ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}` },
    }, (error) => (error ? reject(error) : resolve()));
  });
  server.close();
  const result = JSON.parse(readCopy(files[0])).translations;
  const kept = result.find((t) => t.ref_id === 'e-02');
  assert.equal(kept.text, checkedText);
  assert.equal(kept.reviewed_by, 'karen');
  assert.ok(!asked.includes('e-02'));
  assert.equal(result.find((t) => t.ref_id === 'e-03').text, 'NEW');
  assert.equal(result.find((t) => t.ref_id === 'e-03').source_quote, '葉の先が丸まってきたら、水やりを止めます');
  assert.equal(result.find((t) => t.ref_id === 'e-03').reviewed_by, null);
  files.forEach((file, i) => writeFileSync(join(copy, file), saved[i]));
});
