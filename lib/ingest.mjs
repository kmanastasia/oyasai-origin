import { createHash } from 'node:crypto';

export class UserError extends Error {
  constructor(message, next) {
    super(message);
    this.next = next;
  }
}

const INTERVIEWER = /^(聞き手|インタビュアー|Q)$/;
const SPEAKER_LINE = /^([^：:\s]{1,16})[：:]\s*(.*)$/;

// 作り手の発言にだけ p.01 から番号を振る。聞き手の発言は引用の対象にしない。
export function parseTranscript(text) {
  const paragraphs = [];
  let speaker = null;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      speaker = null;
      continue;
    }
    if (line.startsWith('#')) continue;
    const match = line.match(SPEAKER_LINE);
    if (match) {
      speaker = match[1];
      if (!INTERVIEWER.test(speaker) && match[2]) {
        paragraphs.push({ id: `p.${String(paragraphs.length + 1).padStart(2, '0')}`, speaker, text: match[2] });
      }
    } else if (speaker && !INTERVIEWER.test(speaker)) {
      paragraphs[paragraphs.length - 1].text += line;
    }
  }
  if (paragraphs.length === 0) {
    throw new UserError(
      '作り手の発言が見つかりませんでした。',
      '「聞き手：〜」「みなみ：〜」のように、行の先頭に話し手の名前を書いて、もう一度貼ってください。'
    );
  }
  return paragraphs;
}

export function transcriptHash(paragraphs) {
  return createHash('sha256').update(paragraphs.map((p) => p.text).join('\n')).digest('hex');
}
