// 番号ごとの手紙（data/letters/<番号>/）：番号で読め、本文は原文のまま、無い番号は null。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseTranscript } from '../lib/ingest.mjs';
import { configure, getLetter } from '../server/pipeline.mjs';

test('No.010 は同梱の手紙から組み立てられ、本文は文字起こしの原文のまま', async () => {
  configure({ runtimeDir: '/nonexistent/oyasai-test-runtime/' });
  const letter = await getLetter('No.010');
  assert.equal(letter.meta.no, 'No.010');
  assert.equal(letter.meta.vegetable.ja, 'きゅうり');
  const text = parseTranscript(readFileSync(new URL('../data/letters/No.010/transcript.md', import.meta.url), 'utf8')).map((p) => p.text).join('');
  const items = letter.chapters.flatMap((c) => c.items);
  assert.ok(items.length >= 10);
  for (const item of [...letter.land, ...items]) assert.ok(text.includes(item.quote), item.quote);
  assert.ok(letter.translations['e-01'].text.length > 0);
  assert.equal(letter.verified.dropped, 0);
});

test('無い番号は null。番号の形でないものも null', async () => {
  configure({ runtimeDir: '/nonexistent/oyasai-test-runtime/' });
  assert.equal(await getLetter('No.999'), null);
  assert.equal(await getLetter('../etc'), null);
});
