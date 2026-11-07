// 約束を仕組みで守るための照合。npm run verify で走り、1つでも落ちると終了コード 1 で止まる。
// npm run verify -- --final は、【仮】の文字起こしと未確認の英訳が残っていても止まる。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTranscript } from '../lib/ingest.mjs';
import { verifyArchive } from '../lib/verbatim.mjs';
import { buildPublicLetter, sealArchive } from '../lib/letter.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const readJson = (path) => JSON.parse(read(path));

const isFinal = process.argv.includes('--final');
const failures = [];
const warnings = [];
const report = (name, problems, detail) => {
  console.log(`${problems.length ? '✗' : '✓'} ${name}${detail ? `：${detail}` : ''}`);
  failures.push(...problems);
};

const transcript = read('data/transcript.md');
const paragraphs = parseTranscript(transcript);
const archive = readJson('data/replay/farm_archive.json');
const meta = readJson('data/letter_meta.json');
const translationFile = readJson('data/translations.en.json');
const assignment = readJson('data/replay/letter_assignment.json');

// 1. quote・reason_quote の一字一句一致
const checked = verifyArchive(archive, paragraphs);
report(
  '引用の照合',
  checked.dropped.map((d) => `${d.id}：${d.reason}。data/replay/farm_archive.json を原文に合わせるか、npm run generate で作り直してください。`),
  `${checked.entries.length}/${checked.total}`
);

// 実行中のデータがあれば、それも同じ物差しで確かめる
const RUNTIME_DIRS = [['data/runtime', '実行中'], ['data/runtime/demo', 'demo 実行中']];
for (const [dir, label] of RUNTIME_DIRS) {
  const draftPath = `${dir}/draft.json`;
  if (!existsSync(join(root, draftPath))) continue;
  const draft = readJson(draftPath);
  const recheck = verifyArchive({ entries: draft.entries, next_questions: draft.next_questions }, draft.paragraphs);
  report(`${label}の下書きの照合`, recheck.dropped.map((d) => `${d.id}：${d.reason}。/keep で下書きを作り直してください。`), `${recheck.entries.length}/${recheck.total}`);
}

// 2. 理由がない判断には質問がある。理由は補われていない
const missing = archive.entries.filter((e) => e.missing_reason);
const questionIds = new Set(archive.next_questions.map((q) => q.id));
report(
  '理由が語られていない判断と次の質問',
  [
    ...missing.filter((e) => e.reason_quote !== null || !questionIds.has(e.next_question_id)).map((e) => `${e.id}：理由が null で質問が結ばれている必要があります。`),
    ...translationFile.translations
      .filter((t) => archive.entries.find((e) => e.id === t.ref_id)?.reason_quote === null && t.reason_text !== null)
      .map((t) => `${t.ref_id}：原文に理由がないのに英語に理由があります。reason_text を null にしてください。`),
    ...(missing.length < 2 ? [`次に聞く質問が ${missing.length} 件です。2件以上が必要です。文字起こしか Skill を見直してください。`] : []),
  ],
  `${missing.length}件`
);

// 3. archive_only の流出0件：どの項目を「残すだけ」にしても、受け取る側のデータに出ない
const leakProblems = [];
const draftBase = { ...checked, paragraphs };
for (const target of checked.entries) {
  const decisions = checked.entries.map((e) => ({ id: e.id, reply: e.id === target.id ? 'archive_only' : 'yes' }));
  const published = sealArchive(draftBase, decisions, '2000-01-01T00:00:00.000Z');
  const output = JSON.stringify(buildPublicLetter(published, assignment, translationFile, meta));
  const english = translationFile.translations.find((t) => t.ref_id === target.id)?.text;
  if (output.includes(target.quote) || output.includes(`"${target.id}"`) || (english && output.includes(english))) {
    leakProblems.push(`${target.id} を残すだけにしても受け取る側に出ます。lib/letter.mjs の buildPublicLetter を確かめてください。`);
  }
}
for (const [dir] of RUNTIME_DIRS) {
  const letterPath = `${dir}/public_letter.json`;
  const publishedPath = `${dir}/published.json`;
  if (!existsSync(join(root, letterPath)) || !existsSync(join(root, publishedPath))) continue;
  const live = read(letterPath);
  for (const entry of readJson(publishedPath).entries.filter((e) => e.disclosure === 'archive_only')) {
    if (live.includes(entry.quote) || live.includes(`"${entry.id}"`)) {
      leakProblems.push(`${entry.id} が実行中の手紙に出ています。/keep からやり直してください。`);
    }
  }
}
report('archive_only の流出', leakProblems, `${leakProblems.length}件`);

