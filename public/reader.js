// 受け取る側（トップ・③④）の共通部分：注意帯・掛け紙の帯・JP｜EN・流れの表示。
import { api, h, routeBar } from './common.js';

const STORAGE_KEY = 'oyasai-lang';
let dictionary = new Map();
let lang = 'ja';
const listeners = [];
let routeCurrent = 0;

function loadLang() {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (fromUrl === 'en' || fromUrl === 'ja') return fromUrl;
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

function setLang(next) {
  if (next === lang) return;
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
}

function renderChrome() {
  const root = document.getElementById('chrome');
  const toggle = (value, label) => h('button', {
    class: 'lang__btn',
    type: 'button',
    'aria-pressed': String(lang === value),
    lang: value,
    onclick: () => setLang(value),
    text: label,
  });
  root.replaceChildren(
    h('div', { class: 'band', role: 'note', text: t('band.fiction') }),
    h('header', { class: 'kakegami' },
      h('a', { class: 'kakegami__name', href: '/', lang: 'en', text: 'OYASAI ORIGIN' }),
      h('div', { class: 'lang', role: 'group', 'aria-label': 'JP / EN' }, toggle('ja', 'JP'), h('span', { class: 'lang__sep', 'aria-hidden': 'true', text: '｜' }), toggle('en', 'EN')))
  );
  renderRoute();
}

// 受け取る方の流れ（③えらぶ → ④手紙）。トップでは出さない。
function renderRoute() {
  const slot = document.getElementById('route');
  if (!slot || !routeCurrent) return;
  slot.replaceChildren(routeBar({
    who: t('route.reader'),
    steps: [['③', t('route.choose'), '/choose'], ['④', t('route.letter'), '/letter']],
    current: routeCurrent,
    home: t('route.home'),
  }));
}

export async function startReader({ route = 0 } = {}) {
  const { strings } = await api('ui-strings');
  dictionary = new Map(strings.map((s) => [s.key, s]));
  lang = loadLang();
  routeCurrent = route;
  document.documentElement.lang = lang;
  renderChrome();
}

// EN で訳文を出すところには、必ず枠線タグと確認状態を一緒に出す。
export function translationTag(translations) {
  if (lang !== 'en') return null;
  const shown = translations.filter(Boolean);
  if (shown.length === 0) return null;
  return h('p', { class: 'tr-tag' },
    h('span', { class: 'tr-tag__by', lang: 'en', text: t('letter.translatedBy') }),
    h('span', { class: 'tr-tag__state', text: shown.every((x) => x.reviewed_by) ? t('letter.checked') : t('letter.notChecked') }));
}
