// お野菜の写真を選ぶと、Claude が袋や札の農家名・品目を読み、その作り手の手紙をひらく。
// カメラは直接使わない（写真を選ぶ欄だけ）。写真は縮めてから送り、サーバーにも残さない。
import { api, h, icon } from './common.js';
import { getLang, t, unlockLetter } from './reader.js';

const MAX_SIDE = 1200; // 送る写真の長い辺（文字が読める大きさのまま、軽くする）

// 選んだ写真を canvas で縮め、JPEG の base64 にする
async function shrink(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
  return { image: dataUrl.slice(dataUrl.indexOf(',') + 1), media_type: 'image/jpeg' };
}

// 見本の写真：札（みなみ農園・にんじん）をその場で描く。画像ファイルは持たない（文字は辞書の見本の値）
// 鍵があれば Claude がこの絵を本当に読む。鍵がなければサーバーが「見本」と受け取って、みなみ農園につなぐ
function drawSample() {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 600;
  const g = canvas.getContext('2d');
  g.fillStyle = '#efe6d3';
  g.fillRect(0, 0, 900, 600);
  g.strokeStyle = '#3a3128';
  g.lineWidth = 6;
  g.strokeRect(60, 60, 780, 480);
  g.fillStyle = '#1f1a14';
  g.font = '500 44px "Zen Kaku Gothic New", "Hiragino Sans", sans-serif';
  g.fillText('畑からのお手紙', 110, 150);
  g.font = '700 86px "Shippori Mincho B1", "Hiragino Mincho ProN", serif';
  g.fillText('みなみ農園', 110, 300);
  g.font = '500 70px "Shippori Mincho B1", "Hiragino Mincho ProN", serif';
  g.fillText('にんじん', 110, 420);
  g.font = '400 36px "DM Mono", monospace';
  g.fillText('No.001', 110, 500);
  return canvas;
}

// 写真を選ぶボタン・見本の写真のボタンと結果の行。onFound(farmer) が無ければ、そのまま手紙へ移る
export function scanView({ onFound } = {}) {
  const pair = (value) => (getLang() === 'en' ? value.en : value.ja);
  const status = h('p', { class: 'scan__status', role: 'status' });
  const input = h('input', { class: 'scan__input', type: 'file', accept: 'image/*', 'aria-hidden': 'true', tabindex: '-1' });
  const button = h('button', { class: 'btn btn--ghost btn--icon scan__btn', type: 'button', onclick: () => input.click() }, icon('camera'), h('span', { text: t('scan.button') }));
  const sample = h('button', { class: 'btn btn--ghost btn--small scan__sample', type: 'button', text: t('scan.sample') });
  const preview = h('div', { class: 'scan__preview' });
  async function read(payload) {
    button.disabled = true;
    sample.disabled = true;
    status.textContent = t('scan.reading');
    status.className = 'scan__status';
    try {
      const { farmer, read } = await api('identify', payload);
      if (!farmer) {
        status.textContent = t('scan.fail');
        status.className = 'scan__status is-fail';
      } else if (!farmer.letter) {
        status.textContent = t('scan.noletter', { farm: pair(farmer.farm) });
        status.className = 'scan__status is-fail';
      } else {
        unlockLetter(farmer.letter);
        status.textContent = t('scan.found', { farm: pair(farmer.farm), item: read.item_text ?? farmer.items.map(pair).join('・') });
        status.className = 'scan__status is-ok';
        if (onFound) onFound(farmer);
        else location.assign(`/letter?no=${encodeURIComponent(farmer.letter)}`);
      }
    } catch (error) {
      status.replaceChildren(h('span', { text: error.message }), ' ', h('span', { class: 'scan__next', text: error.next ?? '' }));
      status.className = 'scan__status is-fail';
    }
    button.disabled = false;
    sample.disabled = false;
  }
  input.addEventListener('change', async () => {
    const [file] = input.files ?? [];
    input.value = '';
    if (!file) return;
    preview.replaceChildren();
    await read(await shrink(file));
  });
  sample.addEventListener('click', async () => {
    await document.fonts?.ready;
    const canvas = drawSample();
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const img = h('img', { class: 'scan__img', src: dataUrl, alt: t('scan.sampleAlt'), width: '900', height: '600' });
    preview.replaceChildren(img);
    await read({ image: dataUrl.slice(dataUrl.indexOf(',') + 1), media_type: 'image/jpeg', sample: true });
  });
  return h('div', { class: 'scan' }, h('div', { class: 'scan__buttons' }, button, sample), input, preview, status);
}
