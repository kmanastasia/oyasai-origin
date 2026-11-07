// 動きの確かめ（motionProbe）を待ってから最初の描画をすると、ラベルが帯より遅れて出る。
// トップ・③・④は、確かめの答えが返らなくても最初の描画が先に来ることを、コードの並びで確かめる。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(`${project}${path}`, 'utf8');

// 一番外側（字下げなし）の行だけを見る。関数の中の await は数えない。
const topLevel = (source) => source.split('\n').filter((line) => /^\S/.test(line));

for (const [file, first] of [['public/index.js', /^render\(\);/], ['public/choose.js', /^render\(\);/], ['public/letter.js', /^\s*renderBody\(\);/]]) {
  test(`${file} は動きの確かめを待たずに最初の描画をする`, () => {
    const source = read(file);
    const lines = file === 'public/letter.js' ? source.slice(source.lastIndexOf('motionProbe()')).split('\n') : topLevel(source);
    const at = lines.findIndex((line) => first.test(line));
    assert.ok(at >= 0, '最初の描画が見つかりません');
    const before = lines.slice(0, at).join('\n');
    assert.doesNotMatch(before, /await (live|probing|motionProbe)/, '描画の前に motionProbe を待っています');
    assert.doesNotMatch(before, /motion(Ok)? = await/, '描画の前に motionProbe を待っています');
  });
}

test('現れる動きは透明から始めない（止められていても最初の1枚で読める）', () => {
  const css = read('public/style.css');
  const frame = css.match(/@keyframes appear \{ from \{([^}]*)\} \}/);
  assert.ok(frame, '@keyframes appear がありません');
  const opacity = frame[1].match(/opacity:\s*([\d.]+)/);
  assert.ok(!opacity || Number(opacity[1]) >= 0.4, `現れる動きが opacity ${opacity?.[1]} から始まります`);
});
