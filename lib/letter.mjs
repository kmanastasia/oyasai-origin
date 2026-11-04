// 封をした原本と、受け取る側に見せる窓。窓には外に出す項目だけを渡す。
const OUTWARD = new Set(['public', 'eaters_only']);
const DEFAULT_DISCLOSURE = { land: 'public', person: 'public', craft: 'eaters_only', judgment: 'eaters_only' };

export const defaultDisclosure = (entry) => DEFAULT_DISCLOSURE[entry.category];

export const isOutward = (entry) => entry.confirmed_by !== 'unconfirmed' && OUTWARD.has(entry.disclosure);

export function sealArchive(draft, decisions, now = new Date().toISOString(), version = 1, skipSpeechIds = []) {
  const byId = new Map(decisions.map((d) => [d.id, d]));
  const skip = new Set(skipSpeechIds);
  const entries = draft.entries.map((entry) => {
    const decision = byId.get(entry.id);
    const base = {
      ...entry,
      skip_speech: entry.tags.includes('味ことば') || skip.has(entry.id),
      restates: null,
      is_fictional: true,
      is_sample: true,
    };
    if (decision?.reply === 'yes') {
      const disclosure = OUTWARD.has(decision.disclosure) ? decision.disclosure : defaultDisclosure(entry);
      return { ...base, reply: 'yes', disclosure, confirmed_by: 'operator_proxy_verbal', confirmed_at: now };
    }
    if (decision?.reply === 'archive_only') {
      return { ...base, reply: 'archive_only', disclosure: 'archive_only', confirmed_by: 'operator_proxy_verbal', confirmed_at: now };
    }
    // 「ちがう」と未回答は確認が取れていないので、外には出さない。
    return { ...base, reply: decision?.reply === 'wrong' ? 'wrong' : 'none', disclosure: 'archive_only', confirmed_by: 'unconfirmed', confirmed_at: null };
  });
  return { status: 'published', archive_version: version, sealed_at: now, entries, next_questions: draft.next_questions, dropped: draft.dropped, total: draft.total };
}

// Claude が使えないときの割り当て。分類と印だけで機械的に並べる。
export function assignByRule(entries) {
  const land = entries.filter((e) => e.category === 'land');
  const chapters = { raw: [], cooked: [], recommend: [] };
  for (const entry of entries) {
    if (entry.category === 'land') continue;
    if (entry.category === 'person' || (entry.category === 'judgment' && entry.reason_quote)) chapters.recommend.push(entry.id);
    else if (entry.category === 'judgment') chapters.raw.push(entry.id);
    else chapters.cooked.push(entry.id);
  }
  const teaser = entries.find((e) => e.disclosure === 'public');
  return {
    card_teaser_entry_id: teaser?.id ?? null,
    land_entry_ids: land.slice(0, 2).map((e) => e.id),
    chapters: Object.entries(chapters).map(([kind, entry_ids]) => ({ kind, entry_ids })),
  };
}

// 訳は、指している日本語の原文が同じときだけ再利用する。下書きを作り直すと id は変わることがあるので、id では突き合わせない。
const sourceKey = (quote, reasonQuote) => JSON.stringify([quote, reasonQuote ?? null]);

export function matchTranslations(entries, saved) {
  const bySource = new Map();
  for (const t of saved) {
    if (typeof t.source_quote !== 'string') continue;
    const key = sourceKey(t.source_quote, t.source_reason_quote);
    if (!bySource.has(key) || t.reviewed_by) bySource.set(key, t);
  }
  const matched = [];
  const missing = [];
  for (const entry of entries) {
    const hit = bySource.get(sourceKey(entry.quote, entry.reason_quote));
    if (hit) matched.push({ ...hit, ref_id: entry.id });
    else missing.push(entry);
  }
  return { matched, missing };
}

// Claude の訳に、どの原文の訳かを持たせる。渡していない id の訳と、原文にない理由の訳は捨てる。
export function withSource(entries, translations) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  return translations.filter((t) => byId.has(t.ref_id)).map((t) => {
    const entry = byId.get(t.ref_id);
    return {
      ref_type: 'entry',
      ...t,
      reason_text: entry.reason_quote ? t.reason_text : null,
      source_quote: entry.quote,
      source_reason_quote: entry.reason_quote,
      reviewed_by: null,
    };
  });
}

function viewOf(entry) {
  return {
    id: entry.id,
    category: entry.category,
    title_sys: entry.title_sys,
    quote: entry.quote,
    source_ref: entry.source_ref,
    reason_quote: entry.reason_quote,
    tags: entry.tags,
    skip_speech: entry.skip_speech,
    disclosure: entry.disclosure,
  };
}

export function buildPublicLetter(published, assignment, translationFile, meta) {
  const outward = new Map(published.entries.filter(isOutward).map((e) => [e.id, e]));
  const usable = (id) => outward.has(id);

  const placed = new Set();
  const take = (id) => {
    placed.add(id);
    return viewOf(outward.get(id));
  };
  const land = assignment.land_entry_ids.filter(usable).map(take);
  const chapters = ['raw', 'cooked', 'recommend'].map((kind) => {
    const source = assignment.chapters.find((c) => c.kind === kind);
    return { kind, items: (source?.entry_ids ?? []).filter((id) => usable(id) && !placed.has(id)).map(take) };
  });
  // 割り当てから漏れた確認済みの項目は、おすすめの便箋に足して、黙って消さない。
  for (const id of outward.keys()) {
    if (!placed.has(id)) chapters[2].items.push(take(id));
  }

  const teaserId = usable(assignment.card_teaser_entry_id) && outward.get(assignment.card_teaser_entry_id).disclosure === 'public'
    ? assignment.card_teaser_entry_id
    : [...outward.values()].find((e) => e.disclosure === 'public')?.id;

  const translations = {};
  for (const t of translationFile?.translations ?? []) {
    if (!outward.has(t.ref_id)) continue;
    const current = translationFile.archive_version === published.archive_version;
    translations[t.ref_id] = {
      text: t.text,
      reason_text: t.reason_text,
      title_text: t.title_text,
      untranslated: t.untranslated,
      reviewed_by: current ? t.reviewed_by : null,
      translated_by: 'claude',
      is_translation: true,
    };
  }

  return {
    meta,
    archive_version: published.archive_version,
    verified: { kept: published.entries.length, total: published.total, dropped: published.dropped.length },
    teaser: teaserId ? viewOf(outward.get(teaserId)) : null,
    land,
    chapters,
    translations,
    is_synthetic_voice: true,
  };
}
