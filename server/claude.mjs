import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const MODEL = 'claude-opus-5-5';
const root = fileURLToPath(new URL('..', import.meta.url));

export class NoApiKeyError extends Error {}

export class ClaudeOutputError extends Error {}

async function loadSkill(name) {
  const text = await readFile(`${root}.claude/skills/${name}/SKILL.md`, 'utf8');
  return text.replace(/^---[\s\S]*?---\s*/, '');
}

const loadSchema = async (name) => JSON.parse(await readFile(`${root}schemas/${name}.schema.json`, 'utf8'));

// 再試行はここの1回だけにするので、SDK 側の自動再試行は切る。
function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new NoApiKeyError();
  return new Anthropic({ maxRetries: 0 });
}

function isRetryable(error) {
  if (error instanceof Anthropic.APIConnectionError) return true;
  return error instanceof Anthropic.APIError && (error.status === 429 || error.status >= 500);
}

function readJson(response) {
  if (response.stop_reason === 'refusal') {
    throw new ClaudeOutputError(`Claude が応答を断りました（${response.stop_details?.category ?? '理由不明'}）`);
  }
  if (response.stop_reason === 'max_tokens') throw new ClaudeOutputError('出力が上限で切れました');
  const block = response.content.find((b) => b.type === 'text');
  if (!block) throw new ClaudeOutputError('出力に本文がありません');
  return JSON.parse(block.text);
}

async function callStructured({ skill, schema, effort, user, maxTokens = 16000 }) {
  const api = client();
  const request = {
    model: MODEL,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort, format: { type: 'json_schema', schema: await loadSchema(schema) } },
    system: await loadSkill(skill),
    messages: [{ role: 'user', content: user }],
  };
  try {
    return readJson(await api.beta.messages.create(request));
  } catch (error) {
    if (!isRetryable(error)) throw error;
    return readJson(await api.beta.messages.create(request));
  }
}

export function runFarmArchive(paragraphs) {
  const body = paragraphs.map((p) => `${p.id} ${p.text}`).join('\n');
  return callStructured({
    skill: 'farm-archive',
    schema: 'farm_archive',
    effort: 'high',
    user: `次は作り手の発言です。行頭が段落番号です。\n\n<transcript>\n${body}\n</transcript>`,
  });
}

export function runAssignment(entries) {
  const list = entries.map(({ id, category, title_sys, quote, tags, disclosure }) => ({ id, category, title_sys, quote, tags, disclosure }));
  return callStructured({
    skill: 'eat-and-listen',
    schema: 'letter_assignment',
    effort: 'medium',
    user: `次の項目を便箋に割り当ててください。\n\n${JSON.stringify(list, null, 2)}`,
  });
}

export function runTranslation(entries) {
  const list = entries.map(({ id, title_sys, quote, reason_quote, tags }) => ({ id, title_sys, quote, reason_quote, tags }));
  return callStructured({
    skill: 'farm-archive',
    schema: 'translations',
    effort: 'medium',
    user: `今回は分類ではなく英訳の作業です。作法の「訳すとき」に従って、次の全項目を英語に訳してください。\n\n${JSON.stringify(list, null, 2)}`,
  });
}
