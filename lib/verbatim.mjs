// Claude の出力をコードで一字ずつ確かめる。原文にないものは、ここで落とす。
export function checkEntry(entry, paragraphs) {
  const byId = new Map(paragraphs.map((p) => [p.id, p.text]));
  const source = byId.get(entry.source_ref);
  if (!entry.quote || source === undefined || !source.includes(entry.quote)) {
    return { ok: false, reason: `quote が ${entry.source_ref} の原文と一致しません` };
  }
  if (entry.reason_quote !== null) {
    const reasonSource = byId.get(entry.reason_source_ref);
    if (!entry.reason_quote || reasonSource === undefined || !reasonSource.includes(entry.reason_quote)) {
      return { ok: false, reason: `reason_quote が ${entry.reason_source_ref} の原文と一致しません` };
    }
  }
  return { ok: true };
}

export function verifyArchive(archive, paragraphs) {
  const kept = [];
  const dropped = [];
  for (const entry of archive.entries) {
    const result = checkEntry(entry, paragraphs);
    if (result.ok) kept.push(entry);
    else dropped.push({ id: entry.id, quote: entry.quote, reason: result.reason });
  }
  const keptIds = new Set(kept.map((e) => e.id));
  const questions = archive.next_questions.filter((q) => keptIds.has(q.about_entry_id));
  return { entries: kept, next_questions: questions, dropped, total: archive.entries.length };
}
