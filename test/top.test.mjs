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

// 390×844 の調整（T5）：詰めたのは余白と行の高さだけ。仕様で決まった値はそのまま。
test('390×844 の調整は仕様の値を変えず、流れの表示はラベルの途中で折らない', () => {
  const css = read('public/style.css');
  const rule = (selector) => {
    const at = css.indexOf(`\n${selector} {`);
    assert.ok(at >= 0, `${selector} の指定がありません`);
    return css.slice(at, css.indexOf('}', at));
  };
  const door = rule('.door');
  assert.match(door, /padding: 24px;/);
  assert.match(door, /margin-bottom: 16px;/);
  assert.match(door, /border-radius: 4px;/);
  assert.match(rule('.top__core'), /font-size: 28px;/);
  assert.match(rule('.lead-line'), /font-size: 20px;/);
  assert.match(rule('.door__title'), /font-size: 20px;/);
  assert.match(rule('.door__sub, .door__meta'), /font-size: 14px;/);
  assert.match(rule('.route__home, .route__who, .route__step'), /white-space: nowrap;/);
  // ③の副題（.lead-line）を変えないよう、トップの調整は .top の下だけに置く
  assert.match(css, /\n\.top \.lead-line \{ margin-bottom: 16px; \}/);
});

// 2026-11-07 Karen 承認の上書き：日本語のトップ見出しだけ 28px → 32〜36px（「日本のお野菜を／世界へ。」で改行）。
// パソコン（1024px 以上）は縦組みの大きな見出し。英語のスマホの大きさは変えない。
test('日本語の見出しだけ大きくし、文字は辞書の core のまま改行だけを入れる', () => {
  const css = read('public/style.css');
  assert.match(css, /html\[lang='ja'\] \.top__core \{ font-size: clamp\(32px, 8\.6vw, 36px\);/);
  assert.match(css, /html\[lang='en'\] \.top__core \{ font-size: 24px;/);
  assert.match(css, /html\[lang='ja'\] \.top__lid \{ writing-mode: vertical-rl;/);
  const source = read('public/index.js');
  assert.match(source, /const text = t\('core'\);/);
  assert.match(source, /text\.slice\(0, at \+ 1\), h\('br'\), text\.slice\(at \+ 1\)/);
});
