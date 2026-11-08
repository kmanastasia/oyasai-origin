import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseTranscript } from '../lib/ingest.mjs';
import { verifyArchive } from '../lib/verbatim.mjs';
import { assignByRule, buildPublicLetter, matchTranslations, sealArchive, withSource } from '../lib/letter.mjs';

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
  const tampered = { ...archive.entries[2], id: 'x', quote: '葉の先が丸まってきたら、水やりをとめます' };
  const result = verifyArchive({ entries: [tampered], next_questions: [] }, paragraphs);
  assert.equal(result.entries.length, 0);
  assert.equal(result.dropped.length, 1);
});

test('補われた理由は落とす', () => {
  const tampered = { ...archive.entries[2], id: 'x', reason_quote: '根が腐るから', reason_source_ref: 'p.03' };
  assert.equal(verifyArchive({ entries: [tampered], next_questions: [] }, paragraphs).entries.length, 0);
});

test('別の段落を指す引用は落とす', () => {
  const tampered = { ...archive.entries[0], id: 'x', source_ref: 'p.03' };
  assert.equal(verifyArchive({ entries: [tampered], next_questions: [] }, paragraphs).entries.length, 0);
});

test('残すだけの項目は受け取る側のデータに出ない', () => {
  const sealed = sealArchive(draft, allYes({ 'e-02': 'archive_only' }));
  const output = JSON.stringify(buildPublicLetter(sealed, assignment, translations, meta));
  assert.ok(!output.includes('親から引き継いで'));
  assert.ok(!output.includes('from my parents'));
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

test('「本人と一緒に見ている」は封の結果に残り、既定は「いいえ」。確認の仕方は変えない', () => {
  const plain = sealArchive(draft, allYes());
  assert.equal(plain.checked_with_farmer, false);
  assert.ok(plain.entries.every((e) => e.checked_with_farmer === false));
  const together = sealArchive(draft, allYes(), undefined, 1, [], true);
  assert.equal(together.checked_with_farmer, true);
  assert.ok(together.entries.every((e) => e.checked_with_farmer === true));
  assert.deepEqual(together.entries.map((e) => e.confirmed_by), plain.entries.map((e) => e.confirmed_by));
  // 真偽値の true だけを「はい」とみなす
  assert.equal(sealArchive(draft, allYes(), undefined, 1, [], 'yes').checked_with_farmer, false);
  // 受け取る側のデータは、③④の確認のタグを切り替える印のほかは、どちらでも同じ
  const at = '2000-01-01T00:00:00.000Z';
  const seen = buildPublicLetter(sealArchive(draft, allYes(), at, 1, [], true), assignment, translations, meta);
  const proxy = buildPublicLetter(sealArchive(draft, allYes(), at, 1, [], false), assignment, translations, meta);
  assert.equal(seen.checked_with_farmer, true);
  assert.equal(proxy.checked_with_farmer, false);
  assert.deepEqual({ ...seen, checked_with_farmer: null }, { ...proxy, checked_with_farmer: null });
  // 印のない古い封の結果は「運営者が代理」として扱う
  const { checked_with_farmer: _omit, ...older } = sealArchive(draft, allYes(), at, 1, [], true);
  assert.equal(buildPublicLetter(older, assignment, translations, meta).checked_with_farmer, false);
});

test('味ことばは読み上げない', () => {
  const sealed = sealArchive(draft, allYes());
  assert.ok(sealed.entries.filter((e) => e.tags.includes('味ことば')).every((e) => e.skip_speech));
});

test('読み上げから外す項目は id で指定でき、原文は変わらない', () => {
  const sealed = sealArchive(draft, allYes(), undefined, 1, ['e-03']);
  const entry = sealed.entries.find((e) => e.id === 'e-03');
  assert.equal(entry.skip_speech, true);
  assert.equal(entry.quote, archive.entries.find((e) => e.id === 'e-03').quote);
  assert.equal(sealed.entries.find((e) => e.id === 'e-04').skip_speech, false);
  const letter = buildPublicLetter(sealed, assignment, translations, meta);
  const shown = letter.chapters.flatMap((c) => c.items).find((i) => i.id === 'e-03');
  assert.equal(shown.skip_speech, true);
  assert.equal(shown.quote, '葉の先が丸まってきたら、水やりを止めます');
});

test('Claude が使えないときの割り当てでも全項目が便箋に載る', () => {
  const sealed = sealArchive(draft, allYes());
  const letter = buildPublicLetter(sealed, assignByRule(sealed.entries), translations, meta);
  const placed = letter.land.length + letter.chapters.reduce((n, c) => n + c.items.length, 0);
  assert.equal(placed, draft.entries.length);
});

test('訳は、id が変わっても原文が同じなら確認済みの印ごと再利用する', () => {
  const saved = [{ ref_id: 'e-05', source_quote: '霜が降りるまで抜かん', source_reason_quote: '霜に当てると、甘かなる', text: 'checked', reviewed_by: 'karen' }];
  const entry = { id: 'z-99', quote: '霜が降りるまで抜かん', reason_quote: '霜に当てると、甘かなる' };
  const { matched, missing } = matchTranslations([entry], saved);
  assert.equal(missing.length, 0);
  assert.equal(matched[0].ref_id, 'z-99');
  assert.equal(matched[0].text, 'checked');
  assert.equal(matched[0].reviewed_by, 'karen');
});

test('原文が違う訳は、id が同じでも一部が重なっていても流用しない', () => {
  const saved = [{ ref_id: 'e-09', source_quote: 'あまか', source_reason_quote: null, text: 'x', reviewed_by: 'karen' }];
  for (const entry of [
    { id: 'e-09', quote: 'あまかった', reason_quote: null },
    { id: 'e-09', quote: 'まか', reason_quote: null },
    { id: 'e-09', quote: 'あまか', reason_quote: '霜に当てると、甘かなる' },
  ]) {
    const { matched, missing } = matchTranslations([entry], saved);
    assert.equal(matched.length, 0, entry.quote);
    assert.equal(missing.length, 1);
  }
});

test('原文を持たない訳は、id が一致しても使わない', () => {
  const { matched } = matchTranslations([{ id: 'e-01', quote: 'あ', reason_quote: null }], [{ ref_id: 'e-01', text: 'x', reviewed_by: 'karen' }]);
  assert.equal(matched.length, 0);
});

test('確認済みの英訳は封をし直しても確認済みのまま', () => {
  const reviewed = translations.translations.map((t) => ({ ...t, reviewed_by: 'karen' }));
  const sealed = sealArchive(draft, allYes(), undefined, 2);
  const { matched } = matchTranslations(sealed.entries, reviewed);
  const letter = buildPublicLetter(sealed, assignment, { archive_version: 2, translations: matched }, meta);
  assert.ok(Object.values(letter.translations).every((x) => x.reviewed_by === 'karen'));
  assert.ok(!JSON.stringify(letter).includes('source_quote'));
});

test('Claude の訳に原文を持たせ、頼んでいない項目の訳と原文にない理由は捨てる', () => {
  const entries = [{ id: 'a', quote: 'あ', reason_quote: null }];
  const result = withSource(entries, [{ ref_id: 'a', text: 'A', reason_text: 'because', title_text: 't', untranslated: [] }, { ref_id: 'b', text: 'B', reason_text: null }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].source_quote, 'あ');
  assert.equal(result[0].reason_text, null);
  assert.equal(result[0].reviewed_by, null);
});
