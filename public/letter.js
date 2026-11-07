import { api, h, icon, motionProbe, releaseIfStalled } from './common.js';
import { checkTag, getLang, onLangChange, sealStamp, startReader, t, translationTag } from './reader.js';

const root = document.getElementById('root');
const voiceRoot = document.getElementById('voice');
const nextRoot = document.getElementById('next');
const shiori = document.getElementById('shiori');
const live = document.getElementById('sr-live');
const canSpeak = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let motionOk = true; // 動きが止まっている環境では false（読み込みのときに一度だけ確かめる）
const noMotion = () => calm() || document.hidden || !motionOk;
const APPEAR_MS = 1300; // 文字が現れ終わる時間より少し長く
const SEAL_MS = 800; // 封がほどける時間。スクロールと文字はこのあとに始める

let letter = null;
let offer = null;
let chapters = [];
let opened = false;
let unsealing = false; // 封がほどけている間
let entering = new Set(); // 今回の描画で現れる区画。ここの本文だけが静かに現れる
let revealed = 0; // 開いている便箋の数。chapters.length + 1 で結びまで。
let speaking = null; // 読み上げ中の便箋の番号
let speakingItem = null; // 読み上げ中の項目の id
let speechRun = 0; // 止めた読み上げの知らせを、次の読み上げと取り違えないための番号
let closingOpen = false;
let actionDone = false;
let justOpened = false; // 申込カードを今開いたときだけ、下から入る

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
  for (const el of root.querySelectorAll('[data-item-id]')) el.classList.toggle('is-speaking', el.dataset.itemId === speakingItem);
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

function renderVoice() {
  if (speaking === null) {
    voiceRoot.replaceChildren();
    return;
  }
  voiceRoot.replaceChildren(h('div', { class: 'voice-bar', role: 'status' },
    h('span', { class: 'voice-bar__label', text: t('voice.label') }),
    h('button', { class: 'voice-bar__stop', type: 'button', onclick: stopSpeech }, icon('stop'), h('span', { text: t('voice.stop') }))));
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
  return h('section', { class: `sheet sheet--cover${unsealing ? ' is-unsealing' : ''}`, 'data-section': 'cover' },
    // 個包装の帯：手紙の番号。栞ひもは帯から下がる（飾り）
    h('div', { class: 'cover-band' }, h('span', { class: 'mono', text: `${t('route.letter')} · ${meta.no}` })),
    h('span', { class: 'cover-ribbon', 'aria-hidden': 'true' }),
    h('div', { class: 'card__top' },
      sealStamp(`${unsealing ? ' stamp--open' : ''}${opened && !unsealing ? ' stamp--gone' : ''}`)),
    h('h1', { class: 'card__veg' }, h('span', { class: 'mincho', lang: 'ja', text: meta.vegetable.ja }), ' ', h('span', { class: 'fraunces', lang: 'en', text: meta.vegetable.en })),
    h('p', { class: 'card__who', text: `${pair(meta.farmer)}／${pair(meta.town)}` }),
    teaser
      ? en() && translated?.text
        ? h('div', { class: 'card__teaser' }, translationTag([translated]), h('p', { class: 'en-main', lang: 'en', text: `“${translated.text}”` }), h('p', { class: 'jp-sub', lang: 'ja', text: `「${teaser.quote}」` }))
        : h('blockquote', { class: 'card__teaser mincho', lang: 'ja', text: `「${teaser.quote}」` })
      : null,
    checkTag(letter),
    h('p', { class: 'card__small', text: t('verified', verified) }),
    // 封がほどけている間もひと言は残し、下に空白を作らない
    unsealing ? h('div', { class: 'cover-actions' }, h('p', { class: 'cover-hint', text: t('letter.hint') })) : null,
    !opened
      ? h('div', { class: 'cover-actions' },
        h('p', { class: 'cover-hint', text: t('letter.hint') }),
        h('button', { class: 'btn btn--primary btn--tall', type: 'button', onclick: () => openLetter(false), text: t('letter.open') }),
        canSpeak && chapters.length > 0 && speakable(chapters[0]).length > 0
          ? h('button', { class: 'btn btn--ghost btn--icon', type: 'button', onclick: () => openLetter(true) }, icon('volume'), h('span', { text: t('voice.play') }))
          : null)
      : null);
}

function landView() {
  if (letter.land.length === 0) return null;
  return h('section', { class: 'sheet', 'data-section': 'land' },
    h('p', { class: 'mono sheet__no', text: `LAND ${pad(1)}｜${pad(letter.land.length)}` }),
    h('h2', { class: 'sheet__title', tabindex: '-1' }, t('letter.opening'), ' ', h('span', { class: 'tag-note', text: t('town.tag') })),
    itemsTag(letter.land),
    letter.land.map((item, i) => renderItem(item, 'land', i)));
}