// 4. 英語訳の漏れ0件
const translated = new Map(translationFile.translations.map((t) => [t.ref_id, t]));
const enProblems = [];
for (const entry of checked.entries) {
  const t = translated.get(entry.id);
  if (!t) {
    enProblems.push(`${entry.id} の英語訳がありません。npm run generate で作るか、data/translations.en.json に足してください。`);
    continue;
  }
  // 訳が指す原文が今の項目と同じでなければ、再利用されず画面に出ない
  if (t.source_quote !== entry.quote || (t.source_reason_quote ?? null) !== entry.reason_quote) {
    enProblems.push(`${entry.id} の英語訳が指す原文（source_quote・source_reason_quote）が項目の原文と一致しません。訳を確かめて、原文を合わせてください。`);
  }
  if (!t.title_text) enProblems.push(`${entry.id} の title_text がありません。`);
  if (entry.tags.includes('味ことば')) {
    if (t.text !== '' || t.untranslated.length === 0) enProblems.push(`${entry.id} は方言の味ことばです。訳さず untranslated に入れてください。`);
    for (const word of t.untranslated) {
      if (!word.gloss_ja?.startsWith('≈') || !word.gloss_en?.startsWith('≈')) enProblems.push(`${entry.id} の添え書きは ≈ で始めてください（正解の訳として書かないため）。`);
    }
  } else if (!t.text) {
    enProblems.push(`${entry.id} の英語訳が空です。`);
  }
  if (entry.reason_quote && !t.reason_text) enProblems.push(`${entry.id} の理由の英語訳がありません。`);
}
for (const s of readJson('data/ui_strings.json')) {
  if (!s.ja && !s.en) enProblems.push(`ui_strings の ${s.key} が空です。`);
  // ②封をする（seal.）と JP の結び（close.jp）は日本語のみ
  if (!s.key.startsWith('close.jp') && !s.key.startsWith('seal.') && !s.en && s.key !== 'voice.enNote') enProblems.push(`ui_strings の ${s.key} に英語がありません。`);
}
report('英語訳の漏れ', enProblems, `${enProblems.length}件`);

// 読み上げから外す項目の id は、実在するものだけ
const skipIds = readJson('data/speech.json').skip_speech_ids;
const unknownSkips = skipIds.filter((id) => !archive.entries.some((e) => e.id === id));
report('読み上げから外す項目', unknownSkips.map((id) => `data/speech.json の ${id} は項目にありません。data/replay/farm_archive.json の id に合わせてください。`), `${skipIds.length}件`);

// 5. 表示の約束：外せない文言が受け取る側のデータに残っている
// （2026-11-08 Karen 決定：「架空」「見本」の帯と写真の注記は出さない。残すのは 合成音声・Translated by Claude・お金の「仮」）
const strings = read('data/ui_strings.json');
const labelProblems = ['合成音声', 'Synthetic voice', 'Translated by Claude', '仮', 'Provisional']
  .filter((label) => !strings.includes(label))
  .map((label) => `「${label}」の表示が data/ui_strings.json から消えています。元に戻してください。`);
if (!read('data/offer.json').includes('（仮）')) labelProblems.push('価格の「（仮）」が data/offer.json から消えています。');
if (!read('public/letter.js').includes("'voice.label'")) labelProblems.push('「合成音声」の表示が public/letter.js から消えています。');
const reader = read('public/reader.js');
for (const key of ['letter.translatedBy', 'letter.checked', 'letter.notChecked']) {
  if (!reader.includes(`'${key}'`)) labelProblems.push(`翻訳の表示 ${key} が public/reader.js から消えています。`);
}
// 訳文を出す部品ごとに、タグと確認状態の部品を呼んでいることを確かめる
const functionBody = (source, name) => {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return '';
  const rest = source.slice(start + 1);
  const end = rest.search(/\n(function |const |async function |\/\* )/);
  return end < 0 ? rest : rest.slice(0, end);
};
for (const [file, name] of [['public/farmer.js', 'teaserView'], ['public/letter.js', 'coverView']]) {
  if (!functionBody(read(file), name).includes('translationTag(')) labelProblems.push(`${file} の ${name} に「Translated by Claude」と確認状態がありません。translationTag を呼んでください。`);
}
for (const name of ['landView', 'chapterView']) {
  if (!functionBody(read('public/letter.js'), name).includes('itemsTag(')) labelProblems.push(`public/letter.js の ${name} に「Translated by Claude」と確認状態がありません。itemsTag を呼んでください。`);
}
// ≈ の添え書きは Claude が書いたものと、JP でも EN でも分かる
for (const label of ['≈ は Claude による添え書き', '≈ notes by Claude']) {
  if (!strings.includes(label)) labelProblems.push(`「${label}」の表示が data/ui_strings.json から消えています。元に戻してください。`);
}
if (!functionBody(read('public/letter.js'), 'flavorItem').includes("'letter.glossBy'")) labelProblems.push('public/letter.js の flavorItem に添え書きの出どころの表示がありません。');
// 結びの「仮」の帯（お金は仮の数字・購入はできない）は、カードを開かなくても最初から出る
for (const [name, key] of [['closingJp', 'close.jp.band'], ['closingEn', 'close.en.band']]) {
  if (!functionBody(read('public/letter.js'), name).includes(`'${key}'`)) labelProblems.push(`public/letter.js の ${name} に結びの帯 ${key} がありません。先頭に条件なしで出してください。`);
}
report('合成音声・翻訳・仮の表示', labelProblems);

