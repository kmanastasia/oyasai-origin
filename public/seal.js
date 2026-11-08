import { CATEGORY, api, errorBox, h, makerRoute, makimono, toolBands } from './common.js';

const root = document.getElementById('root');
document.getElementById('chrome').replaceChildren(...toolBands().filter(Boolean));
document.getElementById('route').replaceChildren(makerRoute(2));

const DEFAULT_DISCLOSURE = { land: 'public', person: 'public', craft: 'eaters_only', judgment: 'eaters_only' };
const AUDIENCE = [
  { value: 'public', label: 'だれでも読める' },
  { value: 'eaters_only', label: '野菜を食べた人にだけ' },
];

let draft = null;
let index = 0;
let decisions = new Map();
let phase = 'cards';
let result = null;
let error = null;
let demo = false;
// 本人が横で一緒に見ているか。既定は「いいえ」。封の結果に checked_with_farmer として残る。
let checkedWithFarmer = false;

const farmerName = () => draft.paragraphs[0]?.speaker ?? '農家';

function decide(entry, reply) {
  const previous = decisions.get(entry.id);
  decisions.set(entry.id, { id: entry.id, reply, disclosure: previous?.disclosure ?? DEFAULT_DISCLOSURE[entry.category] });
  index += 1;
  if (index >= draft.entries.length) phase = 'review';
  render();
}

// ②の先頭。固定タグは消せない・選べない。「本人と一緒に見ている」は入力欄ではなく2択のボタン。
function headView() {
  return h('div', { class: 'seal-head' },
    h('p', { class: 'seal-fixed', role: 'note', text: '運営者が封をします（登録のとき、本人から任されています）' }),
    h('fieldset', { class: 'together' },
      h('legend', { class: 'together__q', text: '本人と一緒に見ている' }),
      [[false, 'いいえ'], [true, 'はい']].map(([value, label]) => h('button', {
        class: 'together__btn',
        type: 'button',
        'aria-pressed': String(checkedWithFarmer === value),
        onclick: () => {
          checkedWithFarmer = value;
          render();
        },
        text: label,
      }))));
}

function cardView() {
  const entry = draft.entries[index];
  const current = decisions.get(entry.id);
  const disclosure = current?.disclosure ?? DEFAULT_DISCLOSURE[entry.category];
  return [
    headView(),
    h('p', { class: 'seal-count', text: `${farmerName()}さんの手紙 ${index + 1}／${draft.entries.length}` }),
    h('h1', { class: 'tool-h1', text: '封をする前に' }),
    h('section', { class: 'seal-card' },
      h('h2', { class: 'seal-label', text: 'あなたが話したこと' }),
      h('blockquote', { class: 'seal-quote', text: `「${entry.quote}」` }),
      entry.reason_quote ? h('blockquote', { class: 'seal-quote seal-quote--reason', text: `「${entry.reason_quote}」` }) : null,
      h('h2', { class: 'seal-label', text: '手紙には、こう書きました' }),
      h('p', { class: 'seal-title' }, h('span', { class: 'unit__cat', text: CATEGORY[entry.category] }), ` ${entry.title_sys}`),
      entry.missing_reason ? h('p', { class: 'seal-missing', text: '理由はまだ聞けていません。手紙には理由を書いていません。' }) : null),
    h('fieldset', { class: 'audience' },
      h('legend', { class: 'seal-label', text: 'この手紙を、だれに読んでもらいますか？' }),
      AUDIENCE.map(({ value, label }) => h('button', {
        class: 'audience__btn',
        type: 'button',
        'aria-pressed': String(disclosure === value),
        onclick: () => {
          decisions.set(entry.id, { id: entry.id, reply: current?.reply ?? null, disclosure: value });
          render();
        },
        text: label,
      }))),
    h('div', { class: 'seal-replies' },
      h('button', { class: 'btn btn--primary btn--big', type: 'button', onclick: () => decide(entry, 'yes'), text: 'はい、これで合っています' }),
      h('button', { class: 'btn btn--ghost btn--big', type: 'button', onclick: () => decide(entry, 'wrong'), text: 'ちがう' }),
      h('button', { class: 'btn btn--ghost btn--big', type: 'button', onclick: () => decide(entry, 'archive_only'), text: '残すだけ（外に出さない）' })),
    index > 0
      ? h('button', {
        class: 'seal-back',
        type: 'button',
        onclick: () => {
          index -= 1;
          render();
        },
        text: 'ひとつ前に戻る',
      })
      : null,
  ];
}

