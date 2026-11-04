import { api, h } from './common.js';
import { getLang, onLangChange, startReader, t, translationTag } from './reader.js';

const root = document.getElementById('root');
const voiceRoot = document.getElementById('voice');
const nextRoot = document.getElementById('next');
const shiori = document.getElementById('shiori');
const canSpeak = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let letter = null;
let offer = null;
let chapters = [];
let opened = false;
let justOpened = false;
let revealed = 0; // 開いている便箋の数。chapters.length + 1 で結びまで。
let speaking = null; // 読み上げ中の便箋の番号
let closingOpen = false;
let actionDone = false;

const en = () => getLang() === 'en';
const pair = (value) => (en() ? value.en : value.ja);
const pad = (n) => String(n).padStart(2, '0');
const atClosing = () => revealed > chapters.length;

/* ---- 読み上げ：原文をそのまま、ブラウザ標準の機能で読むだけ ---- */

function stopSpeech() {
  if (canSpeak) speechSynthesis.cancel();
  speaking = null;
  renderVoice();
  renderBody();
}

const speakable = (chapter) => chapter.items.filter((item) => !item.skip_speech);

function speak(index) {
  speechSynthesis.cancel();
  const lines = speakable(chapters[index]).flatMap((item) => [item.quote, item.reason_quote].filter(Boolean));
  if (lines.length === 0) return;
  speaking = index;
  lines.forEach((line, i) => {
    const utterance = new SpeechSynthesisUtterance(line);
    utterance.lang = 'ja-JP';
    if (i === lines.length - 1) {
      utterance.onend = () => {
        if (speaking === index) {
          speaking = null;
          renderVoice();
          renderBody();
        }
      };
    }
    speechSynthesis.speak(utterance);
  });
  renderVoice();
  renderBody();
}

function renderVoice() {
  if (speaking === null) {
    voiceRoot.replaceChildren();
    return;
  }
  voiceRoot.replaceChildren(h('div', { class: 'voice-bar', role: 'status' },
    h('span', { class: 'voice-bar__label', text: t('voice.label') }),
    h('button', { class: 'voice-bar__stop', type: 'button', onclick: stopSpeech, text: t('voice.stop') })));
}

/* ---- 手紙の部品 ---- */

const itemsTag = (items) => translationTag(items.map((item) => letter.translations[item.id]));

function flavorItem(item) {
  const translation = letter.translations[item.id];
  const words = translation?.untranslated ?? [];
  return h('div', { class: 'item item--flavor' },
    h('div', { class: 'word__head' },
      h('blockquote', { class: 'word mincho', lang: 'ja', text: item.quote }),
      h('span', { class: 'word__source', text: t('letter.wordSource') })),
    words.length === 0 && en() ? h('p', { class: 'word__near mono', text: t('letter.noWord') }) : null,
    words.map((word) => [
      en() ? h('p', { class: 'word__romaji mono', lang: 'ja-Latn', text: word.romaji }) : null,
      h('p', { class: 'word__near', lang: 'ja', text: word.gloss_ja }),
      h('p', { class: 'word__near mono', lang: 'en', text: word.gloss_en }),
    ]),
    words.length > 0 ? h('p', { class: 'word__by', text: t('letter.glossBy') }) : null,
    h('p', { class: 'item__foot' },
      h('span', { class: 'mono', text: t('letter.source', { ref: item.source_ref }) })));
}

