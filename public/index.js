// トップ：だれが来ても同じ入口。することで分けた「読む／書く」の2つの扉だけを置く。
import { h, icon, motionProbe, releaseIfStalled } from './common.js';
import { getLang, onLangChange, sealStamp, startReader, t } from './reader.js';

const root = document.getElementById('root');
const ENTER_MS = 1900; // 現れ終わる時間より少し長く（土 → 見出しの字 → 扉 → 封の順に 1.6 秒）
let entered = false; // 現れる動きは最初の1回だけ。言語を切り替えてもくり返さない
let motion = false;

// 道の印：丸の番号と名前を一組にして、組の途中では折り返さない。
function pathView(steps) {
  return h('ol', { class: 'door__path' }, steps.map(([no, key]) =>
    h('li', { class: 'door__node' },
      h('span', { class: 'door__no', 'aria-hidden': 'true', text: no }),
      h('span', { class: 'door__name', text: t(key) }))));
}

// 扉の見出し：行の長さをそろえて組む（矢印は扉の右の丸に置く）。
const doorTitle = (text) => h('span', { class: 'door__title', text });

// 扉全体が1つのリンク。前置き・見出し・補足・道・端末と言語を一緒に見せる。
function door({ key, href, primary, steps, order }) {
  return h('a', { class: `${primary ? 'door door--primary' : 'door'}${enter()}`, style: order, href },
    h('span', { class: 'door__for', text: t(`top.${key}.for`) }),
    doorTitle(t(`top.${key}.title`)),
    h('span', { class: 'door__sub', text: t(`top.${key}.sub`) }),
    pathView(steps),
    h('span', { class: 'door__meta', text: t(`top.${key}.meta`) }),
    // 個包装の掛け紙（飾り）と、押す先を示す丸い矢印
    primary ? h('span', { class: 'door__wrap', 'aria-hidden': 'true' }) : null,
    h('span', { class: 'door__go', 'aria-hidden': 'true' }, icon('arrow')));
}

// おやさい旅の SNS は行き先が決まるまで、押せない文字と「準備中」だけ。リンクにしない。
function snsView() {
  return h('p', { class: 'top__sns' },
    h('span', { class: 'top__sns-text', text: t('top.sns') }),
    h('span', { class: 'tag-status', text: t('sns.pending') }));
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

function render() {
  document.title = 'OYASAI ORIGIN';
  glyphNo = 0;
  root.replaceChildren(
    // 左：箱のふた。画面の端まで土の質感、その上に縦組みの見出し。ふたの縁に大きな朱の封（この手紙は封をして届く、の印）。
    // 写真の注記はふたの下の縁に、生成りの帯で必ず見せる
    h('div', { class: 'top__hero' },
      h('div', { class: `top__lid${enter()}` },
        coreHeading(),
        h('p', { class: `lead-line${enter()}`, style: '--i:1', text: t('subtitle') })),
      h('p', { class: 'photo__cap top__cap', text: t('photo.caption') }),
      sealStamp(` top__seal${enter()}`)),
    // 右：扉と足もと
    h('div', { class: 'top__body' },
      h('p', { class: `section-eyebrow${enter()}`, style: '--i:2', text: t('top.ask') }),
      h('div', { class: 'top__doors' },
        door({ key: 'read', href: '/choose', primary: true, steps: [['3', 'route.choose'], ['4', 'route.letter']], order: '--i:3' }),
        door({ key: 'write', href: '/keep', steps: [['1', 'route.keep'], ['2', 'route.seal']], order: '--i:4' })),
      h('div', { class: 'top__foot' },
        h('p', { class: 'card__small top__qr', text: t('top.qr') }),
        snsView())));
  if (motion && !entered) {
    entered = true;
    const moving = [...root.querySelectorAll('.appear')];
    const finish = () => moving.forEach((el) => el.classList.remove('appear'));
    setTimeout(finish, ENTER_MS); // 動きが止まっても、見出しと扉を隠したままにしない
    releaseIfStalled(moving, finish);
    document.addEventListener('visibilitychange', finish, { once: true });
  }
}

// ふたの土が指の動きにわずかに寄る（パソコン・ポインタがあるときだけ。transform だけ。動きを減らす設定では動かない）。字と注記は動かさない
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

// 最初の描画は待たない（ラベルを帯と同じ時に出す）。動くかどうかはその場で決め、止まっていたら releaseIfStalled が外す。
motionProbe(); // 言語の切り替えのために、裏で確かめておく
await startReader();
motion = !matchMedia('(prefers-reduced-motion: reduce)').matches && !document.hidden;
onLangChange(render);
render();
soilParallax();
