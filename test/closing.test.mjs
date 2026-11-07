// ④の結び（EN）の「運営者が間に入る」1行と、おやさい旅の SNS が押せない文字＋「準備中」であることを確かめる。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(`${project}${path}`, 'utf8');
const strings = new Map(JSON.parse(read('data/ui_strings.json')).map((s) => [s.key, s]));
const source = read('public/letter.js');
const slice = (from, to) => source.slice(source.indexOf(`function ${from}(`), source.indexOf(`function ${to}(`));

test('EN の結びに「運営者が間に入る」の1行がある（EN のみ・未確認）', () => {
  const entry = strings.get('visit.operator');
  assert.equal(entry.en, 'The operator arranges the visit with the maker.');
  assert.equal(entry.ja, '');
  assert.equal(entry.en_reviewed_by, null);
  assert.match(slice('closingEn', 'closingView'), /t\('visit\.operator'\)/);
});

test('EN の結びの SNS は押せない文字と「準備中」だけで、リンクも URL もない', () => {
  const sns = slice('visitSnsView', 'closingEn');
  assert.match(sns, /t\('visit\.sns'\)/);
  assert.match(sns, /t\('sns\.pending'\)/);
  assert.doesNotMatch(sns, /h\('a'|href/);
  assert.match(slice('closingEn', 'closingView'), /visitSnsView\(\)/);
  assert.doesNotMatch(slice('closingEn', 'closingView'), /h\('a'|href/);
  assert.doesNotMatch(source, /https?:/);
  const entry = strings.get('visit.sns');
  // URL が決まるまでは押せないので、「↗」や「外のサイトに移ります」は書かない
  assert.equal(entry.en, 'OYASAI TRIP (social)');
  assert.equal(entry.en_reviewed_by, null);
  assert.doesNotMatch(JSON.stringify(entry), /https?:/);
});

test('「Visit this land」は今までどおり見本で止まり、JP の結びは変えない', () => {
  const visit = slice('visitCard', 'visitSnsView');
  assert.match(visit, /actionDone = true/);
  assert.match(visit, /t\('close\.en\.done'\)/);
  assert.match(strings.get('close.en.done').en, /Sample only\. Nothing was sent\./);
  const jp = slice('closingJp', 'visitCard');
  assert.doesNotMatch(jp, /visit\.|sns/);
});
