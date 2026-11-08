// トップ：だれが来ても同じ入口。「畑からのお手紙を読む／書く」の2つの扉だけを置く。
import { h, icon, makimono, motionProbe, releaseIfStalled } from './common.js';
import { getLang, onLangChange, startReader, t } from './reader.js';

const root = document.getElementById('root');
const ENTER_MS = 1900; // 現れ終わる時間より少し長く（土 → 見出しの字 → 扉 → 巻物の順に 1.6 秒）
let entered = false; // 現れる動きは最初の1回だけ。言語を切り替えてもくり返さない
let motion = false;

// 扉全体が1つのリンク。絵・番号・見出し・補足を一緒に見せる。
function door({ key, href, img, alt, no, order, meta }) {
  return h('a', { class: `door door--${key}${enter()}`, style: order, href },
    h('span', { class: 'door__art' },
      h('img', { class: 'door__img', src: img, alt, width: '720', height: '900', decoding: 'async' })),
    h('span', { class: 'door__text' },
      h('span', { class: 'door__no mono', 'aria-hidden': 'true', text: no }),
      h('span', { class: 'door__title', text: t(`top.${key}.title`) }),
      h('span', { class: 'door__sub', text: t(`top.${key}.sub`) }),
      meta ? h('span', { class: 'door__meta', text: t(meta) }) : null,
      h('span', { class: 'door__go', 'aria-hidden': 'true' }, icon('arrow'))));
}

// おやさい旅の SNS：Instagram と TikTok へのリンク。外部リンクはこの1か所だけ（2026-11-07 Karen 決定）。新しいタブでひらく
const SNS_LINKS = [
  ['Instagram', 'https://www.instagram.com/oyasai_tabi/'],
  ['TikTok', 'https://www.tiktok.com/@oyasai_tabi'],
];
function snsView() {
  return h('p', { class: 'top__sns' },
    h('span', { class: 'top__sns-text', text: t('top.sns') }),
    SNS_LINKS.map(([label, href]) => h('a', { class: 'top__sns-link', href, target: '_blank', rel: 'noopener noreferrer', text: label })));
}

// 見出し：日本語は「日本のお野菜を／世界へ。」で意図して改行する（文字は辞書のまま）。
function coreHeading() {
  const text = t('core');
  const at = text.indexOf('を');
  const parts = getLang() === 'ja' && at > 0 ? [text.slice(0, at + 1), h('br'), text.slice(at + 1)] : [text];
  return h('h1', { class: `top__core mincho${enter()}`, style: '--i:0' }, parts.map(glyphs));
}

// 見出しの字をひとつずつ（英語は語ごとに）包む。墨が一字ずつ入る動きのため。文字は変えない
let glyphNo = 0;
function glyphs(part) {
  if (typeof part !== 'string') return part;
  const units = getLang() === 'ja' ? [...part] : part.split(/(\s+)/).filter(Boolean);
  return units.map((unit) => (/^\s+$/.test(unit) ? unit : h('span', { class: 'glyph', style: `--g:${glyphNo++}`, text: unit })));
}

const enter = () => (motion && !entered ? ' appear' : '');

// トップの巻物：ひらく／巻き戻す（見た目だけ。手紙の中身はひらかない）
function toggleMaki(event) {
  const button = event.currentTarget;
  const open = !button.classList.contains('is-open');
  button.classList.toggle('is-open', open);
  button.setAttribute('aria-pressed', String(open));
}

function render() {
  document.title = 'OYASAI ORIGIN';
  glyphNo = 0;
  root.replaceChildren(
    // 左：箱のふた。画面の端まで土の質感、その上に縦組みの見出し。ふたの縁に、封をした巻物（手紙は巻物で届く、の印）
    h('div', { class: 'top__hero' },
      h('div', { class: `top__lid${enter()}` },
        coreHeading(),
        h('p', { class: `lead-line${enter()}`, style: '--i:1', text: t('subtitle') })),
      // 巻物は押すとひらき（もう一度押すと巻き戻る）、ホバーで少し傾く。行き先は変えない
      h('button', { class: `top__maki${enter()}`, type: 'button', 'aria-label': t('letter.open'), 'aria-pressed': 'false', onclick: toggleMaki },
        makimono('closed', ' maki--on-dark'))),
    // 右：扉と足もと
    h('div', { class: 'top__body' },
      // 使い方（大事な説明なので扉の上に）。印は Karen の絵ができたら差し替える
      h('p', { class: `top__how${enter()}`, style: '--i:1' },
        h('span', { class: 'top__how-icon', 'aria-hidden': 'true' }, icon('camera')),
        h('span', { class: 'top__how-text', text: t('top.qr') })),
      h('div', { class: 'top__doors' },
        door({ key: 'read', href: '/choose', img: '/img/oyasai-tabi.jpg', alt: '', no: '01', order: '--i:2' }),
        door({ key: 'write', href: '/keep', img: '/img/nouka.jpg', alt: '', no: '02', order: '--i:3', meta: 'top.write.meta' })),
      h('div', { class: 'top__foot' }, snsView())));
  if (motion && !entered) {
    entered = true;
    const moving = [...root.querySelectorAll('.appear')];
    const finish = () => moving.forEach((el) => el.classList.remove('appear'));
    setTimeout(finish, ENTER_MS); // 動きが止まっても、見出しと扉を隠したままにしない
    releaseIfStalled(moving, finish);
    document.addEventListener('visibilitychange', finish, { once: true });
  }
}

// ふたの土が指の動きにわずかに寄る（パソコン・ポインタがあるときだけ。transform だけ。動きを減らす設定では動かない）。字は動かさない
function soilParallax() {
  if (!motion || !matchMedia('(hover: hover) and (min-width: 1024px)').matches) return;
  let raf = 0;
  root.addEventListener('pointermove', (event) => {
    const lid = root.querySelector('.top__lid');
    if (!lid || raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const box = lid.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, ((event.clientX - box.left) / box.width - 0.5) * 2));
      const y = Math.max(-1, Math.min(1, ((event.clientY - box.top) / box.height - 0.5) * 2));
      lid.style.setProperty('--px', x.toFixed(3));
      lid.style.setProperty('--py', y.toFixed(3));
    });
  }, { passive: true });
}

// 最初の描画は待たない。動くかどうかはその場で決め、止まっていたら releaseIfStalled が外す。
motionProbe(); // 言語の切り替えのために、裏で確かめておく
await startReader();
motion = !matchMedia('(prefers-reduced-motion: reduce)').matches && !document.hidden;
onLangChange(render);
render();
soilParallax();
