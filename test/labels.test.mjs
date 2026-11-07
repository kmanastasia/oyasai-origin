// 表示ラベルの守り：架空・見本・合成音声・Translated by Claude・仮 の帯やタグを、見た目を磨くうちに薄く・小さく・遅くしない。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(`${project}${path}`, 'utf8');
const LABELS = ['.band', '.tag-note', '.tag-line', '.tr-tag', '.voice-bar', '.offer__done', '.photo__cap'];

// @keyframes と @media の外側の規則だけを、[選択子, 中身] の組にする（入れ子の @media の中も平たく読む）
function rules(css) {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
  return [...flat.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
}

const labelRules = () => rules(read('public/style.css')).filter(([selector]) =>
  selector.split(',').some((part) => LABELS.some((label) => new RegExp(`\\${label}(?![\\w-])[^ >+~]*$`).test(part.trim()))));

test('ラベルの規則に、薄くする・動かす・隠す指定がない', () => {
  for (const [selector, body] of labelRules()) {
    for (const m of body.matchAll(/opacity:\s*([\d.]+)/g)) assert.equal(Number(m[1]), 1, `${selector} の opacity が 1 未満です`);
    for (const m of body.matchAll(/animation:\s*([^;!]+)/g)) assert.equal(m[1].trim(), 'none', `${selector} に動きがあります`);
    for (const m of body.matchAll(/transition:\s*([^;!]+)/g)) assert.equal(m[1].trim(), 'none', `${selector} に移り変わりがあります`);
    assert.doesNotMatch(body, /visibility:\s*hidden|display:\s*none/, `${selector} が隠れます`);
  }
});

test('ラベルの字は 13px 以上', () => {
  for (const [selector, body] of labelRules()) {
    for (const m of body.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) assert.ok(Number(m[1]) >= 13, `${selector} の字が ${m[1]}px です`);
  }
});

test('ラベルを守る規則が style.css の最後のほうにまとめてある', () => {
  const css = read('public/style.css');
  const at = css.lastIndexOf('.band, .tag-note, .tag-line, .tr-tag, .voice-bar, .offer__done, .photo__cap {');
  assert.ok(at > 0, 'ラベルを守る規則がありません');
  const body = css.slice(at, css.indexOf('}', at));
  for (const decl of ['opacity: 1 !important', 'animation: none !important', 'transition: none !important', 'transform: none !important']) assert.ok(body.includes(decl), decl);
});

test('ラベルの要素には、現れる動き（appear）を付けない', () => {
  for (const file of ['public/index.js', 'public/choose.js', 'public/letter.js', 'public/reader.js']) {
    for (const line of read(file).split('\n')) {
      if (/class: [`'](band|tag-note|tag-line|tr-tag|voice-bar|offer__done|photo__cap)/.test(line)) {
        assert.doesNotMatch(line, /appear/, `${file}：${line.trim()}`);
      }
    }
  }
});
