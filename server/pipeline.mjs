import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { UserError, parseTranscript, transcriptHash } from '../lib/ingest.mjs';
import { verifyArchive } from '../lib/verbatim.mjs';
import { assignByRule, buildPublicLetter, isOutward, sealArchive } from '../lib/letter.mjs';
import { NoApiKeyError, runAssignment, runFarmArchive, runTranslation } from './claude.mjs';

const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
const runtimeDir = `${dataDir}runtime/`;

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
  no_key: '保存データを表示中です（.env に ANTHROPIC_API_KEY がないため）。',
  failed: '保存データを表示中です（Claude との通信に失敗したため）。',
};

export async function createDraft(text) {
  const paragraphs = parseTranscript(text);
  let archive;
  let source = 'live';
  let notice = null;
  try {
    archive = await runFarmArchive(paragraphs);
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

export async function sealLetter(decisions) {
  const draft = await getDraft();
  if (!draft) {
    throw new UserError('封をする下書きがありません。', '①残す で「手紙の下書きにする」を押してから、もう一度開いてください。');
  }
  const previous = await readJsonIfExists(`${runtimeDir}published.json`);
  const version = (previous?.archive_version ?? 0) + 1;
  const published = sealArchive(draft, decisions, undefined, version);
  const outward = published.entries.filter(isOutward);
  const sample = await isSampleTranscript(draft.paragraphs);

  const assignment = await withReplayFallback(
    'assign',
    () => runAssignment(outward),
    async () => (sample ? readJson(`${dataDir}replay/letter_assignment.json`) : assignByRule(outward))
  );
  const translationFile = await withReplayFallback(
    'translate',
    async () => ({
      archive_version: version,
      ...(await runTranslation(outward)),
    }),
    async () => {
      if (!sample) return { archive_version: version, translations: [] };
      return readJson(`${dataDir}translations.en.json`);
    }
  );

  const meta = await readJson(`${dataDir}letter_meta.json`);
  const letter = buildPublicLetter(published, assignment, translationFile, meta);
  await saveRuntime('published.json', published);
  await saveRuntime('public_letter.json', letter);
  return { letter, published };
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
