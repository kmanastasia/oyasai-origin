// トップ：だれが来ても同じ入口。することで分けた「読む／書く」の2つの扉だけを置く。
import { h } from './common.js';
import { onLangChange, startReader, t } from './reader.js';

const root = document.getElementById('root');

// 道の印：丸の番号と名前を一組にして、組の途中では折り返さない。
function pathView(steps) {
  return h('ol', { class: 'door__path' }, steps.map(([no, key]) =>
    h('li', { class: 'door__node' },
      h('span', { class: 'door__no', 'aria-hidden': 'true', text: no }),
      h('span', { class: 'door__name', text: t(key) }))));
}

// 扉全体が1つのリンク。前置き・見出し・補足・道・端末と言語を一緒に見せる。
function door({ key, href, primary, steps }) {
  return h('a', { class: primary ? 'door door--primary' : 'door', href },
    h('span', { class: 'door__for', text: t(`top.${key}.for`) }),
    h('span', { class: 'door__title', text: t(`top.${key}.title`) }),
    h('span', { class: 'door__sub', text: t(`top.${key}.sub`) }),
    pathView(steps),
    h('span', { class: 'door__meta', text: t(`top.${key}.meta`) }));
}

// おやさい旅の SNS は行き先が決まるまで、押せない文字と「準備中」だけ。リンクにしない。
function snsView() {
  return h('p', { class: 'top__sns' },
    h('span', { class: 'top__sns-text', text: t('top.sns') }),
    h('span', { class: 'tag-note', text: t('sns.pending') }));
}

function render() {
  document.title = 'OYASAI ORIGIN';
  root.replaceChildren(
    h('h1', { class: 'top__core mincho', text: t('core') }),
    h('p', { class: 'lead-line', text: t('subtitle') }),
    h('p', { class: 'section-eyebrow', text: t('top.ask') }),
    door({ key: 'read', href: '/choose', primary: true, steps: [['3', 'route.choose'], ['4', 'route.letter']] }),
    door({ key: 'write', href: '/keep', steps: [['1', 'route.keep'], ['2', 'route.seal']] }),
    h('p', { class: 'card__small', text: t('top.qr') }),
    snsView());
}

await startReader();
onLangChange(render);
render();
