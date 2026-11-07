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
};

test('確認のタグの文言は JP/EN の両方があり、英語は未確認のまま', () => {
  for (const [key, [ja, en]] of Object.entries(CHECK)) {
    const entry = strings.get(key);
    assert.equal(entry?.ja, ja, `${key} の日本語がちがいます`);
    assert.equal(entry.en, en, `${key} の英語がちがいます`);
    assert.equal(entry.en_reviewed_by, null);
  }
});

test('タグの文に「見本」が入っている', () => {
  assert.match(strings.get('check.done').ja, /見本/);
  assert.match(strings.get('check.done').en, /sample/);
});

test('デモでは②の答えにかかわらず、いつも今の文を点線の枠で出す（「一緒に確かめた」の文は本番だけ）', () => {
  const body = helper.slice(0, helper.indexOf('\n}') + 2);
  assert.match(body, /class: 'tag-line tag-line--proxy'/);
  assert.match(body, /t\('check\.done'\)/);
  assert.ok(!body.includes('checked_with_farmer'), '②の答えでタグを変えてはいけません');
  assert.ok(!strings.has('check.together'), 'デモでは「一緒に確かめた」の文を持たない');
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
