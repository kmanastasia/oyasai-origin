import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { UserError, parseTranscript, transcriptHash } from '../lib/ingest.mjs';
import { verifyArchive } from '../lib/verbatim.mjs';
import { assignByRule, buildPublicLetter, isOutward, matchTranslations, sealArchive, withSource } from '../lib/letter.mjs';
import { NoApiKeyError, runAssignment, runFarmArchive, runIdentify, runTranslation } from './claude.mjs';

const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
let runtimeDir = `${dataDir}runtime/`;
let demo = false;

// demo は API を一度も呼ばず、同梱の保存データだけで動く。実行中のデータも通常の起動と分ける。
export function configure(options) {
  demo = Boolean(options.demo);
  runtimeDir = options.runtimeDir ?? (demo ? `${dataDir}runtime/demo/` : `${dataDir}runtime/`);
}

export const isDemo = () => demo;

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

async function readJsonIfExists(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function saveRuntime(name, value) {
  await mkdir(runtimeDir, { recursive: true });
  const tmp = `${runtimeDir}${name}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, `${runtimeDir}${name}`);
}

export const readSampleTranscript = () => readFile(`${dataDir}transcript.md`, 'utf8');

async function isSampleTranscript(paragraphs) {
  return transcriptHash(parseTranscript(await readSampleTranscript())) === transcriptHash(paragraphs);
}

const REPLAY_NOTICE = {
  demo: '保存データを表示中です（npm run demo で起動しているので、Claude は呼びません）。',
  no_key: '保存データを表示中です（.env に ANTHROPIC_API_KEY がないため）。',
  failed: '保存データを表示中です（Claude との通信に失敗したため）。',
};

// 書く側の書式（送りもと・品目・季節）。文字だけを受け取り、長さをそろえる。想いの本文は文字起こしの中（本人の言葉）にある
function cleanMeta(meta) {
  const take = (value) => (typeof value === 'string' ? value.trim().slice(0, 40) : '');
  return { farm: take(meta?.farm), item: take(meta?.item), season: take(meta?.season) };
}

export async function createDraft(text, meta) {
  const paragraphs = parseTranscript(text);
  let archive;
  let source = 'live';
  let notice = null;
  if (demo && !(await isSampleTranscript(paragraphs))) {
    throw new UserError(
      'npm run demo では、同梱の文字起こしだけを使えます。',
      '「聞き取りの見本を入れる」を押すか、自分の聞き取りを分けるなら npm run dev で起動し直してください。'
    );
  }
  try {
    archive = demo ? await readJson(`${dataDir}replay/farm_archive.json`) : await runFarmArchive(paragraphs);
    if (demo) {
      source = 'replay';
      notice = REPLAY_NOTICE.demo;
    }
  } catch (error) {
    const reason = error instanceof NoApiKeyError ? 'no_key' : 'failed';
    console.error(`[draft] ${reason}: ${error.message}`);
    if (!(await isSampleTranscript(paragraphs))) {
      throw new UserError(
        reason === 'no_key' ? 'この文字起こしを分けるには API キーが必要です。' : 'Claude との通信に失敗しました。',
        reason === 'no_key'
          ? '.env に ANTHROPIC_API_KEY を入れて npm run dev を起動し直すか、「聞き取りの見本を入れる」で同梱の文字起こしを試してください。'
          : '少し待ってもう一度押すか、「聞き取りの見本を入れる」で同梱の文字起こしを試してください。'
      );
    }
    archive = await readJson(`${dataDir}replay/farm_archive.json`);
    source = 'replay';
    notice = REPLAY_NOTICE[reason];
  }
  const checked = verifyArchive(archive, paragraphs);
  const draft = {
    status: 'draft',
    hash: transcriptHash(paragraphs),
    paragraphs,
    source,
    notice,
    is_placeholder: text.includes('【仮】'),
    meta: cleanMeta(meta),
    ...checked,
  };
  await saveRuntime('draft.json', draft);
  await rm(`${runtimeDir}published.json`, { force: true });
  await rm(`${runtimeDir}public_letter.json`, { force: true });
  return draft;
}

export const getDraft = () => readJsonIfExists(`${runtimeDir}draft.json`);

// 下書きの項目を直す：分類（タグ）・見出し・引用。引用は原文の中の連続した文字列だけ受け付け、原文にない言葉は元のまま戻す。
const CATEGORIES = new Set(['craft', 'judgment', 'land', 'person']);
const shortText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
export async function editDraft(edits) {
  const draft = await getDraft();
  if (!draft) throw new UserError('直す下書きがありません。', '文字起こしを貼って「手紙の下書きにする」を押してから、もう一度直してください。');
  const byId = new Map((Array.isArray(edits) ? edits : []).filter((e) => e && typeof e.id === 'string').map((e) => [e.id, e]));
  const proposed = draft.entries.map((entry) => {
    const edit = byId.get(entry.id);
    if (!edit) return entry;
    return {
      ...entry,
      category: CATEGORIES.has(edit.category) ? edit.category : entry.category,
      title_sys: shortText(edit.title_sys, 40) || entry.title_sys,
      quote: shortText(edit.quote, 200) || entry.quote,
    };
  });
  const checked = verifyArchive({ entries: proposed, next_questions: draft.next_questions }, draft.paragraphs);
  const rejectedIds = new Set(checked.dropped.map((d) => d.id));
  const entries = proposed.map((entry) => (rejectedIds.has(entry.id) ? draft.entries.find((o) => o.id === entry.id) : entry));
  const next = { ...draft, entries, edited: true };
  await saveRuntime('draft.json', next);
  return {
    draft: next,
    rejected: checked.dropped.map((d) => ({ id: d.id, reason: '原文にない言葉です。一字も変えずに、原文の中の続いた言葉を選んでください。' })),
  };
}

async function withReplayFallback(label, live, replay) {
  try {
    return await live();
  } catch (error) {
    console.error(`[${label}] 保存データまたは規則に切り替えます: ${error.message}`);
    return replay();
  }
}

// 保存してある訳を先に使い、原文が一致しない項目だけ Claude に頼む。頼んだ訳は実行中のデータに残して、封をし直しても取り直さない。
async function collectTranslations(outward) {
  const saved = await readJson(`${dataDir}translations.en.json`);
  const cachePath = `${runtimeDir}translations.live.json`;
  const cache = (await readJsonIfExists(cachePath)) ?? [];
  const { matched, missing } = matchTranslations(outward, [...saved.translations, ...cache]);
  if (missing.length === 0 || demo) return matched;
  try {
    const live = withSource(missing, (await runTranslation(missing)).translations);
    await saveRuntime('translations.live.json', [...cache, ...live]);
    return [...matched, ...live];
  } catch (error) {
    console.error(`[translate] 保存してある訳だけで続けます: ${error.message}`);
    return matched;
  }
}

export async function sealLetter(decisions, checkedWithFarmer = false) {
  const draft = await getDraft();
  if (!draft) {
    throw new UserError('封をする下書きがありません。', '①残す で「手紙の下書きにする」を押してから、もう一度開いてください。');
  }
  const previous = await readJsonIfExists(`${runtimeDir}published.json`);
  const version = (previous?.archive_version ?? 0) + 1;
  const { skip_speech_ids: skipSpeechIds } = await readJson(`${dataDir}speech.json`);
  const published = sealArchive(draft, decisions, undefined, version, skipSpeechIds, checkedWithFarmer === true);
  const outward = published.entries.filter(isOutward);
  const sample = await isSampleTranscript(draft.paragraphs);

  const assignment = await withReplayFallback(
    'assign',
    () => (demo ? readJson(`${dataDir}replay/letter_assignment.json`) : runAssignment(outward)),
    async () => (sample ? readJson(`${dataDir}replay/letter_assignment.json`) : assignByRule(outward))
  );
  const translationFile = { archive_version: version, translations: await collectTranslations(outward) };

  const meta = withDraftMeta(await readJson(`${dataDir}letter_meta.json`), draft.meta);
  const letter = buildPublicLetter(published, assignment, translationFile, meta);
  await saveRuntime('published.json', published);
  await saveRuntime('public_letter.json', letter);
  return { letter, published };
}

// 書く側で入れた送りもと・品目・季節を、手紙の表紙に使う（空のところは同梱の値のまま）。
function withDraftMeta(base, draftMeta) {
  if (!draftMeta) return base;
  const meta = structuredClone(base);
  // 英語は、同梱の値と同じ日本語のときだけ同梱の英語を使う（Claude に訳させない。違う語なら英語は空のまま）
  const pick = (ja, saved) => ({ ja, en: saved?.ja === ja ? saved.en : '' });
  if (draftMeta.farm) meta.farm = pick(draftMeta.farm, base.farm);
  if (draftMeta.item) meta.vegetable = pick(draftMeta.item, base.vegetable);
  if (draftMeta.season) meta.season = pick(draftMeta.season, base.season);
  return meta;
}

export async function unsealLetter() {
  await rm(`${runtimeDir}public_letter.json`, { force: true });
}

export async function resetAll() {
  await rm(runtimeDir, { recursive: true, force: true });
}

// 手紙は番号で選ぶ。番号が無いか、実行中の手紙（書く側で封をしたもの）と同じ番号ならそれを返す。
// ほかの番号は data/letters/<番号>/ に同梱した手紙（文字起こし・分類・割り当て・英訳・表紙）から組み立てる。
const lettersDir = `${dataDir}letters/`;
const BUNDLED_SEALED_AT = '2026-11-08T00:00:00.000Z';

// 番号ごとの手紙の置き場。見本の No.001 は data/ 直下（書く側の見本と同じ文字起こし・保存データ）を使う
async function bundlePaths(no) {
  const dir = `${lettersDir}${no}/`;
  if (await readJsonIfExists(`${dir}meta.json`)) {
    return { transcript: `${dir}transcript.md`, archive: `${dir}farm_archive.json`, assignment: `${dir}letter_assignment.json`, translations: `${dir}translations.en.json`, meta: `${dir}meta.json` };
  }
  const sampleMeta = await readJson(`${dataDir}letter_meta.json`);
  if (sampleMeta.no !== no) return null;
  return { transcript: `${dataDir}transcript.md`, archive: `${dataDir}replay/farm_archive.json`, assignment: `${dataDir}replay/letter_assignment.json`, translations: `${dataDir}translations.en.json`, meta: `${dataDir}letter_meta.json` };
}

async function bundledLetter(no) {
  if (!/^No\.\d{3}$/.test(no)) return null;
  const paths = await bundlePaths(no);
  if (!paths) return null;
  const paragraphs = parseTranscript(await readFile(paths.transcript, 'utf8'));
  const checked = verifyArchive(await readJson(paths.archive), paragraphs);
  const { skip_speech_ids: skipSpeechIds } = await readJson(`${dataDir}speech.json`);
  const decisions = checked.entries.map((e) => ({ id: e.id, reply: 'yes' }));
  const published = sealArchive({ ...checked, paragraphs }, decisions, BUNDLED_SEALED_AT, 1, skipSpeechIds, false);
  const assignment = await readJson(paths.assignment);
  const translations = await readJson(paths.translations);
  const meta = await readJson(paths.meta);
  return buildPublicLetter(published, assignment, { archive_version: 1, translations: translations.translations }, meta);
}

export async function getLetter(no = null) {
  const runtime = await readJsonIfExists(`${runtimeDir}public_letter.json`);
  if (!no) return runtime;
  // 書く側で封をした手紙が同じ番号なら、それを優先する。無ければ同梱の手紙（見本の No.001 も）
  if (runtime?.meta?.no === no) return runtime;
  return bundledLetter(no);
}
export const getOffer = () => readJson(`${dataDir}offer.json`);
export const getUiStrings = () => readJson(`${dataDir}ui_strings.json`);
export const getFarmers = async () => (await readJson(`${dataDir}farmers.json`)).farmers;

// お野菜の写真 → 農家。demo と鍵なしでは読まず、次にすることを添えて止める。
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
export async function identifyFarmer(image, mediaType, sample = false) {
  if (typeof image !== 'string' || !image || !IMAGE_TYPES.has(mediaType)) {
    throw new UserError('写真を受け取れませんでした。', 'JPEG か PNG の写真を選び直してください。');
  }
  const farmers = await getFarmers();
  // 見本の写真（画面が描いた「みなみ農園・にんじん」の札）は、鍵がなくても最初の農家につなぐ。鍵があれば Claude が本当に読む
  if (sample === true && (demo || !process.env.ANTHROPIC_API_KEY)) {
    const farmer = farmers[0];
    return { farmer, read: { farm_text: farmer.farm.ja, name_text: null, item_text: farmer.items[0].ja, confidence: 'high' }, sample: true };
  }
  if (demo || !process.env.ANTHROPIC_API_KEY) {
    throw new UserError(
      demo ? 'npm run demo では写真を読みません。' : '写真を読むには API キーが必要です。',
      demo ? '農家のページの「QR を読み込む（見本）」でひらけます。' : '.env に ANTHROPIC_API_KEY を入れて npm run dev を起動し直すか、農家のページの「QR を読み込む（見本）」でひらけます。'
    );
  }
  let read;
  try {
    read = await runIdentify({ data: image, mediaType }, farmers);
  } catch (error) {
    console.error(`[identify] ${error.message}`);
    throw new UserError('写真を読めませんでした（Claude との通信に失敗）。', '少し待ってもう一度選ぶか、農家のページの「QR を読み込む（見本）」でひらけます。');
  }
  const farmer = farmers.find((f) => f.id === read.farmer_id) ?? null; // 一覧にない id は使わない
  return { farmer, read: { farm_text: read.farm_text, name_text: read.name_text, item_text: read.item_text, confidence: read.confidence } };
}
