// 作り手の一覧：10軒を名刺のように並べる。手紙がある作り手は巻物の印、ひらいた手紙はひらいた巻物。
import { api, h, icon, makimono } from './common.js';
import { getLang, hasStrings, onLangChange, openedLetters, startReader, t } from './reader.js';
import { scanView } from './scan.js';

const root = document.getElementById('root');
let farmers = [];
let failed = false;

const pair = (value) => (getLang() === 'en' ? value.en : value.ja);

function farmerCard(farmer) {
  const opened = farmer.letter && openedLetters().includes(farmer.letter);
  const state = !farmer.letter ? 'none' : opened ? 'opened' : 'sealed';
  return h('li', { class: `maker maker--${state}` },
    h('a', { class: 'maker__link', href: `/farmer?id=${encodeURIComponent(farmer.id)}` },
      h('span', { class: 'maker__mark' }, farmer.letter ? makimono(opened ? 'open' : 'closed', ' maki--small') : h('span', { class: 'maker__dash', 'aria-hidden': 'true' })),
      h('span', { class: 'maker__text' },
        h('span', { class: 'mono maker__no', text: farmer.no }),
        h('span', { class: 'maker__farm mincho', text: pair(farmer.farm) }),
        h('span', { class: 'maker__line', text: `${pair(farmer.region)}｜${farmer.items.map(pair).join('・')}｜${pair(farmer.season)}` }),
        h('span', { class: `maker__state maker__state--${state}`, text: t(`farmers.${state}`) })),
      // お店・SNS の印：押せない・リンクなし（行き先が決まるまで「準備中」）
      h('span', { class: 'maker__links', title: t('farmers.links') },
        h('span', { class: 'maker__link-mark' }, icon('shop')),
        h('span', { class: 'maker__link-mark' }, icon('at')),
        h('span', { class: 'visually-hidden', text: t('farmers.links') })),
      h('span', { class: 'maker__go', 'aria-hidden': 'true' }, icon('arrow'))));
}

function render() {
  document.title = `${t('farmers.heading')}｜OYASAI ORIGIN`;
  const total = farmers.length;
  const opened = farmers.filter((f) => f.letter && openedLetters().includes(f.letter)).length;
  const head = [
    h('p', { class: 'lead-line', text: t('subtitle') }),
    h('h1', { class: 'section-eyebrow', text: t('farmers.heading') }),
  ];
  if (failed) {
    root.replaceChildren(...head, h('p', { class: 'state', role: 'alert', text: t('farmers.error') }));
    return;
  }
  root.replaceChildren(...head,
    h('div', { class: 'makers__head' },
      h('p', { class: 'makers__lead', text: t('farmers.lead') }),
      total ? h('p', { class: 'makers__count mono', text: t('farmers.count', { n: opened, total }) }) : null),
    h('div', { class: 'scan-box' }, scanView(), h('p', { class: 'scan__hint', text: t('scan.hint') })),
    h('ol', { class: 'makers' }, farmers.map(farmerCard)));
}

const ready = startReader({ route: 1 });
if (hasStrings()) render();
const [, data] = await Promise.all([ready, api('farmers').catch(() => null)]);
onLangChange(render);
if (data) farmers = data.farmers;
else failed = true;
render();
