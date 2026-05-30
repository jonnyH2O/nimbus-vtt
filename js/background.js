/* ───────── Background image: load, clear, rotate, save/restore ─────────
   bgImgWrap holds the loaded image; bgGrid is the default checkerboard
   pattern that is hidden whenever a custom background is present. */

const bgImgWrap = document.getElementById('bg-img-wrap');
const bgGrid    = document.getElementById('bg-grid');

let bgRotation = 0;
let bgNaturalW = 0;
let bgNaturalH = 0;

function loadBG(e) {
  const file = e.target.files[0]; if (!file) return;
  const url = URL.createObjectURL(file);
  bgImgWrap.innerHTML = '';
  const img = document.createElement('img');
  img.onload = () => {
    bgGrid.classList.add('hidden');
    bgNaturalW = img.naturalWidth;
    bgNaturalH = img.naturalHeight;
    bgRotation = 0;
    applyBgTransform();
    fitToView(bgNaturalW, bgNaturalH);
  };
  img.src = url;
  bgImgWrap.appendChild(img);
  e.target.value = '';
}

function applyBgTransform() {
  const img = bgImgWrap.querySelector('img');
  if (!img) return;
  const r = ((bgRotation % 360) + 360) % 360;
  const swap = r === 90 || r === 270;
  const boxW = swap ? bgNaturalH : bgNaturalW;
  const boxH = swap ? bgNaturalW : bgNaturalH;
  bgImgWrap.style.width  = boxW + 'px';
  bgImgWrap.style.height = boxH + 'px';
  img.style.position = 'absolute';
  img.style.left = ((boxW - bgNaturalW) / 2) + 'px';
  img.style.top  = ((boxH - bgNaturalH) / 2) + 'px';
  img.style.transformOrigin = 'center';
  img.style.transform = `rotate(${r}deg)`;
}

function rotateBG() {
  if (!bgImgWrap.querySelector('img')) return;
  bgRotation = (bgRotation + 90) % 360;
  applyBgTransform();
}

function clearBG() {
  bgImgWrap.innerHTML = '';
  bgImgWrap.style.width = '';
  bgImgWrap.style.height = '';
  bgGrid.classList.remove('hidden');
  bgRotation = 0;
  bgNaturalW = 0;
  bgNaturalH = 0;
}

async function captureBackgroundState() {
  const img = bgImgWrap.querySelector('img');
  if (!img) return { image: null };
  try {
    const response = await fetch(img.src);
    const blob = await response.blob();
    const dataURL = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return {
      image: dataURL,
      rotation: bgRotation,
      naturalWidth: bgNaturalW,
      naturalHeight: bgNaturalH
    };
  } catch (_) {
    return { image: null };
  }
}

/* Used by restoreBoard. Accepts the `background` object from a save file. */
function restoreBackgroundFromState(bg) {
  if (!bg || typeof bg.image !== 'string' || !bg.image.startsWith('data:')) return;
  bgImgWrap.innerHTML = '';
  const img = document.createElement('img');
  img.onload = () => {
    bgGrid.classList.add('hidden');
    bgNaturalW = img.naturalWidth;
    bgNaturalH = img.naturalHeight;
    bgRotation = Number(bg.rotation) || 0;
    applyBgTransform();
  };
  img.onerror = () => { bgImgWrap.innerHTML = ''; };
  img.src = bg.image;
  bgImgWrap.appendChild(img);
}
