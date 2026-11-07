// 受け取る側（トップ・作り手・手紙）の共通部分：掛け紙の帯・JP｜EN・流れの表示・手紙をひらいた記録。
import { api, h, icon, motionProbe, routeBar } from './common.js';

const STORAGE_KEY = 'oyasai-lang';
let dictionary = new Map();
let lang = 'ja';
const listeners = [];
let routeCurrent = 0;

function loadLang() {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (fromUrl === 'en' || fromUrl === 'ja') {
    try {
      localStorage.setItem(STORAGE_KEY, fromUrl); // ?lang= で来ても、次の画面で言語が戻らないように
    } catch {
      // 保存できなくても、この画面はその言語で出す。
    }
    return fromUrl;
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'ja') return saved;
  } catch {
    // 保存できない環境では、日本語から始める。
  }
  return 'ja';
}

export const getLang = () => lang;

export function t(key, values = {}) {
  const entry = dictionary.get(key);
  let text = entry ? entry[lang] : key;
  for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, value);
  return text;
}

export const onLangChange = (listener) => listeners.push(listener);
// 切り替える直前（まだ元の言葉の組みのうち）に呼ぶ。読んでいる位置を測るため
const beforeListeners = [];
export const beforeLangChange = (listener) => beforeListeners.push(listener);

function setLang(next) {
  if (next === lang) return;
  for (const listener of beforeListeners) listener();
  lang = next;
  document.documentElement.lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 保存できなくても、今の画面は切り替える。
  }
  const url = new URL(location.href);
  url.searchParams.delete('lang');
  history.replaceState(null, '', url);
  renderChrome();
  for (const listener of listeners) listener();
  softenSwap();
}

// 切り替えた言葉だけが静かに入れ替わる。ラベル（架空・見本・仮・Translated by Claude・合成音声）を含むものは動かさず、すぐ出す。
const SWAP_TEXT = '.top__core, .lead-line, .section-eyebrow, .door__for, .door__title, .door__sub, .card__veg, .en-main, .jp-sub, .quote, .item__title, .sheet__title, .closing__sub, .cover-hint, .choose__order';
const LABEL_WORDS = /架空|見本|仮|合成音声|ictional|ample|ynthetic|Translated by Claude/; // 文の中にラベルの語があるものも動かさない
const LABELS = '.band, .tag-note, .tag-line, .tr-tag, .voice-bar, .offer__done';
async function softenSwap() {
  if (!(await motionProbe())) return;
  const root = document.getElementById('root');
  const moving = [...(root?.querySelectorAll(SWAP_TEXT) ?? [])].filter((el) => !el.matches(LABELS) && !el.querySelector(LABELS) && !el.closest(LABELS) && !LABEL_WORDS.test(el.textContent));
  // 長さと緩急は CSS の決まりごと（--dur-m・--ease-out）から読む。見出しが空白にならないよう、薄い墨から始める
  const css = getComputedStyle(document.documentElement);
  const duration = parseFloat(css.getPropertyValue('--dur-m')) || 400;
  const easing = css.getPropertyValue('--ease-out').trim() || 'ease-out';
  const runs = moving.map((el) => el.animate(
    [{ opacity: 0.35, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }],
    { duration, easing }));
  const finish = () => runs.forEach((run) => run.finish());
  setTimeout(() => { if (runs.length && !(runs[0].currentTime > 0)) finish(); }, 80); // 動きが止められていたら、すぐ出す
  setTimeout(finish, 600); // どんな環境でも、言葉を隠したままにしない
}

function renderChrome() {
  const root = document.getElementById('chrome');
  const focused = document.activeElement?.closest?.('.lang__btn')?.getAttribute('lang');
  const toggle = (value, label) => h('button', {
    class: 'lang__btn',
    type: 'button',
    'aria-pressed': String(lang === value),
    lang: value,
    onclick: () => setLang(value),
    text: label,
  });
  root.replaceChildren(
    h('header', { class: 'kakegami' },
      h('a', { class: 'kakegami__name', href: '/', lang: 'en', text: 'OYASAI ORIGIN' }),
      h('div', { class: 'lang', role: 'group', 'aria-label': 'JP / EN' }, icon('languages'), toggle('ja', 'JP'), h('span', { class: 'lang__sep', 'aria-hidden': 'true', text: '｜' }), toggle('en', 'EN')))
  );
  // 押した言語のボタンにフォーカスを戻す（キーボードで切り替えても、位置を見失わない）
  if (focused) root.querySelector(`.lang__btn[lang="${focused}"]`)?.focus();
  renderRoute();
}

// 読む流れ（作り手 → 手紙）。番号は付けない。トップでは出さない。
function renderRoute() {
  const slot = document.getElementById('route');
  if (!slot || !routeCurrent) return;
  slot.replaceChildren(routeBar({
    who: t('route.read'),
    steps: [[t('route.choose'), '/choose'], [t('route.letter'), '/letter']],
    current: routeCurrent,
    home: t('route.home'),
  }));
}

