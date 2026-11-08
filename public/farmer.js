// 作り手のページ：農園・土地・品目・季節と、畑からのお手紙。手紙はお野菜の QR を読み込むとひらく。
import { api, farmMark, h, icon, makimono, motionProbe } from './common.js';
import { scanView } from './scan.js';
import { checkTag, cacheLetter, cachedLetter, getLang, hasStrings, isUnlocked, onLangChange, openedLetters, startReader, t, translationTag, unlockLetter, warmFonts } from './reader.js';

const root = document.getElementById('root');
const id = new URLSearchParams(location.search).get('id') ?? '';
let farmer = null;
let letter = null; // この作り手の封をした手紙（あれば）
let failed = false;

const pair = (value) => (getLang() === 'en' ? value.en : value.ja);

// 手紙の一言（原文のまま）。EN では訳と「Translated by Claude」の印を一緒に出す
function teaserView() {
  if (!letter?.teaser) return null;
  const translation = letter.translations[letter.teaser.id];
  if (getLang() === 'en' && translation?.text) {
    return h('div', { class: 'card__teaser' },
      translationTag([translation]),
      h('p', { class: 'en-main', lang: 'en', text: `“${translation.text}”` }),
      h('p', { class: 'jp-sub', lang: 'ja', text: `「${letter.teaser.quote}」` }));
  }
  return h('blockquote', { class: 'card__teaser mincho', lang: 'ja', text: `「${letter.teaser.quote}」` });
}

function profileView() {
  const row = (key, value) => h('div', { class: 'profile__row' },
    h('dt', { class: 'mono', text: t(key) }),
    h('dd', { text: value }));
  return h('section', { class: 'profile' },
    h('div', { class: 'profile__head' },
      farmMark(farmer, ' farm-mark--big'),
      h('div', {},
        h('p', { class: 'mono profile__no', text: farmer.no }),
        h('h1', { class: 'profile__name mincho', text: pair(farmer.name) }))),
    h('dl', { class: 'profile__rows' },
      row('farmer.farm', pair(farmer.farm)),
      row('farmer.region', pair(farmer.region)),
      row('farmer.items', farmer.items.map(pair).join('・')),
      row('farmer.season', pair(farmer.season))));
}

// 準備中の手紙：巻いた巻物の小さな札（まだひらけない）
function comingView(entry) {
  return h('article', { class: 'card card--coming' },
    makimono('closed', ' maki--small'),
    h('span', { class: 'card__coming-text' },
      h('span', { class: 'mono', text: `${t('route.letter')} · ${entry.no}` }),
      h('span', { text: t('farmer.coming') })));
}

// 手紙の札：巻いた巻物（QR でひらく）か、ひらける巻物。準備中の手紙はその下に小さく
function letterView() {
  const coming = (farmer.letters ?? []).filter((l) => l.status === 'coming');
  if (!farmer.letter || !letter || letter.meta.no !== farmer.letter) {
    return h('section', { class: 'letters' },
      h('h2', { class: 'section-eyebrow', text: t('farmer.letters') }),
      coming.length ? coming.map(comingView) : h('p', { class: 'state', text: t('farmer.none') }));
  }
  const no = letter.meta.no;
  const unlocked = isUnlocked(no);
  const opened = openedLetters().includes(no);
  return h('section', { class: 'letters' },
    h('h2', { class: 'section-eyebrow', text: t('farmer.letters') }),
    h('article', { class: `card card--letter${unlocked ? ' is-unlocked' : ' is-locked'}` },
      h('div', { class: 'card__lid' },
        makimono(opened ? 'open' : 'closed', ' maki--card'),
        h('span', { class: 'mono card__no', text: `${t('route.letter')} · ${no}` })),
      h('div', { class: 'card__body' },
        h('h3', { class: 'card__veg' }, h('span', { class: 'mincho', lang: 'ja', text: letter.meta.vegetable.ja }), ' ', h('span', { class: 'fraunces', lang: 'en', text: letter.meta.vegetable.en })),
        h('p', { class: 'card__who', text: `${pair(letter.meta.farmer)}／${pair(letter.meta.town)}` }),
        unlocked ? teaserView() : null,
        checkTag(letter),
        h('p', { class: 'card__small', text: t('verified', letter.verified) }),
        unlocked
          ? h('a', { class: 'btn btn--primary btn--tall', href: `/letter?no=${encodeURIComponent(no)}` }, h('span', { text: t('farmer.open') }), icon('arrow'))
          : [
            h('p', { class: 'card__locked', text: t('farmer.letter.locked') }),
            // 写真を読む（Claude）。読めたらこの作り手の手紙がひらく
            scanView({ onFound: (found) => { if (found.id === farmer.id) render(); else location.assign(`/farmer?id=${encodeURIComponent(found.id)}`); } }),
            // 見本：QR を読み込んだことにする（鍵が無いときの代わり）
            h('button', { class: 'btn btn--ghost btn--tall', type: 'button', onclick: unlock, text: t('farmer.unlock') }),
          ])),
    coming.map(comingView));
}

function unlock() {
  unlockLetter(letter.meta.no);
  render();
  root.querySelector('.card--letter .btn--primary')?.focus();
}

function render() {
  if (failed || !farmer) {
    document.title = `OYASAI ORIGIN`;
    root.replaceChildren(
      h('p', { class: 'state', role: 'alert', text: t(failed ? 'farmers.error' : 'farmer.notFound') }),
      h('a', { class: 'btn btn--ghost', href: '/choose', text: t('farmer.back') }));
    return;
  }
  document.title = `${pair(farmer.name)}｜OYASAI ORIGIN`;
  root.replaceChildren(profileView(), letterView(), h('a', { class: 'profile__back', href: '/choose', text: t('farmer.back') }));
}

const live = motionProbe();
const ready = startReader({ route: 1 });
const early = cachedLetter();
if (hasStrings() && early?.letter) ({ letter } = early);
const [, farmersData, letterData] = await Promise.all([ready, api('farmers').catch(() => null), api('letter').catch(() => null)]);
onLangChange(render);
if (farmersData) farmer = farmersData.farmers.find((f) => f.id === id) ?? null;
else failed = true;
if (letterData?.letter) {
  ({ letter } = letterData);
  cacheLetter(letterData);
}
render();
// 手紙の字は、手紙の札に指やフォーカスが向いたときにだけ先に読む（移り変わりで字が揺れない）
const warm = warmFonts(letter);
for (const type of ['pointerover', 'focusin', 'touchstart', 'pointerdown']) {
  root.addEventListener(type, (event) => { if (event.target.closest?.('.card--letter')) warm(); }, { passive: true });
}
setTimeout(warm, 600);
// ひらくを押したら、手紙の字がそろうのを最長 0.3 秒だけ待ってから移る。新しいタブで開く操作はそのまま
root.addEventListener('click', (event) => {
  const link = event.target.closest?.('a.btn--primary[href^="/letter"]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const loads = warm();
  Promise.race([Promise.all(loads), new Promise((resolve) => setTimeout(resolve, 300))]).then(() => location.assign(link.href));
});
await live;