function plainItem(item) {
  const translation = letter.translations[item.id];
  const english = en() && translation?.text;
  const title = en() ? translation?.title_text ?? item.title_sys : item.title_sys;
  return h('div', { class: 'item' },
    h('h3', { class: 'item__title', text: title }),
    english
      ? [
        h('blockquote', { class: 'en-main', lang: 'en', text: `“${translation.text}”` }),
        h('p', { class: 'jp-sub', lang: 'ja' }, h('span', { class: 'mono jp-sub__label', lang: 'en', text: t('letter.originalLabel') }), `「${item.quote}」`),
      ]
      : [
        en() ? h('p', { class: 'tr-pending', text: t('letter.enPending') }) : null,
        h('blockquote', { class: 'quote mincho', lang: 'ja', text: `「${item.quote}」` }),
      ],
    item.reason_quote
      ? h('div', { class: 'item__reason' },
        h('span', { class: 'mono', text: t('letter.reason') }),
        english && translation.reason_text
          ? [h('p', { class: 'en-main en-main--small', lang: 'en', text: `“${translation.reason_text}”` }), h('p', { class: 'jp-sub', lang: 'ja', text: `「${item.reason_quote}」` })]
          : h('p', { class: 'quote quote--small mincho', lang: 'ja', text: `「${item.reason_quote}」` }))
      : null,
    h('p', { class: 'item__foot' }, h('span', { class: 'mono', text: t('letter.source', { ref: item.source_ref }) })));
}

const renderItem = (item) => (item.tags.includes('味ことば') ? flavorItem(item) : plainItem(item));

function coverView() {
  const { meta, verified } = letter;
  const teaser = letter.teaser;
  const translated = teaser && letter.translations[teaser.id];
  return h('section', { class: 'sheet sheet--cover', 'data-section': 'cover' },
    h('div', { class: 'card__top' },
      h('span', { class: 'mono', text: meta.no }),
      h('span', { class: `stamp${justOpened ? ' stamp--open' : ''}${opened && !justOpened ? ' stamp--gone' : ''}`, 'aria-hidden': 'true', text: '封' })),
    h('h1', { class: 'card__veg' }, h('span', { class: 'mincho', lang: 'ja', text: meta.vegetable.ja }), ' ', h('span', { class: 'fraunces', lang: 'en', text: meta.vegetable.en })),
    h('p', { class: 'card__who', text: `${pair(meta.farmer)}／${pair(meta.town)}` }),
    teaser
      ? en() && translated?.text
        ? h('div', { class: 'card__teaser' }, translationTag([translated]), h('p', { class: 'en-main', lang: 'en', text: `“${translated.text}”` }), h('p', { class: 'jp-sub', lang: 'ja', text: `「${teaser.quote}」` }))
        : h('blockquote', { class: 'card__teaser mincho', lang: 'ja', text: `「${teaser.quote}」` })
      : null,
    h('p', { class: 'card__small', text: t('check.done') }),
    h('p', { class: 'card__small', text: t('verified', verified) }),
    !opened
      ? h('div', { class: 'cover-actions' },
        h('p', { class: 'cover-hint', text: t('letter.hint') }),
        h('button', { class: 'btn btn--primary btn--tall', type: 'button', onclick: () => openLetter(false), text: t('letter.open') }),
        canSpeak && chapters.length > 0 && speakable(chapters[0]).length > 0
          ? h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => openLetter(true), text: t('voice.play') })
          : null)
      : null);
}

function landView() {
  if (letter.land.length === 0) return null;
  return h('section', { class: 'sheet', 'data-section': 'land' },
    h('p', { class: 'mono sheet__no', text: `LAND ${pad(1)}｜${pad(letter.land.length)}` }),
    h('h2', { class: 'sheet__title' }, t('letter.opening'), ' ', h('span', { class: 'tag-note', text: t('town.tag') })),
    itemsTag(letter.land),
    letter.land.map(renderItem));
}

function chapterView(chapter, index) {
  const isSpeaking = speaking === index;
  return h('section', { class: `sheet${index === revealed - 1 ? ' appear' : ''}`, 'data-section': `bite-${index}`, id: `bite-${index}` },
    h('p', { class: 'mono sheet__no', text: `BITE ${pad(index + 1)}｜${pad(chapters.length)}` }),
    h('h2', { class: 'sheet__title', text: t(`bite.${chapter.kind}`) }),
    itemsTag(chapter.items),
    chapter.items.map(renderItem),
    canSpeak && speakable(chapter).length > 0
      ? h('div', { class: 'sheet__voice' },
        h('button', {
          class: 'btn btn--ghost',
          type: 'button',
          'aria-pressed': String(isSpeaking),
          onclick: () => (isSpeaking ? stopSpeech() : speak(index)),
          text: isSpeaking ? t('voice.stop') : t('voice.play'),
        }),
        en() ? h('p', { class: 'sheet__note', text: t('voice.enNote') }) : null)
      : null);
}

