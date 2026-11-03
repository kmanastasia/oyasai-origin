// data/transcript.md から保存データ（data/replay/・data/translations.en.json）を Claude で作り直す。
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseTranscript } from '../lib/ingest.mjs';
import { verifyArchive } from '../lib/verbatim.mjs';
import { defaultDisclosure } from '../lib/letter.mjs';
import { NoApiKeyError, runAssignment, runFarmArchive, runTranslation } from '../server/claude.mjs';

const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
const save = (name, value) => writeFile(`${dataDir}${name}`, `${JSON.stringify(value, null, 2)}\n`);

try {
  const paragraphs = parseTranscript(await readFile(`${dataDir}transcript.md`, 'utf8'));
  console.log(`作り手の発言 ${paragraphs.length} 段落。分類しています…`);
  const archive = await runFarmArchive(paragraphs);
  const checked = verifyArchive(archive, paragraphs);
  console.log(`照合 ${checked.entries.length}/${checked.total}`);
  for (const d of checked.dropped) console.log(`  落とした項目 ${d.id}：${d.reason}`);

  const entries = checked.entries.map((e) => ({ ...e, disclosure: defaultDisclosure(e) }));
  console.log('便箋に割り当てています…');
  const assignment = await runAssignment(entries);
  console.log('英語に訳しています…');
  const { translations } = await runTranslation(entries);

  await save('replay/farm_archive.json', { entries: checked.entries, next_questions: checked.next_questions });
  await save('replay/letter_assignment.json', assignment);
  await save('translations.en.json', {
    archive_version: 1,
    lang: 'en',
    translated_by: 'claude',
    is_translation: true,
    translations: translations.map((t) => ({ ref_type: 'entry', ...t, reviewed_by: null })),
  });
  console.log('保存しました。npm run verify で確かめてください。');
} catch (error) {
  if (error instanceof NoApiKeyError) {
    console.error('API キーがありません。.env に ANTHROPIC_API_KEY を入れて、もう一度実行してください。');
  } else {
    console.error(`作れませんでした：${error.message}\n少し待ってもう一度実行してください。`);
  }
  process.exit(1);
}
