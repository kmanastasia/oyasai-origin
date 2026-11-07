import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { UserError, parseTranscript, transcriptHash } from '../lib/ingest.mjs';
import { verifyArchive } from '../lib/verbatim.mjs';
import { assignByRule, buildPublicLetter, isOutward, matchTranslations, sealArchive, withSource } from '../lib/letter.mjs';
import { NoApiKeyError, runAssignment, runFarmArchive, runTranslation } from './claude.mjs';

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

export const getLetter = () => readJsonIfExists(`${runtimeDir}public_letter.json`);
export const getOffer = () => readJson(`${dataDir}offer.json`);
export const getUiStrings = () => readJson(`${dataDir}ui_strings.json`);
export const getFarmers = async () => (await readJson(`${dataDir}farmers.json`)).farmers;
