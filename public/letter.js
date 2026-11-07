import { api, h, icon, labelText, motionProbe, releaseIfStalled } from './common.js';
import { checkTag, beforeLangChange, cachedLetter, getLang, hasStrings, onLangChange, sealStamp, startReader, t, translationTag, warmFonts } from './reader.js';

const root = document.getElementById('root');
const voiceRoot = document.getElementById('voice');
const nextRoot = document.getElementById('next');
const shiori = document.getElementById('shiori');
const indexRoot = document.getElementById('sheet-index');
const live = document.getElementById('sr-live');
const canSpeak = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let motionOk = true; // 動きが止まっている環境では false（読み込みのときに一度だけ確かめる）
const noMotion = () => calm() || document.hidden || !motionOk;
const APPEAR_MS = 1300; // 文字が現れ終わる時間より少し長く
const SEAL_MS = 620; // 封が離れきる時間。ここで表紙を「開いたあと」の形に差し替える（見た目は動きの終わりと同じ）
const SLIDE_MS = 140; // 封が持ち上がり始めてすぐ、便箋が表紙の下から滑り出す（封と便箋が重なって動く。間に空白の紙を見せない）

let letter = null;
let offer = null;
let chapters = [];
let opened = false;
let unsealing = false; // 封がほどけている間
let coverVars = ''; // 封を開ける直前の表紙の高さ（ボタンの段・一言・表紙）。たたむ動きの出発点にする
let entering = new Set(); // 今回の描画で現れる区画。ここの本文だけが静かに現れる
let revealed = 0; // 開いている便箋の数。chapters.length + 1 で結びまで。
let speaking = null; // 読み上げ中の便箋の番号
let speakingItem = null; // 読み上げ中の項目の id
let speechRun = 0; // 止めた読み上げの知らせを、次の読み上げと取り違えないための番号
let closingOpen = false;
let actionDone = false;
let justOpened = false; // 申込カードを今開いたときだけ、下から入る
let gliding = false; // 手紙を送っている間は、読み上げの印で別の場所へ寄せない
let glideRun = 0;

const en = () => getLang() === 'en';
const pair = (value) => (en() ? value.en : value.ja);
const pad = (n) => String(n).padStart(2, '0');
const atClosing = () => revealed > chapters.length;

/* ---- 読み上げ：原文をそのまま、ブラウザ標準の機能で読むだけ ---- */

function cancelSpeech() {
  speechRun += 1;
  if (canSpeak) speechSynthesis.cancel();
  speaking = null;
  speakingItem = null;
}

function stopSpeech() {
  cancelSpeech();
  renderVoice();
  renderBody();
}

const speakable = (chapter) => chapter.items.filter((item) => !item.skip_speech);

// 読み上げている項目だけに印を付ける。語単位では追わない。
function markSpeaking() {
  for (const el of root.querySelectorAll('[data-item-id]')) {
    const on = el.dataset.itemId === speakingItem;
    el.classList.toggle('is-speaking', on);
    if (on && !gliding) keepInView(el);
  }
}

// 本当に見えている帯：上は掛け紙と読み上げの表示の下、下は「次のひと口へ」の上（画面に固定されているときだけ）
function visibleBand() {
  const chrome = document.getElementById('chrome')?.getBoundingClientRect().bottom ?? 0;
  const voice = voiceRoot.firstElementChild ? voiceRoot.getBoundingClientRect().bottom : 0;
  const bar = nextRoot.firstElementChild;
  const barTop = bar && getComputedStyle(bar).position === 'fixed' ? bar.getBoundingClientRect().top : innerHeight;
  return { top: Math.max(chrome, voice) + 12, bottom: Math.min(innerHeight, barTop) - 12 };
}

// 文書の中での上端。現れる動き（transform）の途中でも、落ち着いたあとの位置を返す
function docTop(el) {
  let y = 0;
  for (let n = el; n; n = n.offsetParent) y += n.offsetTop;
  return y;
}

