import { api, h } from './common.js';
import { getLang, onLangChange, startReader, t, translationTag } from './reader.js';

const root = document.getElementById('root');
let letter = null;
let failed = false;

const pair = (value) => (getLang() === 'en' ? value.en : value.ja);

function teaserView() {
  if (!letter.teaser) return null;
  const translation = letter.translations[letter.teaser.id];
  if (getLang() === 'en' && translation?.text) {
    return h('div', { class: 'card__teaser' },
      translationTag([translation]),
      h('p', { class: 'en-main', lang: 'en', text: `“${translation.text}”` }),
      h('p', { class: 'jp-sub', lang: 'ja', text: `「${letter.teaser.quote}」` }));
  }
  return h('blockquote', { class: 'card__teaser mincho', lang: 'ja', text: `「${letter.teaser.quote}」` });
}

function letterCard() {
  const { meta, verified } = letter;
  return h('article', { class: 'card' },
    h('div', { class: 'card__top' },
      h('span', { class: 'mono', text: meta.no }),
      h('span', { class: 'stamp', 'aria-hidden': 'true', text: '封' })),
    h('h2', { class: 'card__veg' }, h('span', { class: 'mincho', lang: 'ja', text: meta.vegetable.ja }), ' ', h('span', { class: 'fraunces', lang: 'en', text: meta.vegetable.en })),
    h('p', { class: 'card__who', text: `${pair(meta.farmer)}／${pair(meta.town)}` }),
    teaserView(),
    h('p', { class: 'card__small', text: t('check.done') }),
    h('p', { class: 'card__small', text: t('verified', verified) }),
    verified.dropped > 0 ? h('p', { class: 'card__small', text: t('verified.dropped', { n: verified.dropped }) }) : null,
    h('a', { class: 'btn btn--primary btn--tall', href: '/letter', text: t('choose.open') }));
}

function slot(no) {
  return h('div', { class: 'slot', 'aria-disabled': 'true' },
    h('span', { class: 'mono', text: no }),
    h('span', { text: t('choose.slot') }));
}

function render() {
  document.title = `${t('choose.heading')}｜OYASAI ORIGIN`;
  const head = [
    h('p', { class: 'lead-line', text: t('subtitle') }),
    h('h1', { class: 'section-eyebrow', text: t('choose.heading') }),
  ];
  if (failed) {
    root.replaceChildren(...head, h('p', { class: 'state', role: 'alert', text: t('choose.error') }));
    return;
  }
  if (!letter) {
    root.replaceChildren(...head,
      h('p', { class: 'state', text: t('choose.empty') }),
      h('a', { class: 'btn btn--ghost', href: '/keep', text: t('choose.start') }));
    return;
  }
  root.replaceChildren(...head, letterCard(), ...letter.meta.slots.map(slot));
}

function showOpening() {
  const params = new URLSearchParams(location.search);
  let seen = false;
  try {
    seen = sessionStorage.getItem('oyasai-opening') === '1';
    sessionStorage.setItem('oyasai-opening', '1');
  } catch {
    seen = true;
  }
  if (seen && !params.has('opening')) return;
  const overlay = h('div', { class: 'opening', onclick: () => overlay.remove() },
    h('p', { class: 'opening__core', text: t('core') }),
    h('p', { class: 'opening__sub', lang: getLang() === 'en' ? 'ja' : 'en', text: getLang() === 'en' ? '日本のお野菜を世界へ。' : 'Japanese vegetables, to the world.' }));
  document.body.append(overlay);
  overlay.addEventListener('animationend', () => overlay.remove());
  setTimeout(() => overlay.remove(), 2700); // アニメーションが進まない環境でも手紙を隠したままにしない
}

await startReader({ route: 1 });
onLangChange(render);
try {
  ({ letter } = await api('letter'));
} catch {
  failed = true;
}
render();
showOpening();
