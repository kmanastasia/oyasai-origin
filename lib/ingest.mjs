import { createHash } from 'node:crypto';

export class UserError extends Error {
  constructor(message, next) {
    super(message);
    this.next = next;
  }
}

const INTERVIEWER = /^(聞き手|インタビュアー|q|karen|カレン|かれん)$/i;
const SPEAKER_LINE = /^([^：:\s]{1,16})[：:]\s*(.*)$/;

// 全角やかっこ書き（Ｋａｒｅｎ、Karen（聞き手））でも、聞き手は聞き手として扱う。
const isInterviewer = (speaker) => speaker.normalize('NFKC').split(/[（(]/).some((part) => INTERVIEWER.test(part.replace(/[）)]/g, '')));

// 作り手の発言にだけ p.01 から番号を振る。聞き手の発言は引用の対象にしない。
export function parseTranscript(text) {
  const paragraphs = [];
  let speaker = null;
  let current = null;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      speaker = null;
      current = null;
      continue;
    }
    if (line.startsWith('#')) continue;
    const match = line.match(SPEAKER_LINE);
    if (match) {
      speaker = match[1];
      current = null;
      if (!isInterviewer(speaker) && match[2]) {
        current = { id: `p.${String(paragraphs.length + 1).padStart(2, '0')}`, speaker, text: match[2] };
        paragraphs.push(current);
      }
    } else if (speaker && !isInterviewer(speaker)) {
      if (current) current.text += line;
      else {
        current = { id: `p.${String(paragraphs.length + 1).padStart(2, '0')}`, speaker, text: line };
        paragraphs.push(current);
      }
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
