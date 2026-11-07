// ②封をする：先頭の固定タグ、「本人と一緒に見ている」の2択、完了の文と橋の言葉を確かめる。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(`${project}${path}`, 'utf8');
const strings = new Map(JSON.parse(read('data/ui_strings.json')).map((s) => [s.key, s]));
const source = read('public/seal.js');
const body = (name) => source.slice(source.indexOf(`function ${name}(`), source.indexOf('\nfunction ', source.indexOf(`function ${name}(`) + 1));

const SEAL = {
  'seal.operator': '運営者が封をします（登録のとき、本人から任されています）',
  'seal.together': '本人と一緒に見ている',
  'seal.together.no': 'いいえ',
  'seal.together.yes': 'はい',
  'seal.done.sent': '届いた形は、あとで本人にお送りします',
  'seal.done.demo': '（見本・まだ送りません）',
  'seal.bridge': 'ここから先は、読む方の画面です',
  'seal.done.view': 'できあがりを見る',
};

test('②の文言は日本語のみで ui_strings にあり、seal.js と同じ語を使う', () => {
  for (const [key, ja] of Object.entries(SEAL)) {
    const entry = strings.get(key);
    assert.equal(entry?.ja, ja, `${key} の文言がちがいます`);
    assert.equal(entry.en, '');
    assert.equal(entry.en_reviewed_by, null);
  }
  for (const key of ['seal.operator', 'seal.together', 'seal.bridge', 'seal.done.view']) assert.ok(source.includes(`'${SEAL[key]}'`), `${key} が seal.js にありません`);
  assert.ok(source.includes(`'${SEAL['seal.done.sent']}${SEAL['seal.done.demo']}'`));
});

test('先頭の固定タグと2択は、項目の画面と封をする前の画面の両方に出る', () => {
  const head = body('headView');
  assert.match(head, /'seal-fixed'/);
  assert.doesNotMatch(head.slice(0, head.indexOf("'fieldset'")), /onclick/, '固定タグは押せない');
  assert.match(head, /\[\[false, 'いいえ'\], \[true, 'はい'\]\]/);
  assert.match(head, /h\('button'/);
  assert.doesNotMatch(source, /h\('(input|textarea|select|form)'/, '入力欄は作らない');
  assert.match(body('cardView'), /headView\(\)/);
  assert.match(body('reviewView'), /headView\(\)/);
  assert.match(source, /let checkedWithFarmer = false;/);
  assert.match(body('reviewView'), /api\('seal', \{ decisions: replies, checked_with_farmer: checkedWithFarmer \}\)/);
});

test('完了の画面は送らずに見本と書き、橋から③へ進む。項目の3つの答えはそのまま', () => {
  const done = body('sealedView');
  assert.ok(done.includes(SEAL['seal.done.demo']));
  assert.ok(done.includes(`'${SEAL['seal.bridge']}'`));
  assert.match(done, /href: '\/choose' \},\s*h\('span', \{ text: 'できあがりを見る' \}\),\s*h\('span', \{ class: 'btn__to', text: '→ ③' \}\)/);
  // 送るのは自分のサーバーの api だけ
  assert.doesNotMatch(source, /fetch\(|mailto:|sms:|https?:/);
  for (const label of ['はい、これで合っています', 'ちがう', '残すだけ（外に出さない）']) assert.ok(body('cardView').includes(`'${label}'`));
});