/* ---- 結び：言語で出し分ける。どちらも押すと「見本」で止まる ---- */

function originCard() {
  const total = offer.breakdown.reduce((sum, part) => sum + part.yen, 0);
  return h('div', { class: 'offer' },
    h('h3', { class: 'offer__name', text: t('close.jp.product') }),
    h('p', { class: 'offer__contents', text: t('close.jp.contents', { no: letter.meta.no }) }),
    h('p', { class: 'offer__price', text: offer.price_display }),
    h('p', { class: 'offer__share', text: offer.farmer_share_display }),
    h('h4', { class: 'offer__flow', text: t('close.jp.flow') }),
    h('div', { class: 'bar', role: 'img', 'aria-label': offer.breakdown.map((p) => `${p.label} ${p.yen.toLocaleString('ja-JP')}円（仮）`).join('、') },
      offer.breakdown.map((part) => h('span', { class: `bar__part bar__part--${part.key}`, style: `flex-grow:${part.yen / total}` }))),
    h('ul', { class: 'bar__legend' },
      offer.breakdown.map((part) => h('li', { class: part.key === 'farmer' ? 'is-first' : null },
        h('span', { class: `bar__dot bar__part--${part.key}`, 'aria-hidden': 'true' }),
        `${part.label} ${part.yen.toLocaleString('ja-JP')}円（${part.percent}%・仮）`))),
    h('p', { class: 'offer__note', text: offer.claude_cost_display }),
    h('p', { class: 'offer__note', text: t('close.jp.note') }),
    h('p', { class: 'offer__note', text: t('close.jp.domestic') }),
    actionDone
      ? h('p', { class: 'offer__done', role: 'status', text: t('close.jp.done') })
      : h('button', {
        class: 'btn btn--primary',
        type: 'button',
        onclick: () => {
          actionDone = true;
          renderBody();
        },
        text: t('close.jp.reserve'),
      }));
}

function closingJp() {
  return [
    h('p', { class: 'band band--inline', role: 'note', text: t('close.jp.band') }),
    h('p', { class: 'mono sheet__no', lang: 'en', text: t('close.jp.eyebrow') }),
    h('p', { class: 'closing__line mincho', text: t('close.jp.line', { farmer: letter.meta.farmer.ja }) }),
    h('p', { class: 'closing__sub', text: t('close.jp.sub') }),
    closingOpen
      ? originCard()
      : h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => { closingOpen = true; renderBody(); }, text: t('close.jp.button') }),
    h('p', { class: 'closing__keep', text: t('close.jp.keep') }),
  ];
}

function visitCard() {
  return h('div', { class: 'offer' },
    h('h3', { class: 'offer__name fraunces', text: t('close.en.title') }),
    h('p', { class: 'offer__contents', text: t('close.en.body') }),
    actionDone
      ? h('p', { class: 'offer__done', role: 'status', text: t('close.en.done') })
      : h('button', {
        class: 'btn btn--primary',
        type: 'button',
        onclick: () => {
          actionDone = true;
          renderBody();
        },
        text: t('close.en.notify'),
      }));
}

function closingEn() {
  return [
    h('p', { class: 'band band--inline', role: 'note', text: t('close.en.band') }),
    h('p', { class: 'mono sheet__no', text: t('close.en.eyebrow') }),
    h('p', { class: 'closing__line fraunces', text: t('close.en.line') }),
    h('p', { class: 'closing__sub', text: t('close.en.sub') }),
    closingOpen
      ? visitCard()
      : h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => { closingOpen = true; renderBody(); }, text: t('close.en.button') }),
    h('p', { class: 'closing__keep', text: t('close.en.ship') }),
  ];
}

