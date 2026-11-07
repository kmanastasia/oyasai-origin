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

// どの画面でも「だれの流れの、いま何番目か」と、トップへ戻る道を出す。
// steps は [番号, 呼び名, 行き先] の並び。current は 1 から数える（0 ならどれも今ではない）。
export function routeBar({ who, steps, current, home }) {
  return h('nav', { class: 'route', 'aria-label': who },
    h('a', { class: 'route__home', href: '/', text: home }),
    h('span', { class: 'route__who', text: who }),
    h('ol', { class: 'route__steps' }, steps.map(([no, label, href], i) => {
      const here = i + 1 === current;
      return h('li', { class: here ? 'route__step is-current' : 'route__step', 'aria-current': here ? 'step' : null },
        here ? h('span', { text: `${no} ${label}` }) : h('a', { href, text: `${no} ${label}` }));
    })));
}

// 書く流れ（①残す → ②封をする）。①②は日本語のみ。
export const makerRoute = (current) => routeBar({
  who: '書く',
  steps: [['①', '残す', '/keep'], ['②', '封をする', '/seal']],
  current,
  home: '← トップ',
});

export function toolBands(extra) {
  return [
    h('div', { class: 'band', role: 'note', text: '【架空】の農家・デモ' }),
    extra ? h('div', { class: 'band band--sub', role: 'note', text: extra }) : null,
  ];
}