function reviewView() {
  const replies = [...decisions.values()];
  const count = (reply) => replies.filter((d) => d.reply === reply).length;
  return [
    headView(),
    h('h1', { class: 'tool-h1', text: '封をする前に' }),
    h('ul', { class: 'seal-summary' },
      h('li', { text: `手紙に入れる：${count('yes')}件` }),
      h('li', { text: `残すだけ（外に出さない）：${count('archive_only')}件` }),
      h('li', { text: `ちがう（もう一度聞く）：${count('wrong')}件` })),
    error ? errorBox(error) : null,
    h('button', {
      class: 'btn btn--primary btn--big',
      type: 'button',
      disabled: phase === 'sealing',
      onclick: async () => {
        phase = 'sealing';
        error = null;
        render();
        try {
          result = await api('seal', { decisions: replies, checked_with_farmer: checkedWithFarmer });
          phase = 'sealed';
          justSealed = !matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch (e) {
          error = e;
          phase = 'review';
        }
        render();
      },
      text: phase === 'sealing' ? (demo ? '封をしています…' : '封をしています。英語の手紙も用意しています…') : '封をする',
    }),
    h('button', {
      class: 'seal-back',
      type: 'button',
      onclick: () => {
        index = draft.entries.length - 1;
        phase = 'cards';
        render();
      },
      text: 'ひとつ前に戻る',
    }),
  ];
}

// 封をした印は、読む側と同じ巻いた巻物。封をした直後だけ、ひらいた巻物が巻かれていく（動きを減らす設定では動かない）
let justSealed = false;
function sealStamp() {
  const el = makimono('closed', ` maki--seal${justSealed ? ' maki--rolling' : ''}`);
  if (justSealed) { justSealed = false; setTimeout(() => el.classList.remove('maki--rolling'), 1200); }
  return el;
}

function sealedView() {
  return [
    h('div', { class: 'seal-done' },
      sealStamp(),
      h('p', { class: 'seal-done__msg', role: 'status', text: '封をしました。いつでも取り下げられます。' }),
      // 見本なので、実際には何も送らない。
      h('p', { class: 'seal-done__sub', text: '届いた形は、あとで本人にお送りします（見本・まだ送りません）' }),
      result.archive_only > 0 ? h('p', { class: 'seal-done__sub', text: `残すだけにした ${result.archive_only}件は、外に出ません。` }) : null),
    h('p', { class: 'seal-bridge', text: 'ここから先は、読む方の画面です' }),
    h('a', { class: 'btn btn--primary btn--big', href: '/choose' },
      h('span', { text: 'できあがりを見る' }),
      h('span', { class: 'btn__to', text: '→' })),
    h('button', {
      class: 'btn btn--ghost btn--big',
      type: 'button',
      onclick: async () => {
        try {
          await api('unseal', {});
          index = 0;
          phase = 'cards';
          result = null;
        } catch (e) {
          error = e;
        }
        render();
      },
      text: '取り下げる',
    }),
    error ? errorBox(error) : null,
  ];
}

function render() {
  let view;
  if (!draft) {
    view = [
      h('h1', { class: 'tool-h1', text: '封をする前に' }),
      error ? errorBox(error) : h('p', { class: 'tool-lead', text: '確かめる下書きがまだありません。' }),
      h('a', { class: 'btn btn--primary btn--big', href: '/keep', text: '手紙を書く へ' }),
    ];
  } else if (phase === 'sealed') view = sealedView();
  else if (phase === 'cards') view = cardView();
  else view = reviewView();
  root.replaceChildren(...view.filter(Boolean));
  window.scrollTo(0, 0);
}

try {
  ({ draft, demo } = await api('draft'));
  if (draft?.entries.length === 0) {
    draft = null;
    error = { message: '照合を通った項目がありません。', next: '「手紙を書く」で文字起こしを確かめて、下書きを作り直してください。' };
  }
} catch (e) {
  error = e;
}
render();