function closingView() {
  return h('section', { class: 'sheet sheet--closing appear', 'data-section': 'closing', id: 'closing' },
    en() ? closingEn() : closingJp(),
    h('a', { class: 'closing__back', href: '/choose', text: t('letter.backToList') }));
}

/* ---- 進み方 ---- */

function renderBody() {
  if (!letter) return;
  const sections = [coverView()];
  if (opened) {
    sections.push(landView(), ...chapters.slice(0, revealed).map(chapterView));
    if (atClosing()) sections.push(closingView());
  }
  root.classList.toggle('no-appear', !justOpened && !root.dataset.animate);
  delete root.dataset.animate;
  root.replaceChildren(...sections.filter(Boolean));
  renderNext();
  updateShiori();
}

function renderNext() {
  if (!opened || atClosing()) {
    nextRoot.replaceChildren();
    return;
  }
  nextRoot.replaceChildren(h('button', {
    class: 'next-bite',
    type: 'button',
    onclick: next,
    text: revealed === chapters.length ? t('letter.toClosing') : t('letter.next'),
  }));
}

function scrollToId(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' });
}

function next() {
  if (!opened || atClosing()) return;
  if (speaking !== null) {
    speechSynthesis.cancel();
    speaking = null;
    renderVoice();
  }
  revealed += 1;
  root.dataset.animate = '1';
  renderBody();
  scrollToId(atClosing() ? 'closing' : `bite-${revealed - 1}`);
}

function openLetter(thenListen) {
  opened = true;
  justOpened = true;
  revealed = Math.min(1, chapters.length);
  if (chapters.length === 0) revealed = 1;
  renderBody();
  justOpened = false;
  if (thenListen && canSpeak) speak(0);
  const target = letter.land.length ? root.querySelector('[data-section="land"]') : document.getElementById('bite-0');
  target?.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' });
}

function updateShiori() {
  const max = document.documentElement.scrollHeight - innerHeight;
  const ratio = max > 0 ? Math.min(1, scrollY / max) : 0;
  const progress = chapters.length === 0 ? 0 : Math.min(1, revealed / (chapters.length + 1));
  shiori.style.transform = `scaleY(${opened ? Math.max(ratio * progress, progress * 0.25) : 0})`;
}

// 手が汚れていても進めるように、画面の下半分はどこを押しても次へ。
document.addEventListener('click', (event) => {
  if (!opened || atClosing()) return;
  if (event.target.closest('button, a')) return;
  if (getSelection()?.toString()) return;
  if (event.clientY > innerHeight / 2) next();
});
addEventListener('scroll', updateShiori, { passive: true });
addEventListener('pagehide', () => canSpeak && speechSynthesis.cancel());

// 切り替えても、今いる位置と読み上げは保つ。
onLangChange(() => {
  const sections = [...root.querySelectorAll('[data-section]')];
  const current = sections.filter((s) => s.getBoundingClientRect().top <= innerHeight / 3).pop();
  const key = current?.dataset.section;
  closingOpen = false;
  actionDone = false;
  renderBody();
  renderVoice();
  if (key) root.querySelector(`[data-section="${key}"]`)?.scrollIntoView({ block: 'start' });
});

await startReader();
try {
  const data = await api('letter');
  letter = data.letter;
  offer = data.offer;
} catch (error) {
  root.replaceChildren(h('p', { class: 'state', role: 'alert', text: t('choose.error') }));
}
if (letter) {
  chapters = letter.chapters.filter((c) => c.items.length > 0);
  renderBody();
} else if (!root.hasChildNodes()) {
  root.replaceChildren(
    h('p', { class: 'state', text: t('choose.empty') }),
    h('a', { class: 'btn btn--ghost', href: '/keep', text: t('choose.start') }));
}