// 読んでいる項目が帯の外なら、帯の真ん中（入りきらなければ頭）へ寄せる
function keepInView(el) {
  const top = docTop(el) - scrollY;
  const height = el.offsetHeight;
  const band = visibleBand();
  if (top >= band.top && top + height <= band.bottom) return;
  const room = band.bottom - band.top;
  const to = scrollY + top - band.top - Math.max(0, (room - height) / 2);
  if (noMotion()) scrollTo(0, to);
  else glide(to);
}

// 便箋の頭を、掛け紙（と読み上げの表示）の 24px 下に
function scrollToSection(el) {
  if (!el) return;
  const to = () => docTop(el) - (visibleBand().top + 12);
  if (noMotion()) scrollTo(0, Math.max(0, to()));
  else glide(to); // 表紙がたたまれて行き先が動いても、毎回測り直す
}

function speak(index) {
  cancelSpeech();
  const lines = speakable(chapters[index]).flatMap((item) => [item.quote, item.reason_quote].filter(Boolean).map((text) => ({ id: item.id, text })));
  if (lines.length === 0) return;
  const run = speechRun;
  speaking = index;
  const finish = () => {
    if (run !== speechRun) return;
    speaking = null;
    speakingItem = null;
    renderVoice();
    renderBody();
  };
  lines.forEach((line, i) => {
    const utterance = new SpeechSynthesisUtterance(line.text);
    utterance.lang = 'ja-JP';
    utterance.onstart = () => {
      if (run !== speechRun) return;
      speakingItem = line.id;
      markSpeaking();
    };
    if (i === lines.length - 1) {
      utterance.onend = finish;
      utterance.onerror = finish;
    }
    speechSynthesis.speak(utterance);
  });
  renderVoice();
  renderBody();
}

// 読み上げの表示は掛け紙のすぐ下の段に入る（本文の上に重ねない）。出た分・消えた分だけ送って、読んでいる位置を動かさない
function renderVoice() {
  const before = voiceRoot.offsetHeight;
  if (speaking === null) voiceRoot.replaceChildren();
  else {
    voiceRoot.replaceChildren(h('div', { class: 'voice-bar', role: 'status' },
      h('span', { class: 'voice-bar__label', text: t('voice.label') }),
      h('button', { class: 'voice-bar__stop', type: 'button', onclick: stopSpeech }, icon('stop'), h('span', { text: t('voice.stop') }))));
  }
  const delta = voiceRoot.offsetHeight - before;
  document.documentElement.style.setProperty('--voice-h', `${voiceRoot.offsetHeight}px`);
  if (delta && scrollY > 0) scrollBy({ top: delta, behavior: 'instant' });
}

/* ---- 手紙の部品 ---- */

const itemsTag = (items) => translationTag(items.map((item) => letter.translations[item.id]));

const appear = (section) => (entering.has(section) ? ' appear' : '');
const appearOrder = (section, i) => (entering.has(section) ? `--i:${Math.min(i, 4)}` : null); // 項目ごとに少しずつ遅らせる。最大5つ

// 動くのは本人の言葉だけ。出どころや翻訳の表示は最初から出しておく。
function flavorItem(item, section, i) {
  const translation = letter.translations[item.id];
  const words = translation?.untranslated ?? [];
  return h('div', { class: 'item item--flavor', 'data-item-id': item.id },
    h('div', { class: `word__head${appear(section)}`, style: appearOrder(section, i) },
      h('blockquote', { class: 'word mincho', lang: 'ja', text: item.quote }),
      h('span', { class: 'word__source', text: t('letter.wordSource') })),
    words.length === 0 && en() ? h('p', { class: 'word__near mono', text: t('letter.noWord') }) : null,
    words.map((word) => [
      en() ? h('p', { class: `word__romaji mono${appear(section)}`, style: appearOrder(section, i), lang: 'ja-Latn', text: word.romaji }) : null,
      h('p', { class: `word__near${appear(section)}`, style: appearOrder(section, i), lang: 'ja', text: word.gloss_ja }),
      h('p', { class: `word__near mono${appear(section)}`, style: appearOrder(section, i), lang: 'en', text: word.gloss_en }),
    ]),
    words.length > 0 ? h('p', { class: 'word__by', text: t('letter.glossBy') }) : null,
    h('p', { class: 'item__foot' },
      h('span', { class: 'mono', text: t('letter.source', { ref: item.source_ref }) })));
}

