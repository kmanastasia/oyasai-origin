// 書く側：畑からのお手紙を書く。音声の置き場（文字起こしは準備中）→ 文字起こしを貼る → Claude が分けた下書きを直す → 「手紙にする」で巻物が閉じて送られる。
// 農家の言葉は一字も直さない：引用の直しは、原文の中の続いた言葉を選び直すことだけ（サーバーでも照合する）。
import { CATEGORY, api, errorBox, h, icon, labelText, makerRoute, makimono, toolBands } from './common.js';

const root = document.getElementById('root');
document.getElementById('chrome').replaceChildren(...toolBands().filter(Boolean));
document.getElementById('route').replaceChildren(makerRoute(1));

let transcript = '';
let draft = null;
let error = null;
let working = false;
let activeId = null;
let editingId = null;
let editError = null;
let demo = false;
let audioName = ''; // 置いた音声ファイルの名前（中身は読まない・送らない）
let removed = new Set(); // 手紙に入れない項目（残すだけ）
let phase = 'draft'; // draft → sending → sent
let sentNo = null;

let meta = { farm: '', item: '', season: '' }; // 書式：送りもと（何農園か）・品目・書いている季節

const steps = () => {
  const current = phase === 'sent' ? 3 : draft ? 2 : 1;
  return h('ol', { class: 'steps' },
    ['預かる', '下書きを直す', '手紙にする'].map((label, i) =>
      h('li', { class: i + 1 === current ? 'steps__item is-current' : 'steps__item', 'aria-current': i + 1 === current ? 'step' : null, text: label })));
};

function markQuote(text, quote) {
  const at = quote ? text.indexOf(quote) : -1;
  if (at < 0) return [text];
  return [text.slice(0, at), h('mark', { text: quote }), text.slice(at + quote.length)];
}

function sourcePane() {
  const active = draft.entries.find((e) => e.id === (editingId ?? activeId));
  return h('aside', { class: 'source' },
    h('h2', { class: 'tool-h2', text: '農家の発言（原文）' }),
    draft.paragraphs.map((p) => h('p', { class: 'source__p', id: p.id },
      h('span', { class: 'mono source__id', text: p.id }),
      h('span', {}, ...(active?.source_ref === p.id ? markQuote(p.text, active.quote) : [p.text])))));
}

// 項目の直し：タグ（分類）・見出し・引用。引用は原文の中の続いた言葉だけ（外れていればここで止める）
function editForm(entry) {
  const source = draft.paragraphs.find((p) => p.id === entry.source_ref)?.text ?? '';
  const category = h('select', { class: 'field__input', id: `cat-${entry.id}` },
    Object.entries(CATEGORY).map(([value, label]) => h('option', { value, selected: value === entry.category ? 'selected' : null, text: label })));
  const title = h('input', { class: 'field__input', type: 'text', maxlength: '40', id: `title-${entry.id}` });
  title.value = entry.title_sys;
  const quote = h('textarea', { class: 'field__input unit__edit-quote', rows: 3, id: `quote-${entry.id}` });
  quote.value = entry.quote;
  const hint = h('p', { class: 'unit__edit-hint', text: '引用は、原文の中の続いた言葉をそのまま。一字でも変わると受け付けません。' });
  quote.addEventListener('input', () => {
    const ok = quote.value.trim() && source.includes(quote.value.trim());
    hint.textContent = ok ? '原文と一致しています。' : '原文にない言葉です。一字も変えずに、原文の中の続いた言葉を選んでください。';
    hint.className = `unit__edit-hint${ok ? ' is-ok' : ' is-bad'}`;
    save.disabled = !ok;
  });
  const save = h('button', {
    class: 'btn btn--primary btn--small',
    type: 'button',
    onclick: async () => {
      editError = null;
      try {
        const result = await api('draft/edit', { edits: [{ id: entry.id, category: category.value, title_sys: title.value, quote: quote.value.trim() }] });
        draft = result.draft;
        const rejected = result.rejected.find((r) => r.id === entry.id);
        if (rejected) editError = { message: rejected.reason, next: '' };
        else editingId = null;
      } catch (e) {
        editError = e;
      }
      render();
    },
    text: '直す',
  });
  return h('div', { class: 'unit__edit' },
    h('label', { class: 'field', for: `cat-${entry.id}` }, h('span', { class: 'field__label', text: 'タグ（分類）' }), category),
    h('label', { class: 'field', for: `title-${entry.id}` }, h('span', { class: 'field__label', text: '見出し' }), title),
    h('label', { class: 'field', for: `quote-${entry.id}` }, h('span', { class: 'field__label', text: '引用（本人の言葉）' }), quote),
    hint,
    editError ? errorBox(editError) : null,
    h('div', { class: 'tool-actions tool-actions--tight' },
      save,
      h('button', { class: 'btn btn--ghost btn--small', type: 'button', onclick: () => { editingId = null; editError = null; render(); }, text: 'やめる' })));
}

