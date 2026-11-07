// ③のカードと④の表紙の確認のタグ：文言・枠の種類・「見本」の表示を確かめる。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(`${project}${path}`, 'utf8');
const strings = new Map(JSON.parse(read('data/ui_strings.json')).map((s) => [s.key, s]));
const reader = read('public/reader.js');
const helper = reader.slice(reader.indexOf('export function checkTag('));

const CHECK = {
  'check.done': ['作り手の確認：済（運営者が代理・口頭／見本）', "Maker's check: done (by the operator, verbally / sample)"],
  'check.together': ['作り手と一緒に確かめた手紙', 'Checked together with the maker'],
  'check.sample': ['見本', 'Sample'],
};

test('確認のタグの文言は JP/EN の両方があり、英語は未確認のまま', () => {
  for (const [key, [ja, en]] of Object.entries(CHECK)) {
    const entry = strings.get(key);
    assert.equal(entry?.ja, ja, `${key} の日本語がちがいます`);
    assert.equal(entry.en, en, `${key} の英語がちがいます`);
    assert.equal(entry.en_reviewed_by, null);
  }
});

test('どちらの状態でも「見本」が出る', () => {
  assert.match(strings.get('check.done').ja, /見本/);
  assert.match(strings.get('check.done').en, /sample/);
  assert.match(helper, /together \? h\('span', \{ class: 'tag-note', text: t\('check\.sample'\) \}\)/);
});

test('印が true のときだけ「一緒に確かめた」（実線）、ほかは運営者の代理（点線）', () => {
  assert.match(helper, /const together = letter\.checked_with_farmer === true;/);
  assert.match(helper, /together \? 'tag-line--together' : 'tag-line--proxy'/);
  assert.match(helper, /together \? t\('check\.together'\) : t\('check\.done'\)/);
  const css = read('public/style.css');
  assert.match(css, /\.tag-line \{[^}]*border: 1px solid var\(--ink\);/);
  assert.match(css, /\.tag-line--proxy \{ border-style: dashed; \}/);
});

test('③のカードと④の表紙は同じ確認のタグを使い、古い文の出し方は残っていない', () => {
  for (const file of ['public/choose.js', 'public/letter.js']) {
    const source = read(file);
    assert.match(source, /import \{ checkTag,/, `${file} が checkTag を読み込んでいません`);
    assert.equal(source.split('checkTag(letter)').length - 1, 1, `${file} の確認のタグは1か所だけ`);
    assert.ok(!source.includes("t('check.done')"), `${file} に古い出し方が残っています`);
  }
});
