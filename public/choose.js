// 作り手の一覧：10軒を名刺のように並べる。都道府県と品目で絞り込める。手紙がある作り手は巻物の印、ひらいた手紙はひらいた巻物。
import { api, farmMark, h, icon, makimono } from './common.js';
import { getLang, hasStrings, onLangChange, openedLetters, startReader, t } from './reader.js';
import { scanView } from './scan.js';

const root = document.getElementById('root');
let farmers = [];
let failed = false;
// 絞り込み（URL の ?pref=&item= に持つ。戻っても同じ絞り込みのまま）
const params = new URLSearchParams(location.search);
let pref = params.get('pref') ?? '';
let item = params.get('item') ?? '';

const pair = (value) => (getLang() === 'en' ? value.en : value.ja);
const letterCount = (farmer) => (farmer.letters ?? []).length;
const hasOpened = (farmer) => farmer.letter && openedLetters().includes(farmer.letter);

function setFilter(next) {
  pref = next.pref ?? pref;
  item = next.item ?? item;
  const url = new URL(location.href);
  for (const [key, value] of [['pref', pref], ['item', item]]) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  history.replaceState(null, '', url);
  render();
  root.querySelector('.makers')?.focus({ preventScroll: true });
}

const visible = () => farmers.filter((f) => (!pref || f.region.ja === pref) && (!item || f.items.some((i) => i.ja === item)));

// 絞り込みの札：都道府県・品目。押すと一覧が入れ替わる（日本語の値で突き合わせ、表示は言語に合わせる）
function chipRow(key, label, values, current) {
  const chip = (value, text) => h('button', {
    class: `chip${current === value ? ' is-on' : ''}`,
    type: 'button',
    'aria-pressed': String(current === value),
    onclick: () => setFilter({ [key]: current === value ? '' : value }),
    text,
  });
  return h('div', { class: 'filter', role: 'group', 'aria-label': label },
    h('span', { class: 'filter__label mono', text: label }),
    h('div', { class: 'filter__chips' }, chip('', t('farmers.all')), values.map(([ja, en]) => chip(ja, getLang() === 'en' ? en : ja))));
}

function filtersView() {
  const prefs = [...new Map(farmers.map((f) => [f.region.ja, f.region.en])).entries()];
  const items = [...new Map(farmers.flatMap((f) => f.items.map((i) => [i.ja, i.en]))).entries()];
  return h('div', { class: 'filters' },
    chipRow('pref', t('farmers.filter.pref'), prefs, pref),
    chipRow('item', t('farmers.filter.item'), items, item));
}

function farmerCard(farmer) {
  const opened = hasOpened(farmer);
  const count = letterCount(farmer);
  const state = farmer.letter ? (opened ? 'opened' : 'sealed') : count > 0 ? 'coming' : 'none';
  return h('li', { class: `maker maker--${state}` },
    h('a', { class: 'maker__link', href: `/farmer?id=${encodeURIComponent(farmer.id)}` },
      h('span', { class: 'maker__mark' }, farmMark(farmer)),
      h('span', { class: 'maker__text' },
        h('span', { class: 'mono maker__no', text: farmer.no }),
        h('span', { class: 'maker__farm mincho', text: pair(farmer.farm) }),
        h('span', { class: 'maker__line', text: `${pair(farmer.region)}｜${farmer.items.map(pair).join('・')}｜${pair(farmer.season)}` }),
        h('span', { class: 'maker__row' },
          h('span', { class: `maker__state maker__state--${state}`, text: count > 0 ? t('farmers.letters', { n: count }) : t('farmers.none') }),
          state === 'coming' ? h('span', { class: 'maker__coming', text: t('farmers.coming') }) : null,
          farmer.letter ? makimono(opened ? 'open' : 'closed', ' maki--tiny') : null)),
      // お店・SNS の印：押せない・リンクなし（行き先が決まるまで「準備中」）
      h('span', { class: 'maker__links', title: t('farmers.links') },
        h('span', { class: 'maker__link-mark' }, icon('shop')),
        h('span', { class: 'maker__link-mark' }, icon('at')),
        h('span', { class: 'visually-hidden', text: t('farmers.links') })),
      h('span', { class: 'maker__go', 'aria-hidden': 'true' }, icon('arrow'))));
}

function render() {
  document.title = `${t('farmers.heading')}｜OYASAI ORIGIN`;
  const total = farmers.filter((f) => f.letter).length;
  const opened = farmers.filter(hasOpened).length;
  const head = [
    h('p', { class: 'lead-line', text: t('subtitle') }),
    h('h1', { class: 'section-eyebrow', text: t('farmers.heading') }),
  ];
  if (failed) {
    root.replaceChildren(...head, h('p', { class: 'state', role: 'alert', text: t('farmers.error') }));
    return;
  }
  const shown = visible();
  root.replaceChildren(...[...head,
    h('div', { class: 'makers__head' },
      h('p', { class: 'makers__lead', text: t('farmers.lead') }),
      total ? h('p', { class: 'makers__count mono', text: t('farmers.count', { n: opened, total }) }) : null),
    h('div', { class: 'scan-box' }, scanView(), h('p', { class: 'scan__hint', text: t('scan.hint') })),
    farmers.length ? filtersView() : null,
    h('ol', { class: 'makers', tabindex: '-1', 'aria-live': 'polite' }, shown.map(farmerCard)),
    farmers.length && !shown.length ? h('p', { class: 'state', text: t('farmers.noMatch') }) : null].filter(Boolean));
}

const ready = startReader({ route: 1 });
if (hasStrings()) render();
const [, data] = await Promise.all([ready, api('farmers').catch(() => null)]);
onLangChange(render);
if (data) farmers = data.farmers;
else failed = true;
render();