function entryCard(entry, index) {
  const question = draft.next_questions.find((q) => q.id === entry.next_question_id);
  const isActive = entry.id === activeId;
  const isEditing = entry.id === editingId;
  const isRemoved = removed.has(entry.id);
  return h('article', {
    class: `unit${entry.missing_reason ? ' unit--missing' : ''}${isActive ? ' is-active' : ''}${isRemoved ? ' is-removed' : ''}`,
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
      isRemoved ? h('span', { class: 'unit__cat unit__cat--soft', text: '手紙に入れない' }) : null,
      h('span', { class: 'unit__title', text: entry.title_sys }),
      h('span', { class: 'unit__quote', text: `「${entry.quote}」` }),
      h('span', { class: 'mono unit__ref', text: entry.source_ref }),
      entry.reason_quote
        ? h('span', { class: 'unit__reason' }, '理由（本人の言葉）：', h('span', { class: 'unit__reason-q', text: `「${entry.reason_quote}」` }), h('span', { class: 'mono', text: ` ${entry.reason_source_ref}` }))
        : null,
      entry.missing_reason
        ? h('span', { class: 'unit__missing' }, h('strong', { text: '理由は語られていません。' }), question ? ` 次に聞く：${question.text}` : '')
        : null),
    // 直す・外す（押しても手紙はまだ送られない）
    h('div', { class: 'unit__tools' },
      h('button', { class: 'unit__tool', type: 'button', 'aria-expanded': String(isEditing), onclick: () => { editingId = isEditing ? null : entry.id; editError = null; activeId = entry.id; render(); }, text: isEditing ? '直すのをやめる' : 'タグや文を直す' }),
      h('button', { class: 'unit__tool', type: 'button', 'aria-pressed': String(isRemoved), onclick: () => { if (isRemoved) removed.delete(entry.id); else removed.add(entry.id); render(); }, text: isRemoved ? '手紙に戻す' : '手紙に入れない' })),
    isEditing ? editForm(entry) : null);
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

// 「手紙にする」：運営者が封をする（本人から任されている）。直した項目はそのまま、「手紙に入れない」項目は残すだけにする
async function sendLetter() {
  phase = 'sending';
  error = null;
  render();
  try {
    const decisions = draft.entries.map((e) => ({ id: e.id, reply: removed.has(e.id) ? 'archive_only' : 'yes' }));
    await api('seal', { decisions, checked_with_farmer: false });
    const { letter } = await api('letter');
    sentNo = letter?.meta?.no ?? null;
    phase = 'sent';
  } catch (e) {
    error = e;
    phase = 'draft';
  }
  render();
}

function resultView() {
  const missing = draft.entries.filter((e) => e.missing_reason).length;
  const kept = draft.entries.length - removed.size;
  return [
    draft.notice ? h('p', { class: 'notice', role: 'status', text: draft.notice }) : null,
    // 【仮】の表示：ほかの表示と同じ注意黄の面に墨の線。【仮】は行の途中で割らない
    draft.is_placeholder ? h('p', { class: 'notice notice--label', role: 'status' }, labelText('この文字起こしは【仮】です。本番の文字起こしに差し替えます。')) : null,
    h('div', { class: 'draft-head' },
      h('h2', { class: 'tool-h1', text: '手紙の下書き' }),
      h('p', { class: 'badge', text: `引用 ${draft.entries.length}/${draft.total} 照合済み` }),
      h('p', { class: 'draft-head__sub', text: `理由が語られていない ${missing}件／照合で落とした ${draft.dropped.length}件／手紙に入れる ${kept}件` })),
    h('p', { class: 'tool-lead', text: 'タグ（分類）や見出し、引用の範囲はここで直せます。言葉そのものは一字も変えられません。入れたくない項目は「手紙に入れない」で残すだけにできます。' }),
    draft.dropped.length > 0
      ? h('section', { class: 'dropped' },
        h('h2', { class: 'tool-h2', text: '照合で落とした項目（原文と一致しなかったので、手紙には使いません）' }),
        h('ul', {}, draft.dropped.map((d) => h('li', { text: `${d.id}「${d.quote}」：${d.reason}` }))))
      : null,
    h('div', { class: 'draft-grid' },
      sourcePane(),
      h('div', { class: 'units' }, draft.entries.map(entryCard))),
    questionSheet(),
    error ? errorBox(error) : null,
    h('div', { class: 'tool-actions' },
      h('button', {
        class: 'btn btn--primary btn--big',
        type: 'button',
        disabled: phase === 'sending' || kept === 0,
        onclick: sendLetter,
        text: phase === 'sending' ? (demo ? '手紙にしています…' : '手紙にしています。英語の手紙も用意しています…') : '手紙にする',
      }),
      h('button', {
        class: 'btn btn--ghost',
        type: 'button',
        onclick: async () => {
          draft = null;
          activeId = null;
          editingId = null;
          removed = new Set();
          await api('reset', {});
          render();
        },
        text: 'はじめからやり直す',
      })),
  ];
}

// 送ったあと：ひらいた巻物が巻かれていき、「畑からのお手紙が送られました」
let justSent = false;
function sentView() {
  const scroll = makimono('closed', ` maki--seal${justSent ? ' maki--rolling' : ''}`);
  if (justSent) { justSent = false; setTimeout(() => scroll.classList.remove('maki--rolling'), 1200); }
  return [
    h('div', { class: 'sent' },
      scroll,
      h('h1', { class: 'tool-h1 sent__title', text: '畑からのお手紙が送られました' }),
      h('p', { class: 'tool-lead sent__sub', text: sentNo ? `手紙 ${sentNo}。受け取る側の画面で、お野菜の写真を読み込むとひらきます。` : '受け取る側の画面で、お野菜の写真を読み込むとひらきます。' }),
      h('div', { class: 'tool-actions tool-actions--center' },
        sentNo ? h('a', { class: 'btn btn--primary', href: `/letter?qr=${encodeURIComponent(sentNo)}`, text: 'できあがりを見る' }) : null,
        h('button', {
          class: 'btn btn--ghost',
          type: 'button',
          onclick: async () => {
            draft = null;
            transcript = '';
            audioName = '';
            removed = new Set();
            phase = 'draft';
            await api('reset', {});
            render();
          },
          text: 'もう一通書く',
        }))),
  ];
}

// 書式の欄：送りもと・品目・季節は短い文字だけ。想いや特徴は、本人の言葉として文字起こしの欄に入れる
function metaField(key, label, placeholder) {
  const input = h('input', { class: 'field__input', type: 'text', maxlength: '40', id: `meta-${key}`, placeholder, autocomplete: 'off' });
  input.value = meta[key];
  input.addEventListener('input', () => { meta[key] = input.value; });
  return h('label', { class: 'field', for: `meta-${key}` }, h('span', { class: 'field__label', text: label }), input);
}

// 音声の置き場：ファイルを置ける（名前だけ受け取る。中身は読まず、どこにも送らない）。文字起こしは準備中
function audioDrop() {
  const input = h('input', { class: 'audio__input', type: 'file', accept: 'audio/*', id: 'audio-file', 'aria-describedby': 'audio-note' });
  const zone = h('label', { class: `audio${audioName ? ' has-file' : ''}`, for: 'audio-file' },
    h('span', { class: 'audio__icon', 'aria-hidden': 'true' }, icon('mic')),
    h('span', { class: 'audio__text' },
      h('span', { class: 'audio__title', text: audioName ? audioName : '聞き取りの音声をここに置く' }),
      h('span', { class: 'audio__sub', id: 'audio-note', text: audioName ? '置きました。文字起こしは準備中なので、今は下の欄に文字起こしを貼ってください。' : '音声ファイルを選ぶか、ここに落とします。文字起こしは準備中（今は下の欄に貼ります）' })),
    input);
  const setFile = (file) => {
    audioName = file?.name ?? '';
    render();
  };
  input.addEventListener('change', () => setFile(input.files?.[0]));
  for (const type of ['dragenter', 'dragover']) zone.addEventListener(type, (event) => { event.preventDefault(); zone.classList.add('is-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('is-over');
    const file = [...(event.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('audio/')) ?? event.dataTransfer?.files?.[0];
    setFile(file);
  });
  return zone;
}

function inputView() {
  const area = h('textarea', {
    class: 'paste',
    rows: 12,
    'aria-label': 'こめた想いや特徴（聞き取りの文字起こし）',
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
        ({ draft } = await api('draft', { transcript, meta }));
        removed = new Set();
      } catch (e) {
        error = e;
      }
      working = false;
      render();
    },
    text: working ? (demo ? '保存データを読み込んでいます…' : 'Claude が分けています（1分ほどかかることがあります）…') : '手紙の下書きにする',
  });
  return [
    h('h1', { class: 'tool-h1', text: '畑からお手紙を書く' }),
    h('p', { class: 'tool-lead', text: '送りもと・品目・季節を書き、こめた想いや特徴は聞き取りの文字起こしのまま貼ります。Claude が技・判断・土地・人に分けます。言葉は一字も直しません。' }),
    h('div', { class: 'fields' },
      metaField('farm', '送りもと（何農園か）', '例：みなみ農園'),
      metaField('item', '品目', '例：にんじん'),
      metaField('season', '書いている季節', '例：冬')),
    h('p', { class: 'field__label field__label--area', text: '聞き取りの音声' }),
    audioDrop(),
    h('p', { class: 'field__label field__label--area', text: 'こめた想いや特徴（本人の言葉の文字起こし）' }),
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
  if (phase === 'sent' && !root.querySelector('.sent')) justSent = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const body = phase === 'sent' ? sentView() : draft ? resultView() : inputView();
  root.replaceChildren(...[steps(), ...body].filter(Boolean));
}

try {
  ({ draft, demo } = await api('draft'));
  if (draft?.meta) meta = { ...meta, ...draft.meta };
} catch (e) {
  error = e;
}
render();
