import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseTranscript } from '../lib/ingest.mjs';
import { verifyArchive } from '../lib/verbatim.mjs';
import { assignByRule, buildPublicLetter, sealArchive } from '../lib/letter.mjs';

const json = (path) => JSON.parse(readFileSync(new URL(`../data/${path}`, import.meta.url), 'utf8'));
const paragraphs = parseTranscript(readFileSync(new URL('../data/transcript.md', import.meta.url), 'utf8'));
const archive = json('replay/farm_archive.json');
const assignment = json('replay/letter_assignment.json');
const translations = json('translations.en.json');
const meta = json('letter_meta.json');
const draft = verifyArchive(archive, paragraphs);
const allYes = (overrides = {}) => draft.entries.map((e) => ({ id: e.id, reply: overrides[e.id] ?? 'yes' }));

test('聞き手の発言には番号を振らない', () => {
  const parsed = parseTranscript('聞き手：こんにちは。\nみなみ：霜が降りる。\n\n聞き手：なぜ？\nみなみ：甘かなる。');
  assert.deepEqual(parsed.map((p) => [p.id, p.text]), [['p.01', '霜が降りる。'], ['p.02', '甘かなる。']]);
});

test('Karen などの聞き手の名前は、書き方が違っても引用の対象にしない', () => {
  for (const name of ['Karen', 'karen', 'KAREN', 'Ｋａｒｅｎ', 'カレン', 'Karen（聞き手）', '聞き手（Karen）', 'Q']) {
    for (const colon of ['：', ':']) {
      const parsed = parseTranscript(`${name}${colon}どうして水を止めるんですか。\nみなみ${colon}葉の先が丸まったら、水を止める。`);
      assert.deepEqual(parsed.map((p) => [p.id, p.speaker, p.text]), [['p.01', 'みなみ', '葉の先が丸まったら、水を止める。']], name);
    }
  }
});

test('聞き手の続きの行も引用の対象にせず、聞き手の言葉の引用は照合で落ちる', () => {
  const parsed = parseTranscript('Karen：どうして\n水を止めるんですか。\n\nみなみ：霜が降りる。');
  assert.deepEqual(parsed.map((p) => p.text), ['霜が降りる。']);
  const stolen = { ...archive.entries[0], id: 'x', quote: 'どうして', source_ref: 'p.01' };
  assert.equal(verifyArchive({ entries: [stolen], next_questions: [] }, parsed).entries.length, 0);
});

test('名前の行のあとで改行した作り手の発言も、一字も変えずに読む', () => {
  const parsed = parseTranscript('みなみ：\n霜が降りる。\n甘かなる。');
  assert.deepEqual(parsed.map((p) => [p.id, p.text]), [['p.01', '霜が降りる。甘かなる。']]);
});

test('話し手の名前がなければ、次にすることを添えて止める', () => {
  assert.throws(() => parseTranscript('ただの文章です。'), (error) => error.next.includes('話し手の名前'));
});

test('一字でも違う引用は落とす', () => {
  const tampered = { ...archive.entries[2], id: 'x', quote: '葉の先が丸まったら、水をとめる' };
  const result = verifyArchive({ entries: [tampered], next_questions: [] }, paragraphs);
  assert.equal(result.entries.length, 0);
  assert.equal(result.dropped.length, 1);
});

test('補われた理由は落とす', () => {
  const tampered = { ...archive.entries[2], id: 'x', reason_quote: '根が腐るから', reason_source_ref: 'p.02' };
  assert.equal(verifyArchive({ entries: [tampered], next_questions: [] }, paragraphs).entries.length, 0);
});

test('別の段落を指す引用は落とす', () => {
  const tampered = { ...archive.entries[0], id: 'x', source_ref: 'p.03' };
  assert.equal(verifyArchive({ entries: [tampered], next_questions: [] }, paragraphs).entries.length, 0);
});

test('残すだけの項目は受け取る側のデータに出ない', () => {
  const sealed = sealArchive(draft, allYes({ 'e-02': 'archive_only' }));
  const output = JSON.stringify(buildPublicLetter(sealed, assignment, translations, meta));
  assert.ok(!output.includes('ばあちゃん'));
  assert.ok(!output.includes('old woman'));
  assert.ok(!output.includes('"e-02"'));
});

test('「ちがう」と未回答は外に出さない', () => {
  const decisions = allYes({ 'e-03': 'wrong' }).filter((d) => d.id !== 'e-04');
  const output = JSON.stringify(buildPublicLetter(sealArchive(draft, decisions), assignment, translations, meta));
  assert.ok(!output.includes('丸まったら'));
  assert.ok(!output.includes('指二本'));
});

test('一覧の一言が残すだけになったら、別の public の項目に替える', () => {
  const letter = buildPublicLetter(sealArchive(draft, allYes({ 'e-01': 'archive_only' })), assignment, translations, meta);
  assert.equal(letter.teaser.id, 'e-02');
  assert.equal(letter.land.length, 0);
});

test('手紙の本文は原文のまま', () => {
  const letter = buildPublicLetter(sealArchive(draft, allYes()), assignment, translations, meta);
  const text = paragraphs.map((p) => p.text).join('');
  for (const item of letter.chapters.flatMap((c) => c.items)) assert.ok(text.includes(item.quote));
});

test('味ことばは読み上げない', () => {
  const sealed = sealArchive(draft, allYes());
  assert.ok(sealed.entries.filter((e) => e.tags.includes('味ことば')).every((e) => e.skip_speech));
});

test('Claude が使えないときの割り当てでも全項目が便箋に載る', () => {
  const sealed = sealArchive(draft, allYes());
  const letter = buildPublicLetter(sealed, assignByRule(sealed.entries), translations, meta);
  const placed = letter.land.length + letter.chapters.reduce((n, c) => n + c.items.length, 0);
  assert.equal(placed, draft.entries.length);
});