/* ---- 手紙をひらいた記録と、QR で開く印（この端末の中だけ。サーバーには送らない） ---- */
const OPENED_KEY = 'oyasai-opened'; // ひらいた手紙の番号（残る）
const UNLOCK_KEY = 'oyasai-unlocked'; // QR を読み込んだ手紙の番号（このタブの間だけ）
const readList = (store, key) => {
  try {
    const list = JSON.parse(store.getItem(key) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};
const addTo = (store, key, no) => {
  try {
    const list = readList(store, key);
    if (!list.includes(no)) store.setItem(key, JSON.stringify([...list, no]));
  } catch {
    // 保存できない環境では、この画面の間だけ覚える
  }
};
export const openedLetters = () => readList(localStorage, OPENED_KEY);
export const markOpened = (no) => addTo(localStorage, OPENED_KEY, no);
// QR を読み込んだことにする（見本のボタンと、QR の URL ?qr=番号 から呼ぶ。明日の読み取りはここにつなぐ）
export const unlockLetter = (no) => addTo(sessionStorage, UNLOCK_KEY, no);
export const isUnlocked = (no) => readList(sessionStorage, UNLOCK_KEY).includes(no) || openedLetters().includes(no);

// 画面の言葉は、同じタブで一度読んだら sessionStorage に置き、次の画面ではすぐに帯と流れの表示を出す（裏で新しくする）。
const STRINGS_KEY = 'oyasai-ui-strings';
const readSession = (key) => {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
};
const writeSession = (key, value) => {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 保存できなくても、画面はそのまま出す。
  }
};
export const hasStrings = () => dictionary.size > 0;

export function startReader({ route = 0 } = {}) {
  lang = loadLang();
  routeCurrent = route;
  document.documentElement.lang = lang;
  const cached = readSession(STRINGS_KEY);
  if (Array.isArray(cached) && cached.length) {
    dictionary = new Map(cached.map((s) => [s.key, s]));
    renderChrome();
  }
  const fresh = api('ui-strings').then(({ strings }) => {
    writeSession(STRINGS_KEY, strings);
    const changed = JSON.stringify(strings) !== JSON.stringify(cached);
    dictionary = new Map(strings.map((s) => [s.key, s]));
    if (changed) renderChrome();
    return changed;
  });
  if (hasStrings()) {
    fresh.catch(() => {});
    return Promise.resolve(false);
  }
  return fresh;
}

// ④で使う字の書体を、③にいる間に先に読んでおく（④に移ったとき、代わりの書体から入れ替わって字が揺れないように）。
// 読むのは④に実際に出る字の形だけ（本人の言葉と④の画面の文）。画面には何も足さない。
const LETTER_KEYS = /^(letter|bite|voice|close|visit|route|verified|sns|check|farmer)/;
export function warmFonts(letterData) {
  let done = false;
  let loads = [];
  return () => {
    if (done || !letterData) return loads;
    done = true;
    const items = [...(letterData.land ?? []), ...(letterData.chapters ?? []).flatMap((c) => c.items)];
    const quotes = items.map((i) => `${i.quote ?? ''}${i.reason_quote ?? ''}`).join('') + (letterData.teaser?.quote ?? '') + (letterData.meta?.vegetable?.ja ?? '') + '「」';
    const ui = [...dictionary.values()].filter((s) => LETTER_KEYS.test(s.key)).map((s) => (lang === 'en' ? s.en : s.ja)).join('')
      + items.map((i) => i.title_sys ?? '').join('') + (letterData.meta?.farmer?.ja ?? '') + (letterData.meta?.farm?.ja ?? '') + (letterData.meta?.town?.ja ?? '');
    const unique = (text) => [...new Set(text)].join('');
    const load = (face, text) => document.fonts?.load(face, unique(text)).catch(() => {}) ?? Promise.resolve();
    loads = [
      load('500 16px "Shippori Mincho B1"', quotes + ui),
      load('400 16px "Zen Kaku Gothic New"', ui + quotes),
      load('500 16px "Zen Kaku Gothic New"', ui),
      load('700 16px "Zen Kaku Gothic New"', ui),
      load('400 16px "DM Mono"', ui),
    ];
    return loads;
  };
}

// ③で読んだ手紙を④に渡す（④の表紙を、読み込みを待たずに出すため）
const LETTER_KEY = 'oyasai-letter';
export const cachedLetter = () => readSession(LETTER_KEY);
export const cacheLetter = (data) => writeSession(LETTER_KEY, data);

// EN で訳文を出すところには、必ず枠線タグと確認状態を一緒に出す。
export function translationTag(translations) {
  if (lang !== 'en') return null;
  const shown = translations.filter(Boolean);
  if (shown.length === 0) return null;
  return h('p', { class: 'tr-tag' },
    h('span', { class: 'tr-tag__by', lang: 'en', text: t('letter.translatedBy') }),
    h('span', { class: 'tr-tag__state', text: shown.every((x) => x.reviewed_by) ? t('letter.checked') : t('letter.notChecked') }));
}

// 作り手の画面と手紙の表紙の確認のタグ。消す操作はない。
// デモでは「本人と一緒に見ている」の答えにかかわらず、いつも今の文（運営者の代理）を点線の枠で出す。
// 「一緒に確かめた」の文は本番だけ（デモでは使わない）。
export function checkTag() {
  return h('p', { class: 'tag-line tag-line--proxy' }, h('span', { text: t('check.done') }));
}

// 朱の封。SVG は HTML の <template> から複製する（h() では SVG を作れない）。「封」の字にはにじみをかけない。
export function sealStamp(extra = '') {
  const el = h('span', { class: `stamp${extra}`, 'aria-hidden': 'true' });
  const template = document.getElementById('tpl-stamp');
  if (template) el.append(template.content.firstElementChild.cloneNode(true));
  else el.textContent = '封';
  return el;
}
