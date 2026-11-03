// 約束を仕組みで守るための照合。npm run verify で走り、1つでも落ちると終了コード 1 で止まる。
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
const draftPath = 'data/runtime/draft.json';
if (existsSync(join(root, draftPath))) {
  const draft = readJson(draftPath);
  const recheck = verifyArchive({ entries: draft.entries, next_questions: draft.next_questions }, draft.paragraphs);
  report('実行中の下書きの照合', recheck.dropped.map((d) => `${d.id}：${d.reason}。/keep で下書きを作り直してください。`), `${recheck.entries.length}/${recheck.total}`);
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
const letterPath = 'data/runtime/public_letter.json';
const publishedPath = 'data/runtime/published.json';
if (existsSync(join(root, letterPath)) && existsSync(join(root, publishedPath))) {
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
  if (!t.title_text) enProblems.push(`${entry.id} の title_text がありません。`);
  if (entry.tags.includes('味ことば')) {
    if (t.text !== '' || t.untranslated.length === 0) enProblems.push(`${entry.id} は方言の味ことばです。訳さず untranslated に入れてください。`);
  } else if (!t.text) {
    enProblems.push(`${entry.id} の英語訳が空です。`);
  }
  if (entry.reason_quote && !t.reason_text) enProblems.push(`${entry.id} の理由の英語訳がありません。`);
}
for (const s of readJson('data/ui_strings.json')) {
  if (!s.ja && !s.en) enProblems.push(`ui_strings の ${s.key} が空です。`);
  if (!s.key.startsWith('close.jp') && !s.en && s.key !== 'voice.enNote') enProblems.push(`ui_strings の ${s.key} に英語がありません。`);
}
report('英語訳の漏れ', enProblems, `${enProblems.length}件`);

// 5. 表示の約束：外せない文言が受け取る側のデータに残っている
const strings = read('data/ui_strings.json');
const labelProblems = ['架空', 'Fictional', '見本', 'Sample', '合成音声', 'Synthetic voice', 'Translated by Claude', '仮：', '架空の町', 'fictional narrator']
  .filter((label) => !strings.includes(label))
  .map((label) => `「${label}」の表示が data/ui_strings.json から消えています。元に戻してください。`);
if (!read('data/offer.json').includes('（仮）')) labelProblems.push('価格の「（仮）」が data/offer.json から消えています。');
if (!read('public/reader.js').includes("'band.fiction'")) labelProblems.push('注意帯が public/reader.js から消えています。');
if (!read('public/letter.js').includes("'voice.label'")) labelProblems.push('「合成音声・架空の語り手」が public/letter.js から消えています。');
if (!read('public/letter.js').includes("'letter.translatedBy'")) labelProblems.push('「Translated by Claude」が public/letter.js から消えています。');
report('架空・見本・合成音声・翻訳・仮の表示', labelProblems);

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

if (transcript.includes('【仮】')) warnings.push('data/transcript.md はまだ【仮】です。本番の文字起こしに差し替えて npm run generate を実行してください。');
const unreviewed = translationFile.translations.filter((t) => !t.reviewed_by).length;
if (unreviewed) warnings.push(`英語訳 ${unreviewed} 件は未確認です（画面には Not yet checked と出ます）。`);

for (const warning of warnings) console.log(`△ ${warning}`);
if (failures.length) {
  console.error(`\n${failures.length} 件の問題があります：`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('\nverify：すべて通りました。');
