// トップ：だれが来ても同じ入口。受け取った方と作り手の方の2つの扉だけを置く。
import { h } from './common.js';
import { onLangChange, startReader, t } from './reader.js';

const root = document.getElementById('root');

// 扉は「〜の方へ」で始め、何ができるかと、この先の画面の順を一緒に見せる。
function door({ key, href, primary }) {
  return h('a', { class: primary ? 'door door--primary' : 'door', href },
    h('span', { class: 'door__for', text: t(`top.${key}.for`) }),
    h('span', { class: 'door__title', text: t(`top.${key}.title`) }),
    h('span', { class: 'door__steps', text: t(`top.${key}.steps`) }));
}

function render() {
  document.title = 'OYASAI ORIGIN';
  root.replaceChildren(
    h('h1', { class: 'top__core mincho', text: t('core') }),
    h('p', { class: 'lead-line', text: t('subtitle') }),
    h('p', { class: 'section-eyebrow', text: t('top.ask') }),
    door({ key: 'reader', href: '/choose', primary: true }),
    door({ key: 'maker', href: '/keep' }),
    h('p', { class: 'card__small', text: t('top.qr') }));
}

await startReader();
onLangChange(render);
render();