function chapterView(chapter, index) {
  const isSpeaking = speaking === index;
  return h('section', { class: 'sheet', 'data-section': `bite-${index}`, id: `bite-${index}` },
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

function closingJp() {
  return [
    h('p', { class: 'band band--inline', role: 'note', text: t('close.jp.band') }),
    h('p', { class: 'sheet__no closing__eyebrow', text: t('close.jp.eyebrow') }),
    h('p', { class: `closing__line mincho${appear('closing')}`, text: t('close.jp.line', { farmer: letter.meta.farmer.ja }) }),
    h('p', { class: 'closing__sub', text: t('close.jp.sub') }),
    closingOpen
      ? originCard()
      : h('button', { class: 'btn btn--ghost', type: 'button', onclick: openOffer, text: t('close.jp.button') }),
    h('p', { class: 'closing__keep', text: t('close.jp.keep') }),
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
    h('span', { class: 'tag-note', text: t('sns.pending') }));
}

function closingEn() {
  return [
    h('p', { class: 'band band--inline', role: 'note', text: t('close.en.band') }),
    h('p', { class: 'mono sheet__no', text: t('close.en.eyebrow') }),
    h('p', { class: `closing__line fraunces${appear('closing')}`, text: t('close.en.line') }),
    h('p', { class: 'closing__sub', text: t('close.en.sub') }),
    h('p', { class: 'closing__operator', text: t('visit.operator') }),
    visitSnsView(),
    closingOpen
      ? visitCard()
      : h('button', { class: 'btn btn--ghost', type: 'button', onclick: openOffer, text: t('close.en.button') }),
    h('p', { class: 'closing__keep', text: t('close.en.ship') }),
  ];
}

function closingView() {
  return h('section', { class: 'sheet sheet--closing', 'data-section': 'closing', id: 'closing', tabindex: '-1' },
    en() ? closingEn() : closingJp(),
    h('a', { class: 'closing__back', href: '/choose', text: t('letter.backToList') }));
}

/* ---- 進み方 ---- */

function renderBody() {
  if (!letter || (unsealing && root.querySelector('.stamp--open'))) return; // 描き直すと封の動きが最初に戻る
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
  updateShiori();
}

// アニメーションが進まない環境でも本文が消えたままにならないよう、時間が来たら必ず外す。
const finishAppear = (els) => els.forEach((el) => el.classList.remove('appear'));

function settleAppear() {
  const moving = [...root.querySelectorAll('.appear')];
  if (moving.length === 0) return;
  setTimeout(() => finishAppear(moving), APPEAR_MS);
  releaseIfStalled(moving, () => finishAppear(moving));
}

function renderNext() {
  if (!opened || unsealing || atClosing()) {
    nextRoot.replaceChildren();
    return;
  }
  const label = revealed === chapters.length ? t('letter.toClosing') : t('letter.next');
  nextRoot.replaceChildren(h('button', {
    class: 'next-bite',
    type: 'button',
    onclick: next,
  }, h('span', { class: 'next-bite__label', text: label }), icon('arrow')));
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

function scrollToId(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' });
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
  scrollToId(atClosing() ? 'closing' : `bite-${revealed - 1}`);
  announce(atClosing() ? 'closing' : `bite-${revealed - 1}`);
}

function showFirstSheets() {
  unsealing = false;
  if (!noMotion()) entering = new Set(['land', 'bite-0']);
  renderBody();
  const target = letter.land.length ? root.querySelector('[data-section="land"]') : document.getElementById('bite-0');
  target?.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' });
  announce(letter.land.length ? 'land' : 'bite-0');
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
  renderBody();
  if (thenListen && canSpeak) speak(0);
  setTimeout(showFirstSheets, SEAL_MS);
}

// 栞の長さは開いた便箋の数だけで決める。戻っても縮まない。
function updateShiori() {
  const p = opened && !unsealing ? Math.min(1, revealed / (chapters.length + 1)) : 0;
  shiori.style.transform = `scaleY(${p})`;
  shiori.parentElement.style.setProperty('--p', String(p));
  shiori.parentElement.classList.toggle('has-tip', p > 0);
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
  if (document.hidden) finishAppear(root.querySelectorAll('.appear'));
});
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

// 最初の描画は動きの確かめを待たない。答えは「封を開ける」を押すころには出ている。
motionProbe().then((ok) => { motionOk = ok; });
const [, data] = await Promise.all([startReader({ route: 2 }), api('letter').catch(() => null)]);
if (data) {
  letter = data.letter;
  offer = data.offer;
} else {
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