function plainItem(item, section, i) {
  const translation = letter.translations[item.id];
  const english = en() && translation?.text;
  const title = en() ? translation?.title_text ?? item.title_sys : item.title_sys;
  return h('div', { class: `item${appear(section)}`, style: appearOrder(section, i), 'data-item-id': item.id },
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

const renderItem = (item, section, i) => (item.tags.includes('味ことば') ? flavorItem(item, section, i) : plainItem(item, section, i));

function coverView() {
  const { meta, verified } = letter;
  const teaser = letter.teaser;
  const translated = teaser && letter.translations[teaser.id];
  // 開いたあとは、書き出しの便箋に同じ言葉が続くので、表紙の一言はたたむ（言葉は変えない・表示だけ）
  const folded = opened && !unsealing;
  const teaserBelow = folded && teaser && letter.land.some((item) => item.id === teaser.id);
  return h('section', { class: `sheet sheet--cover${unsealing ? ' is-unsealing' : ''}${folded ? ' is-opened' : ''}`, 'data-section': 'cover', style: unsealing ? coverVars : null },
    // 個包装のふた：③と同じ質感の写真（イメージ）に手紙の番号。すぐ下に必ず注記。作り手・町・畑の写真としては見せない
    h('figure', { class: 'cover-lid' },
      h('div', { class: 'cover-band' },
        h('img', { class: 'cover-band__img', src: '/img/texture-sprouts.jpg', alt: '', width: '1200', height: '675', decoding: 'sync', fetchpriority: 'high' }),
        h('span', { class: 'mono', text: `${t('route.letter')} · ${meta.no}` })),
      h('figcaption', { class: 'photo__cap cover-lid__cap', text: t('photo.caption') }),
      h('span', { class: 'cover-ribbon', 'aria-hidden': 'true' })),
    h('div', { class: 'card__top' },
      sealStamp(`${unsealing ? ' stamp--open' : ''}${opened && !unsealing ? ' stamp--gone' : ''}`)),
    h('h1', { class: 'card__veg' }, h('span', { class: 'mincho', lang: 'ja', text: meta.vegetable.ja }), ' ', h('span', { class: 'fraunces', lang: 'en', text: meta.vegetable.en })),
    h('p', { class: 'card__who', text: `${pair(meta.farmer)}／${pair(meta.town)}` }),
    teaser && !teaserBelow
      ? en() && translated?.text
        ? h('div', { class: 'card__teaser' }, translationTag([translated]), h('p', { class: 'en-main', lang: 'en', text: `“${translated.text}”` }), h('p', { class: 'jp-sub', lang: 'ja', text: `「${teaser.quote}」` }))
        : h('blockquote', { class: 'card__teaser mincho', lang: 'ja', text: `「${teaser.quote}」` })
      : null,
    checkTag(letter),
    h('p', { class: 'card__small', text: t('verified', verified) }),
    // 封がほどけている間は、ボタンの場所をそのまま残して見えなくするだけ（押した指の下で表紙が縮まない）
    !opened || unsealing
      ? h('div', { class: `cover-actions${unsealing ? ' is-leaving' : ''}`, inert: unsealing },
        h('p', { class: 'cover-hint', text: t('letter.hint') }),
        h('button', { class: 'btn btn--primary btn--tall', type: 'button', onclick: () => openLetter(false), text: t('letter.open') }),
        canSpeak && chapters.length > 0 && speakable(chapters[0]).length > 0
          ? h('button', { class: 'btn btn--ghost btn--icon', type: 'button', onclick: () => openLetter(true) }, icon('volume'), h('span', { text: t('voice.play') }))
          : null)
      : null);
}

function landView() {
  if (letter.land.length === 0) return null;
  return h('section', { class: `sheet sheet--soil sheet--land${entering.has('land') ? ' sheet--enter' : ''}`, style: '--s:0', 'data-section': 'land' },
    h('p', { class: 'mono sheet__no', text: `LAND ${pad(1)}｜${pad(letter.land.length)}` }),
    h('h2', { class: 'sheet__title', tabindex: '-1' }, t('letter.opening'), ' ', h('span', { class: 'tag-note', text: t('town.tag') })),
    itemsTag(letter.land),
    letter.land.map((item, i) => renderItem(item, 'land', i)));
}

function chapterView(chapter, index) {
  const isSpeaking = speaking === index;
  return h('section', { class: `sheet sheet--bite${entering.has(`bite-${index}`) ? ' sheet--enter' : ''}`, style: `--s:${entering.has('land') ? 1 : 0}`, 'data-section': `bite-${index}`, id: `bite-${index}` },
    h('p', { class: 'mono sheet__no', text: `BITE ${pad(index + 1)}｜${pad(chapters.length)}` }),
    h('h2', { class: 'sheet__title', tabindex: '-1', text: t(`bite.${chapter.kind}`) }),
    itemsTag(chapter.items),
    chapter.items.map((item, i) => renderItem(item, `bite-${index}`, i)),
    canSpeak && speakable(chapter).length > 0
      ? h('div', { class: 'sheet__voice' },
        h('button', {
          class: 'btn btn--ghost btn--icon',
          type: 'button',
          'aria-pressed': String(isSpeaking),
          onclick: () => (isSpeaking ? stopSpeech() : speak(index)),
        }, icon(isSpeaking ? 'stop' : 'volume'), h('span', { text: isSpeaking ? t('voice.stop') : t('voice.play') })),
        en() ? h('p', { class: 'sheet__note', text: t('voice.enNote') }) : null)
      : null);
}

/* ---- 結び：言語で出し分ける。どちらも押すと「見本」で止まる ---- */

function enterOffer() {
  if (!justOpened) return '';
  justOpened = false;
  return ' offer--enter';
}

// 申込カードを開いたら、カードの見出しへフォーカスを移す
function openOffer() {
  closingOpen = true;
  justOpened = !noMotion();
  renderBody();
  root.querySelector('.offer__name')?.focus({ preventScroll: true });
}

function originCard() {
  const total = offer.breakdown.reduce((sum, part) => sum + part.yen, 0);
  return h('div', { class: `offer${enterOffer()}` },
    h('h3', { class: 'offer__name', tabindex: '-1', text: t('close.jp.product') }),
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

// 結びの組み：帯 → 畑より → 一行と朱の封（見せ場） → 添えの文と受け取るボタン。パソコンでは左に一行、右にそのほか
function closingJp() {
  return [
    h('p', { class: 'band band--inline', role: 'note' }, labelText(t('close.jp.band'))),
    h('p', { class: 'sheet__no closing__eyebrow', text: t('close.jp.eyebrow') }),
    h('div', { class: 'closing__sign' },
      h('p', { class: `closing__line mincho${appear('closing')}`, text: t('close.jp.line', { farmer: letter.meta.farmer.ja }) }),
      sealStamp(` stamp--sign${entering.has('closing') ? ' stamp--press' : ''}`)),
    h('div', { class: 'closing__meta' },
      h('p', { class: 'closing__sub', text: t('close.jp.sub') }),
      closingOpen
        ? originCard()
        : h('button', { class: 'btn btn--primary', type: 'button', onclick: openOffer, text: t('close.jp.button') }),
      h('p', { class: 'closing__keep', text: t('close.jp.keep') })),
  ];
}

function visitCard() {
  return h('div', { class: `offer${enterOffer()}` },
    h('h3', { class: 'offer__name fraunces', tabindex: '-1', text: t('close.en.title') }),
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

// おやさい旅の SNS は行き先が決まるまで、押せない文字と「準備中」だけ。リンクにしない（トップの足もとと同じ）。
function visitSnsView() {
  return h('p', { class: 'closing__sns' },
    h('span', { class: 'closing__sns-text', text: t('visit.sns') }),
    h('span', { class: 'tag-status', text: t('sns.pending') }));
}

function closingEn() {
  return [
    h('p', { class: 'band band--inline', role: 'note' }, labelText(t('close.en.band'))),
    h('p', { class: 'mono sheet__no closing__eyebrow', text: t('close.en.eyebrow') }),
    h('div', { class: 'closing__sign' },
      h('p', { class: `closing__line fraunces${appear('closing')}`, text: t('close.en.line') })),
    h('div', { class: 'closing__meta' },
      h('p', { class: 'closing__sub', text: t('close.en.sub') }),
      h('p', { class: 'closing__operator', text: t('visit.operator') }),
      visitSnsView(),
      closingOpen
        ? visitCard()
        : h('button', { class: 'btn btn--primary', type: 'button', onclick: openOffer, text: t('close.en.button') }),
      h('p', { class: 'closing__keep', text: t('close.en.ship') })),
  ];
}

function closingView() {
  return h('section', { class: 'sheet sheet--soil sheet--closing', 'data-section': 'closing', id: 'closing', tabindex: '-1' },
    en() ? closingEn() : closingJp(),
    h('a', { class: 'closing__back', href: '/choose', text: t('letter.backToList') }));
}

/* ---- 進み方 ---- */

let pendingRender = false; // 封がほどけている間に頼まれた描き直し。封が離れたあとで一度だけ行う
function renderBody() {
  if (!letter) return;
  if (root.querySelector('.sheet--cover.is-unsealing')) { pendingRender = true; return; } // 描き直すと封の動きが最初に戻る
  const sections = [coverView()];
  if (opened && !unsealing) {
    sections.push(landView(), ...chapters.slice(0, revealed).map(chapterView));
    if (atClosing()) sections.push(closingView());
  }
  entering = new Set();
  root.replaceChildren(...sections.filter(Boolean));
  settleAppear();
  markSpeaking();
  renderNext();
  renderIndex();
  updateShiori();
}

// アニメーションが進まない環境でも本文が消えたままにならないよう、時間が来たら必ず外す。
const finishAppear = (els) => els.forEach((el) => el.classList.remove('appear', 'sheet--enter', 'stamp--press'));

function settleAppear() {
  const moving = [...root.querySelectorAll('.appear, .sheet--enter, .stamp--press')];
  if (moving.length === 0) return;
  setTimeout(() => finishAppear(moving), APPEAR_MS);
  releaseIfStalled(moving, () => finishAppear(moving));
}

function renderNext() {
  if (!opened || unsealing || atClosing()) {
    nextRoot.replaceChildren();
    return;
  }
  const toClosing = revealed === chapters.length;
  const label = toClosing ? t('letter.toClosing') : t('letter.next');
  nextRoot.replaceChildren(h('button', {
    class: 'next-bite',
    type: 'button',
    onclick: next,
  },
  h('span', { class: 'next-bite__label', text: label }),
  toClosing ? null : h('span', { class: 'next-bite__count', 'aria-hidden': 'true', text: t('letter.nextCount', { n: revealed + 1, total: chapters.length }) }),
  icon('arrow')));
}

// 「次のひと口へ」はしまわない：スマホ・タブレットでは便箋の足もとに紙の札として置かれ（本文に重ならない）、
// パソコンでは便箋の列の外の縦の札。指・ホイール・キーで動かした時刻だけ覚えておく（言語の切り替えの位置合わせのため）
let handAt = 0;
for (const type of ['touchmove', 'wheel', 'keydown']) addEventListener(type, () => { handAt = Date.now(); }, { passive: true });
addEventListener('scroll', () => { markIndex(); placeShiori(); }, { passive: true });
addEventListener('resize', () => placeShiori(), { passive: true });

/* ---- 便箋の目次（パソコン）：開いた便箋だけ。いまの便箋を緑に。移動だけで、新しい文はない ---- */
function currentSection() {
  const sections = [...root.querySelectorAll('[data-section]')];
  return sections.filter((s) => s.getBoundingClientRect().top <= innerHeight * 0.4).pop()?.dataset.section ?? 'cover';
}

function markIndex() {
  if (!indexRoot) return;
  const now = currentSection();
  for (const el of indexRoot.querySelectorAll('[data-to]')) {
    const here = el.dataset.to === now;
    el.classList.toggle('is-current', here);
    if (here) el.setAttribute('aria-current', 'true');
    else el.removeAttribute('aria-current');
  }
}

function renderIndex() {
  if (!indexRoot) return;
  if (!opened || unsealing) {
    indexRoot.replaceChildren();
    return;
  }
  const entries = [];
  if (letter.land.length) entries.push(['land', t('letter.opening')]);
  chapters.slice(0, revealed).forEach((chapter, i) => entries.push([`bite-${i}`, t(`bite.${chapter.kind}`)]));
  if (atClosing()) entries.push(['closing', t('letter.index.closing')]);
  indexRoot.setAttribute('aria-label', t('letter.index'));
  indexRoot.replaceChildren(h('p', { class: 'sheet-index__veg mincho', lang: 'ja', 'aria-hidden': 'true', text: letter.meta.vegetable.ja }),
    h('p', { class: 'sheet-index__no mono', lang: 'en', text: letter.meta.no }),
    h('ol', {}, entries.map(([key, label], i) => h('li', {},
      h('button', {
        type: 'button',
        'data-to': key,
        onclick: () => root.querySelector(`[data-section="${key}"]`)?.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' }),
      }, h('span', { class: 'sheet-index__n', 'aria-hidden': 'true', text: pad(i + 1) }), h('span', { text: label }))))));
  markIndex();
}

// 新しく開いた便箋の見出しへフォーカスを移し、位置だけを読み上げソフトに伝える（本文は読ませない）
function announce(sectionKey) {
  const section = root.querySelector(`[data-section="${sectionKey}"]`);
  (section?.querySelector('h2[tabindex]') ?? section)?.focus({ preventScroll: true });
  if (!live) return;
  if (sectionKey === 'closing') live.textContent = t('letter.toClosing');
  else if (sectionKey.startsWith('bite-')) live.textContent = `${t('letter.next')} ${Number(sectionKey.slice(5)) + 1}/${chapters.length}`;
  else live.textContent = t('letter.opening');
}


function next() {
  if (!opened || unsealing || atClosing()) return;
  if (speaking !== null) {
    cancelSpeech();
    renderVoice();
  }
  revealed += 1;
  if (!noMotion()) entering.add(atClosing() ? 'closing' : `bite-${revealed - 1}`);
  renderBody();
  scrollToSection(document.getElementById(atClosing() ? 'closing' : `bite-${revealed - 1}`));
  announce(atClosing() ? 'closing' : `bite-${revealed - 1}`);
}

function showFirstSheets() {
  unsealing = false;
  if (!noMotion()) entering = new Set(['land', 'bite-0']);
  gliding = true; // 描き直しの間は寄せない。行き先はこの下で一度だけ決める
  renderBody();
  gliding = false;
  goToFirstSheet();
}

// 封が持ち上がっている間に、便箋を表紙の下から滑り出させる（表紙は描き直さず、動きを続けたまま）
function slideOutSheets() {
  if (!unsealing) return;
  unsealing = false;
  entering = new Set(['land', 'bite-0']);
  const sections = [landView(), ...chapters.slice(0, revealed).map(chapterView)].filter(Boolean);
  entering = new Set();
  // 同じ長さだけ上から滑り出す（便箋どうしは重ならない）。書き出しの便箋のほうが少し遅れて出る（先に出るひと口の便箋の下に潜らない）
  sections.forEach((section, i) => { section.style.setProperty('--from', '-220px'); section.style.setProperty('--s', String(sections.length - 1 - i)); });
  gliding = true;
  root.append(...sections);
  settleAppear();
  markSpeaking();
  renderNext();
  renderIndex();
  updateShiori();
  gliding = false;
  goToFirstSheet();
}

// 封が離れきったら、表紙だけをその場で「開いたあと」の形にする（たたむ動きの終わりと同じ見た目。便箋の動きは止めない）
function settleCover() {
  const cover = root.querySelector('.sheet--cover.is-unsealing');
  if (!cover) return;
  cover.classList.remove('is-unsealing');
  cover.classList.add('is-opened');
  cover.removeAttribute('style');
  cover.querySelector('.cover-actions')?.remove();
  const teaser = letter.teaser;
  if (teaser && letter.land.some((item) => item.id === teaser.id)) cover.querySelector('.card__teaser')?.remove();
  const stamp = cover.querySelector('.stamp');
  if (stamp) { stamp.classList.remove('stamp--open'); stamp.classList.add('stamp--gone'); }
  if (pendingRender) { pendingRender = false; renderBody(); }
}

function goToFirstSheet() {
  const target = letter.land.length ? root.querySelector('[data-section="land"]') : document.getElementById('bite-0');
  const spoken = speakingItem && root.querySelector(`[data-item-id="${speakingItem}"]`);
  if (spoken) keepInView(spoken); // 声で読むときは、読んでいる項目へ
  else scrollToSection(target); // 書き出しの便箋の頭を掛け紙の下に（表紙は上へ送り出す）
  announce(letter.land.length ? 'land' : 'bite-0');
}

// 便箋の見出しが画面の 4 割の高さに来るところまで、短く静かに送る（標準のなめらかスクロールより短い距離と時間）
// 送り終えたら、読み上げ中の項目が帯の中にあるかをもう一度確かめる
function glide(to) {
  const from = scrollY;
  const endNow = () => Math.max(0, Math.min(typeof to === 'function' ? to() : to, document.documentElement.scrollHeight - innerHeight));
  let end = endNow();
  if (Math.abs(end - from) < 2) return;
  const run = ++glideRun;
  gliding = true;
  const start = performance.now();
  const ease = (x) => 1 - (1 - x) ** 3;
  const land = () => {
    if (run !== glideRun) return;
    glideRun += 1;
    gliding = false;
    scrollTo(0, endNow());
    requestAnimationFrame(() => requestAnimationFrame(markSpeaking));
  };
  const step = (now) => {
    if (run !== glideRun) return;
    const p = Math.min(1, (now - start) / 480);
    end = endNow();
    scrollTo(0, from + (end - from) * ease(p));
    if (p < 1) requestAnimationFrame(step);
    else land();
  };
  requestAnimationFrame(step);
  setTimeout(land, 700); // rAF が止まっていても、行き先には着く
}

// 読み上げは押した瞬間に始める。遅らせるのはスクロールと文字だけ。
function openLetter(thenListen) {
  opened = true;
  revealed = Math.min(1, chapters.length);
  if (chapters.length === 0) revealed = 1;
  if (noMotion()) {
    if (thenListen && canSpeak) speak(0);
    showFirstSheets();
    return;
  }
  unsealing = true;
  coverVars = measureCover();
  renderBody();
  if (thenListen && canSpeak) speak(0);
  setTimeout(slideOutSheets, SLIDE_MS);
  setTimeout(settleCover, SEAL_MS);
}

// 封を開ける直前に、表紙・ボタンの段・一言の高さを測っておく。たたむ動きはこの高さから 0 へ（ボタンや言葉を透明にはしない）
function measureCover() {
  const cover = root.querySelector('.sheet--cover');
  if (!cover) return '';
  const px = (el) => `${Math.round(el?.offsetHeight ?? 0)}px`;
  return `--cover-h:${px(cover)};--actions-h:${px(cover.querySelector('.cover-actions'))};--teaser-h:${px(cover.querySelector('.card__teaser'))}`;
}

// 栞の長さは開いた便箋の数だけで決める。戻っても縮まない。
// 短い栞ひもが、開いた便箋の数だけ下がる（全体の高さの線は引かない）
function updateShiori() {
  const p = opened && !unsealing ? Math.min(1, revealed / (chapters.length + 1)) : 0;
  shiori.style.setProperty('--p', String(p));
  shiori.classList.toggle('is-on', opened && !unsealing);
  placeShiori();
}

// 栞は、いま読んでいる便箋の右上の縁に挟む（便箋の幅が変わっても、紙から離れない）
function placeShiori() {
  if (!shiori.classList.contains('is-on')) return;
  const section = root.querySelector(`[data-section="${currentSection()}"]`);
  if (!section) return;
  const box = section.getBoundingClientRect();
  const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chrome-h')) || 68;
  const band = section.querySelector(':scope > .band'); // 結びの「仮」の帯には決して重ねない
  const from = band ? band.getBoundingClientRect().bottom : box.top - 6;
  shiori.style.setProperty('--shiori-x', `${Math.round(box.right - 58)}px`); // 右の縁から 48px（表紙の栞ひもと同じ）
  shiori.style.setProperty('--shiori-top', `${Math.round(Math.max(from, top - 6))}px`);
}

// 手が汚れていても進めるように、画面の下半分はどこを押しても次へ。
let pointed = false; // 本物のタッチ・ペン・マウスで押したときだけ（キーボードの click は数えない）
document.addEventListener('pointerdown', () => { pointed = true; });
document.addEventListener('click', (event) => {
  const byPointer = pointed && event.detail !== 0;
  pointed = false;
  if (!byPointer || !opened || atClosing()) return;
  if (event.target.closest('button, a')) return;
  if (getSelection()?.toString()) return;
  if (event.clientY > innerHeight / 2) next();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) finishAppear(root.querySelectorAll('.appear, .sheet--enter, .stamp--press'));
});
addEventListener('pagehide', () => canSpeak && speechSynthesis.cancel());

// 切り替えても、今いる位置と読み上げは保つ。
// 目印は、読み上げ中の項目か、画面の 4 割の高さにかかっている項目（なければ便箋）。切り替えの前と後で、その目印の画面上の高さを同じにする。
function readingAnchor() {
  const line = innerHeight * 0.4;
  const crosses = (el) => { const r = el.getBoundingClientRect(); return r.top <= line && r.bottom >= line; };
  const speakingEl = speakingItem && root.querySelector(`[data-item-id="${speakingItem}"]`);
  const el = speakingEl || [...root.querySelectorAll('[data-item-id]')].find(crosses) || [...root.querySelectorAll('[data-section]')].find(crosses);
  if (!el) return null;
  const attr = el.dataset.itemId ? 'data-item-id' : 'data-section';
  return { selector: `[${attr}="${el.getAttribute(attr)}"]`, top: el.getBoundingClientRect().top };
}

let pendingAnchor = null;
beforeLangChange(() => { pendingAnchor = readingAnchor(); });
onLangChange(() => {
  const anchor = pendingAnchor ?? readingAnchor();
  pendingAnchor = null;
  closingOpen = false;
  actionDone = false;
  renderBody();
  renderVoice();
  if (!anchor) return;
  // 書体が届いて字の幅が変わっても、目印の高さを保つ（すぐ・書体が届いたとき・少しあと の3回）
  const at = Date.now();
  const correct = () => {
    if (handAt > at) return; // そのあいだに自分で動かしたら、そちらを優先
    const again = root.querySelector(anchor.selector);
    if (again) scrollBy({ top: again.getBoundingClientRect().top - anchor.top, behavior: 'instant' });
  };
  correct();
  document.fonts?.ready.then(() => requestAnimationFrame(correct));
  setTimeout(correct, 300);
});

const useLetter = (data) => {
  letter = data.letter;
  offer = data.offer;
  chapters = letter.chapters.filter((c) => c.items.length > 0);
};

// 最初の描画は動きの確かめを待たない。答えは「封を開ける」を押すころには出ている。
motionProbe().then((ok) => { motionOk = ok; });
const ready = startReader({ route: 2 });
const early = cachedLetter();
if (hasStrings() && early?.letter && early?.offer) {
  useLetter(early);
  // ③から来たときは、④の字の書体がそろうのを少しだけ（最長 0.5 秒）待ってから描く。移り変わりの途中で代わりの書体に揺れない
  if (/\/choose/.test(document.referrer)) await Promise.race([Promise.all(warmFonts(letter)()), new Promise((r) => setTimeout(r, 500))]);
  renderBody(); // 表紙を読み込みを待たずに出す
}
const [, data] = await Promise.all([ready, api('letter').catch(() => null)]);
if (data?.letter) {
  const changed = JSON.stringify(data) !== JSON.stringify(early);
  useLetter(data);
  if (changed && !opened) renderBody();
} else if (data) {
  letter = null; // 封が取り下げられていた
  root.replaceChildren();
} else if (!letter) {
  root.replaceChildren(h('p', { class: 'state', role: 'alert', text: t('choose.error') }));
}
if (!letter && !root.hasChildNodes()) {
  root.replaceChildren(
    h('p', { class: 'state', text: t('choose.empty') }),
    h('a', { class: 'btn btn--ghost', href: '/keep', text: t('choose.start') }));
}
