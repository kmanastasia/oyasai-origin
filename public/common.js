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

export function toolBands(extra) {
  return [
    h('div', { class: 'band', role: 'note', text: '【架空】の農家・デモ' }),
    extra ? h('div', { class: 'band band--sub', role: 'note', text: extra }) : null,
  ];
}