// 6. 送信・決済・録音・外部音声のコードがない
function walk(dir) {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(root, path)).isDirectory() ? walk(path) : [path];
  });
}
const FORBIDDEN = [
  [/stripe|paypal|payjp|checkout\.|paymentintent/i, '決済'],
  [/<form[\s>]|type=["'](email|tel|password)["']/i, '入力フォーム'],
  [/sendBeacon|XMLHttpRequest|WebSocket|EventSource/, '外部への送信'],
  [/getUserMedia|MediaRecorder/, '録音'],
  [/new Audio\(|\.mp3|\.wav|elevenlabs|cartesia/i, '音声ファイル・外部の音声サービス'],
  [/<a [^>]*href=["']https?:/i, '外部リンク'],
];
const codeProblems = [];
for (const file of [...walk('public'), ...walk('server'), ...walk('lib')]) {
  const source = read(file);
  for (const [pattern, label] of FORBIDDEN) {
    if (pattern.test(source)) codeProblems.push(`${file} に${label}のコードがあります（${pattern}）。作らない約束なので消してください。`);
  }
  for (const match of source.matchAll(/fetch\(\s*(['"`])([^'"`]*)/g)) {
    if (!match[2].startsWith('/api/')) codeProblems.push(`${file} の fetch の宛先が同じサーバーの /api/ ではありません：${match[2]}`);
  }
  for (const match of source.matchAll(/https?:\/\/[^\s'"`)<>]+/g)) {
    const url = match[0];
    if (!/^https?:\/\/(localhost|fonts\.googleapis\.com|fonts\.gstatic\.com)/.test(url)) {
      codeProblems.push(`${file} に許可していない外部の宛先があります：${url}`);
    }
  }
}
report('送信・決済のコード', codeProblems, `${codeProblems.length}件`);

// 7. モデルの約束
const claudeSource = read('server/claude.mjs');
const modelProblems = [];
if (!claudeSource.includes("'claude-opus-5-5'")) modelProblems.push('server/claude.mjs のモデルは claude-opus-5-5 にしてください。');
if (!claudeSource.includes('stop_reason')) modelProblems.push('server/claude.mjs で stop_reason を確かめてください。');
if (!claudeSource.includes("fallbacks: 'default'")) modelProblems.push('server/claude.mjs に fallbacks を入れてください。');
report('モデルと断られたときの備え', modelProblems);

// 8. private/・.env が git に追跡されていない
const gitProblems = [];
const ignore = read('.gitignore');
for (const entry of ['.env', 'private/', '*.mp4', '*.mov']) {
  if (!ignore.split('\n').includes(entry)) gitProblems.push(`.gitignore に ${entry} を足してください。`);
}
let gitDetail;
try {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n');
  const bad = tracked.filter((f) => /^private\//.test(f) || /(^|\/)\.env(\.|$)/.test(f) || /\.(mp4|mov)$/i.test(f) || /^data\/runtime\//.test(f));
  gitProblems.push(...bad.map((f) => `${f} が git に入っています。git rm --cached で外してください。一度 push したものは履歴に残るので、その場合は相談してください。`));
} catch {
  gitDetail = 'git リポジトリではないので追跡の確認は省略';
}
report('private/・.env の追跡', gitProblems, gitDetail);

const speakers = [...new Set(paragraphs.map((p) => p.speaker))];
if (speakers.length > 1) warnings.push(`作り手として ${speakers.join('・')} の ${speakers.length} 人を読みました。聞き手の名前が混ざっていないか確かめてください（聞き手は「聞き手：」と書きます）。`);
if (transcript.includes('【仮】')) warnings.push('data/transcript.md はまだ【仮】です。本番の文字起こしに差し替えて npm run generate を実行してください。');
const unreviewed = translationFile.translations.filter((t) => !t.reviewed_by).length;
if (unreviewed) warnings.push(`英語訳 ${unreviewed} 件は未確認です（画面には Not yet checked と出ます）。`);

if (isFinal) {
  const finalProblems = [];
  if (transcript.includes('【仮】')) finalProblems.push('data/transcript.md がまだ【仮】です。本番の文字起こしに差し替えて npm run generate を実行してください。');
  const notChecked = translationFile.translations.filter((t) => !t.reviewed_by).map((t) => t.ref_id);
  if (notChecked.length) finalProblems.push(`項目の英訳 ${notChecked.length} 件が未確認です（${notChecked.join('、')}）。確認して data/translations.en.json の reviewed_by を入れてください。`);
  const uiNotChecked = readJson('data/ui_strings.json').filter((s) => s.en && s.en !== s.ja && !s.en_reviewed_by).map((s) => s.key);
  if (uiNotChecked.length) finalProblems.push(`画面の文言の英語 ${uiNotChecked.length} 件が未確認です（${uiNotChecked.join('、')}）。確認して data/ui_strings.json の en_reviewed_by を入れてください。`);
  report('最終確認（【仮】・未確認の英訳）', finalProblems);
}

for (const warning of warnings) console.log(`△ ${warning}`);
if (failures.length) {
  console.error(`\n${failures.length} 件の問題があります：`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`\nverify${isFinal ? ' --final' : ''}：すべて通りました。`);
