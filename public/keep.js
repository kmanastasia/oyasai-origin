import { CATEGORY, api, errorBox, h, toolBands } from './common.js';

const root = document.getElementById('root');
document.getElementById('chrome').replaceChildren(...toolBands().filter(Boolean));

let transcript = '';
let draft = null;
let error = null;
let working = false;
let activeId = null;
let demo = false;

const steps = () => {
  const current = draft ? 2 : 1;
  return h('ol', { class: 'steps' },
    ['①預かる', '②下書きを見る', '③作り手に見せる'].map((label, i) =>
      h('li', { class: i + 1 === current ? 'steps__item is-current' : 'steps__item', 'aria-current': i + 1 === current ? 'step' : null, text: label })));
};

function markQuote(text, quote) {
  const at = quote ? text.indexOf(quote) : -1;
  if (at < 0) return [text];
  return [text.slice(0, at), h('mark', { text: quote }), text.slice(at + quote.length)];
}

function sourcePane() {
  const active = draft.entries.find((e) => e.id === activeId);
  return h('aside', { class: 'source' },
    h('h2', { class: 'tool-h2', text: '作り手の発言（原文）' }),
    draft.paragraphs.map((p) => h('p', { class: 'source__p', id: p.id },
      h('span', { class: 'mono source__id', text: p.id }),
      h('span', {}, ...(active?.source_ref === p.id ? markQuote(p.text, active.quote) : [p.text])))));
}

function entryCard(entry, index) {
  const question = draft.next_questions.find((q) => q.id === entry.next_question_id);
  const isActive = entry.id === activeId;
  return h('article', {
    class: `unit${entry.missing_reason ? ' unit--missing' : ''}${isActive ? ' is-active' : ''}`,
  },
    h('button', {
      class: 'unit__body',
      type: 'button',
      'aria-pressed': String(isActive),
      onclick: () => {
        activeId = isActive ? null : entry.id;
        render();
      },
    },
      h('span', { class: 'mono unit__no', text: `UNIT ${String(index + 1).padStart(2, '0')}｜${String(draft.entries.length).padStart(2, '0')}` }),
      h('span', { class: 'unit__cat', text: CATEGORY[entry.category] }),
      entry.certainty === 'inferred' ? h('span', { class: 'unit__cat unit__cat--soft', text: '分類は推定' }) : null,
      h('span', { class: 'unit__title', text: entry.title_sys }),
      h('span', { class: 'unit__quote', text: `「${entry.quote}」` }),
      h('span', { class: 'mono unit__ref', text: entry.source_ref }),
      entry.reason_quote
        ? h('span', { class: 'unit__reason' }, '理由（本人の言葉）：', h('span', { class: 'unit__reason-q', text: `「${entry.reason_quote}」` }), h('span', { class: 'mono', text: ` ${entry.reason_source_ref}` }))
        : null,
      entry.missing_reason
        ? h('span', { class: 'unit__missing' }, h('strong', { text: '理由は語られていません。' }), question ? ` 次に聞く：${question.text}` : '')
        : null));
}

function questionSheet() {
  if (draft.next_questions.length === 0) return null;
  const text = draft.next_questions.map((q, i) => `${i + 1}. ${q.text}`).join('\n');
  const copy = h('button', { class: 'btn btn--ghost btn--small', type: 'button', text: 'コピーする' });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = 'コピーしました';
    } catch {
      copy.textContent = 'コピーできませんでした。選んでコピーしてください';
    }
  });
  return h('section', { class: 'questions' },
    h('div', { class: 'questions__head' }, h('h2', { class: 'tool-h2', text: '次に聞くこと' }), copy),
    h('ol', {}, draft.next_questions.map((q) => h('li', { text: q.text }))));
}

function resultView() {
  const missing = draft.entries.filter((e) => e.missing_reason).length;
  return [
    draft.notice ? h('p', { class: 'notice', role: 'status', text: draft.notice }) : null,
    draft.is_placeholder ? h('p', { class: 'notice', role: 'status', text: 'この文字起こしは【仮】です。本番の文字起こしに差し替えます。' }) : null,
    h('div', { class: 'draft-head' },
      h('h2', { class: 'tool-h1', text: '手紙の下書き' }),
      h('p', { class: 'badge', text: `引用 ${draft.entries.length}/${draft.total} 照合済み` }),
      h('p', { class: 'draft-head__sub', text: `理由が語られていない ${missing}件／照合で落とした ${draft.dropped.length}件` })),
    draft.dropped.length > 0
      ? h('section', { class: 'dropped' },
        h('h2', { class: 'tool-h2', text: '照合で落とした項目（原文と一致しなかったので、手紙には使いません）' }),
        h('ul', {}, draft.dropped.map((d) => h('li', { text: `${d.id}「${d.quote}」：${d.reason}` }))))
      : null,
    h('div', { class: 'draft-grid' },
      sourcePane(),
      h('div', { class: 'units' }, draft.entries.map(entryCard))),
    questionSheet(),
    h('div', { class: 'tool-actions' },
      h('a', { class: 'btn btn--primary', href: '/seal', text: '作り手に見せる →' }),
      h('button', {
        class: 'btn btn--ghost',
        type: 'button',
        onclick: async () => {
          draft = null;
          activeId = null;
          await api('reset', {});
          render();
        },
        text: 'はじめからやり直す',
      })),
  ];
}

function inputView() {
  const area = h('textarea', {
    class: 'paste',
    rows: 12,
    'aria-label': '聞き取りの文字起こし',
    placeholder: '聞き手：この土地のことを教えてください。\nみなみ：……',
  });
  area.value = transcript;
  area.addEventListener('input', () => {
    transcript = area.value;
    submit.disabled = working || !transcript.trim();
  });
  const submit = h('button', {
    class: 'btn btn--primary',
    type: 'button',
    disabled: working || !transcript.trim(),
    onclick: async () => {
      working = true;
      error = null;
      render();
      try {
        ({ draft } = await api('draft', { transcript }));
      } catch (e) {
        error = e;
      }
      working = false;
      render();
    },
    text: working ? (demo ? '保存データを読み込んでいます…' : 'Claude が分けています（1分ほどかかることがあります）…') : '手紙の下書きにする',
  });
  return [
    h('h1', { class: 'tool-h1', text: '話を預かる' }),
    h('p', { class: 'tool-lead', text: '聞き取りの文字起こしを貼ると、Claude が技・判断・土地・人に分けます。言葉は一字も直しません。' }),
    area,
    error ? errorBox(error) : null,
    h('div', { class: 'tool-actions' },
      submit,
      h('button', {
        class: 'btn btn--ghost',
        type: 'button',
        disabled: working,
        onclick: async () => {
          try {
            ({ transcript } = await api('sample'));
            error = null;
          } catch (e) {
            error = e;
          }
          render();
        },
        text: '聞き取りの見本を入れる',
      })),
  ];
}

function render() {
  root.replaceChildren(...[steps(), ...(draft ? resultView() : inputView())].filter(Boolean));
}

try {
  ({ draft, demo } = await api('draft'));
} catch (e) {
  error = e;
}
render();
