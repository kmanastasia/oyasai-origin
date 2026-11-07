// トップの扉「読む／書く」と流れの表示の言葉、足もとの SNS が押せないことを確かめる。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(`${project}${path}`, 'utf8');
const strings = new Map(JSON.parse(read('data/ui_strings.json')).map((s) => [s.key, s]));

test('トップの扉は 読む→③えらぶ、書く→①残す', () => {
  const source = read('public/index.js');
  assert.match(source, /key: 'read', href: '\/choose'/);
  assert.match(source, /key: 'write', href: '\/keep'/);
  for (const side of ['read', 'write']) {
    for (const part of ['for', 'title', 'sub', 'meta']) {
      const entry = strings.get(`top.${side}.${part}`);
      assert.ok(entry?.ja && entry?.en, `top.${side}.${part} の JP/EN がありません`);
      assert.equal(entry.en_reviewed_by, null);
    }
  }
  assert.equal(strings.get('top.read.for').ja, '手紙を読む方へ');
  assert.equal(strings.get('top.write.for').ja, '手紙を書く方へ');
  assert.equal(strings.get('top.ask').ja, 'どちらにしますか');
});

test('流れの表示は「読む」「書く」', () => {
  assert.equal(strings.get('route.read').ja, '読む');
  assert.equal(strings.get('route.read').en, 'Read');
  assert.equal(strings.get('route.write').ja, '書く');
  assert.equal(strings.get('route.write').en, 'Write');
  assert.ok(!strings.has('route.reader'));
  assert.match(read('public/reader.js'), /who: t\('route\.read'\)/);
  // ①②は日本語のみで、ui_strings の「書く」と同じ語を使う
  assert.match(read('public/common.js'), new RegExp(`who: '${strings.get('route.write').ja}'`));
});

test('QR の文は、その作り手の手紙の表紙（④）が直接開く（見本）', () => {
  const qr = strings.get('top.qr');
  assert.match(qr.ja, /表紙（④）が直接開きます（見本）/);
  assert.match(qr.en, /\(④\) directly \(sample\)/);
  assert.match(read('README.md'), /その作り手の手紙の表紙（④）が直接開く想定です（見本）/);
});

test('トップの足もとの SNS は押せない文字と「準備中」だけで、リンクも URL もない', () => {
  const source = read('public/index.js');
  const sns = source.slice(source.indexOf('function snsView('), source.indexOf('function render('));
  assert.match(sns, /t\('top\.sns'\)/);
  assert.match(sns, /t\('sns\.pending'\)/);
  assert.doesNotMatch(sns, /h\('a'|href/);
  assert.doesNotMatch(source, /https?:/);
  assert.equal(strings.get('sns.pending').ja, '準備中');
  assert.doesNotMatch(JSON.stringify([strings.get('top.sns'), strings.get('sns.pending')]), /https?:/);
});
