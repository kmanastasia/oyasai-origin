import { api, h, icon, motionProbe } from './common.js';
import { checkTag, cacheLetter, cachedLetter, getLang, hasStrings, onLangChange, sealStamp, startReader, t, translationTag } from './reader.js';

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

// カードの頭：質感の写真（イメージ）と、そのすぐ下に必ず注記。箱のふたとして置き、作り手・町・畑の写真としては見せない。
function cardLid() {
  return h('figure', { class: 'card__lid' },
    h('div', { class: 'card__photo' },
      h('img', { src: '/img/texture-sprouts.jpg', alt: '', width: '1200', height: '675', decoding: 'async' })),
    h('figcaption', { class: 'photo__cap card__cap', text: t('photo.caption') }));
}

function letterCard() {
  const { meta, verified } = letter;
  return h('article', { class: 'card card--letter' },
    cardLid(),
    h('div', { class: 'card__body' },
      h('div', { class: 'card__meta' },
        h('div', { class: 'card__top' },
          h('span', { class: 'mono', text: meta.no }),
          sealStamp()),
        h('h2', { class: 'card__veg' }, h('span', { class: 'mincho', lang: 'ja', text: meta.vegetable.ja }), ' ', h('span', { class: 'fraunces', lang: 'en', text: meta.vegetable.en })),
        h('p', { class: 'card__who', text: `${pair(meta.farmer)}／${pair(meta.town)}` })),
      h('div', { class: 'card__main' },
        teaserView(),
        checkTag(letter),
        h('p', { class: 'card__small', text: t('verified', verified) }),
        verified.dropped > 0 ? h('p', { class: 'card__small', text: t('verified.dropped', { n: verified.dropped }) }) : null,
        h('a', { class: 'btn btn--primary btn--tall', href: '/letter' }, h('span', { text: t('choose.open') }), icon('arrow')))));
}

// 作り手ごとの見出し（今は1人）。名前はデータのまま（架空）を付けて出す。
function makerHead() {
  return h('p', { class: 'maker-head' },
    h('span', { class: 'maker-head__label', text: t('choose.maker') }),
    h('span', { class: 'maker-head__name', text: pair(letter.meta.farmer) }));
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
  root.replaceChildren(...head, makerHead(), letterCard(), h('div', { class: 'slots' }, letter.meta.slots.map(slot)), h('p', { class: 'choose__order', text: t('choose.order') }));
}

// 最初の訪問だけ、カードの写真にかかった掛け紙（紙と帯）が横へすべって外れる。文字とラベルにはかけない。
// 動きを減らす設定・隠れたタブ・動きが止まっている環境では出さない。
function showOpening(motion) {
  const params = new URLSearchParams(location.search);
  let seen = false;
  try {
    seen = sessionStorage.getItem('oyasai-opening') === '1';
    sessionStorage.setItem('oyasai-opening', '1');
  } catch {
    seen = true;
  }
  if (seen && !params.has('opening')) return;
  if (!motion) return;
  const photo = root.querySelector('.card__photo');
  if (!photo) return;
  const wrap = h('span', { class: 'unwrap', 'aria-hidden': 'true' });
  wrap.addEventListener('animationend', () => wrap.remove());
  photo.append(wrap);
  setTimeout(() => wrap.remove(), 1400); // 動きが進まない環境でも、写真を隠したままにしない
}

const live = motionProbe(); // 読み込みを待つあいだに確かめておく
const ready = startReader({ route: 1 });
const early = cachedLetter();
if (hasStrings() && early?.letter) {
  ({ letter } = early);
  render(); // 前に読んだ手紙があれば、待たずにすぐ出す
}
const [, data] = await Promise.all([ready, api('letter').catch(() => null)]);
onLangChange(render);
if (data) {
  ({ letter } = data);
  cacheLetter(data);
} else if (!letter) failed = true;
render(); // 一覧とラベルは、動きの確かめを待たずにすぐ出す
showOpening(await live);
