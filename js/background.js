/* ───────── Background image: load, clear, rotate, save/restore ─────────
   bgImgWrap holds the loaded image; when none is present the solid theme
   colour (--canvas-bg) shows through. */

const bgImgWrap = document.getElementById('bg-img-wrap');

let bgRotation = 0;
let bgNaturalW = 0;
let bgNaturalH = 0;

function initBackground() {
  // Start with no custom background; the solid theme colour shows through.
  bgRotation = 0;
  bgNaturalW = 0;
  bgNaturalH = 0;
}

function loadBG(e) {
  const file = e.target.files[0]; if (!file) return;
  const url = URL.createObjectURL(file);
  bgImgWrap.innerHTML = '';
  const img = document.createElement('img');
  img.onload = () => {
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
  // Keep the drawing layer linked to the background: size/position it to cover the
  // image's displayed box so the whole map is drawable.
  if (typeof updateDrawingGeometryForBackground === 'function') {
    updateDrawingGeometryForBackground(boxW, boxH);
  }
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
  bgRotation = 0;
  bgNaturalW = 0;
  bgNaturalH = 0;
  // No background → drawing layer reverts to the default origin-centred window.
  if (typeof updateDrawingGeometryForBackground === 'function') {
    updateDrawingGeometryForBackground(0, 0);
  }
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
    bgNaturalW = img.naturalWidth;
    bgNaturalH = img.naturalHeight;
    bgRotation = Number(bg.rotation) || 0;
    applyBgTransform();
  };
  img.onerror = () => { bgImgWrap.innerHTML = ''; };
  img.src = bg.image;
  bgImgWrap.appendChild(img);
}
