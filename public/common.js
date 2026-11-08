// 文字はすべて textContent で入れる（貼られた文章を HTML として扱わない）。
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'text') el.textContent = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

export class ApiError extends Error {
  constructor(message, next) {
    super(message);
    this.next = next;
  }
}

export async function api(path, body) {
  let response;
  try {
    response = await fetch(`/api/${path}`, body === undefined ? {} : {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('サーバーにつながりませんでした。', 'npm run dev が動いているか確かめて、もう一度試してください。');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(data.error ?? 'うまく処理できませんでした。', data.next ?? 'もう一度試してください。');
  }
  return data;
}

export function errorBox(error) {
  return h('div', { class: 'error', role: 'alert' },
    h('p', { class: 'error__what', text: error.message }),
    error.next ? h('p', { class: 'error__next', text: error.next }) : null);
}

export const CATEGORY = { craft: '技', judgment: '判断', land: '土地', person: '人' };

// どの画面でも「読む／書くのどちらの流れの、どこにいるか」と、トップへ戻る道を出す。番号は付けない。
// steps は [呼び名, 行き先] の並び。current は 1 から数える（0 ならどれも今ではない）。
export function routeBar({ who, steps, current, home }) {
  return h('nav', { class: 'route', 'aria-label': who },
    h('a', { class: 'route__home', href: '/', text: home }),
    h('span', { class: 'route__who', text: who }),
    h('ol', { class: 'route__steps' }, steps.map(([label, href], i) => {
      const here = i + 1 === current;
      const inner = h('span', { text: label });
      return h('li', { class: here ? 'route__step is-current' : 'route__step', 'aria-current': here ? 'step' : null },
        here ? h('span', { class: 'route__here' }, inner) : h('a', { href }, inner));
    })));
}

// 書く流れ（残す → 封をする）。日本語のみ。
export const makerRoute = (current) => routeBar({
  who: '書く',
  steps: [['残す', '/keep'], ['封をする', '/seal']],
  current,
  home: '← トップ',
});

// 【】で囲んだ語は行の途中で割らない（お知らせの文に使う）
export function labelText(text) {
  return String(text).split(/(?<=。)/).filter(Boolean).map((sentence) => {
    const parts = sentence.split(/(【[^】]*】)/).filter(Boolean).map((part) => (part.startsWith('【') ? h('span', { class: 'nobr', text: part }) : part));
    return sentence.length <= 20 ? h('span', { class: 'nobr' }, parts) : parts;
  });
}

// 書く側の画面の上：掛け紙だけ（読む側と同じ。日本語だけなので言語の切り替えは置かない）。帯は出さない（2026-11-08 Karen 決定）
export function toolBands() {
  return [
    h('header', { class: 'kakegami kakegami--tool' },
      h('a', { class: 'kakegami__name', href: '/', lang: 'en', text: 'OYASAI ORIGIN' })),
  ];
}

// 巻物：封をした手紙の印（Karen の挿絵・一部 AI ツール使用、CREDITS.md）。
// state は 'closed'（巻いて朱の紐で結んである）か 'open'（ひらいてある）。2枚の絵を重ね、状態で見せる方を替える（ほどける動きは重ね合わせ）
export function makimono(state = 'closed', extra = '') {
  return h('span', { class: `maki maki--${state}${extra}`, 'aria-hidden': 'true' },
    h('img', { class: 'maki__img maki__img--closed', src: '/img/maki-closed.jpg', alt: '', width: '400', height: '545', decoding: 'async' }),
    h('img', { class: 'maki__img maki__img--open', src: '/img/maki-open.jpg', alt: '', width: '650', height: '440', decoding: 'async' }));
}

// 農園の印（仮）：屋号のように、農園名の頭の一字を丸の中に。色は季節で変える。本物の印に差し替えるまでの仮
const SEASON_CLASS = { '春': 'haru', '夏': 'natsu', '秋': 'aki', '冬': 'fuyu' };
export function farmMark(farmer, extra = '') {
  const name = farmer.farm.ja.replace(/（仮）/g, '').trim();
  return h('span', { class: `farm-mark farm-mark--${SEASON_CLASS[farmer.season.ja] ?? 'fuyu'}${extra}`, 'aria-hidden': 'true' },
    h('span', { class: 'farm-mark__char mincho', lang: 'ja', text: [...name][0] ?? '' }));
}

// 動きが本当に進む環境かを、見えない小さな印で一度だけ確かめる。
// 動きを減らす設定・隠れたタブ・アニメーションが止められた環境では false。false のときは最初から全部を見せる。
let probe = null;
export function motionProbe() {
  if (probe) return probe;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden || !Element.prototype.animate) {
    probe = Promise.resolve(false);
    return probe;
  }
  const dot = document.createElement('i');
  dot.setAttribute('aria-hidden', 'true');
  dot.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.append(dot);
  const run = dot.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(1px)' }], { duration: 2000 });
  probe = new Promise((resolve) => {
    setTimeout(() => {
      const moved = (run.currentTime ?? 0) > 0;
      run.cancel();
      dot.remove();
      resolve(moved && !document.hidden);
    }, 90);
  });
  return probe;
}

// アイコンは HTML の中の sprite（<symbol>）を <template> から複製して使う。h() では SVG を作れないため。
export function icon(name) {
  const template = document.getElementById('tpl-icon');
  if (!template) return null;
  const svg = template.content.firstElementChild.cloneNode(true);
  svg.querySelector('use').setAttribute('href', `#i-${name}`);
  return svg;
}

// 動きを始めたあとで止められた（currentTime が進まない）ときは、すぐ最後の見た目にする。
export function releaseIfStalled(els, finish) {
  setTimeout(() => {
    const run = els.flatMap((el) => el.getAnimations?.({ subtree: true }) ?? [])[0]; // 中の字や擬似要素の動きも数える
    if (run && !(run.currentTime > 0)) finish();
  }, 80);
}

