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

// 写真を選ぶボタンと結果の行。onFound(farmer) が無ければ、そのまま手紙へ移る
export function scanView({ onFound } = {}) {
  const pair = (value) => (getLang() === 'en' ? value.en : value.ja);
  const status = h('p', { class: 'scan__status', role: 'status' });
  const input = h('input', { class: 'scan__input', type: 'file', accept: 'image/*', 'aria-hidden': 'true', tabindex: '-1' });
  const button = h('button', { class: 'btn btn--ghost btn--icon scan__btn', type: 'button', onclick: () => input.click() }, icon('camera'), h('span', { text: t('scan.button') }));
  input.addEventListener('change', async () => {
    const [file] = input.files ?? [];
    input.value = '';
    if (!file) return;
    button.disabled = true;
    status.textContent = t('scan.reading');
    status.className = 'scan__status';
    try {
      const { farmer, read } = await api('identify', await shrink(file));
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
  });
  return h('div', { class: 'scan' }, button, input, status);
}
