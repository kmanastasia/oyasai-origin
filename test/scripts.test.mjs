// generate と verify を、一時フォルダのコピーで実際に走らせて確かめる（本体のデータは触らない）。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

test('verify は③カードから Translated by Claude の部品が消えると止まる', () => {
  const source = readCopy('public/choose.js');
  writeFileSync(join(copy, 'public/choose.js'), source.replace('translationTag([translation]),', ''));
  const result = run('verify.mjs');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /teaserView に「Translated by Claude」/);
  writeFileSync(join(copy, 'public/choose.js'), source);
});
