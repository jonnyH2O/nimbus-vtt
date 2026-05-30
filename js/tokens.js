const tokenLayer = document.getElementById('token-layer');
const ctxMenu    = document.getElementById('ctx-menu');
const hint       = document.getElementById('hint');

let tokens = {};
let nextId = 1;
let selectedId = null;
let ctxTarget = null;

/* ───────── Default token image (used by + Place Token) ───────── */

let currentTokenImage = null;

function setCurrentTokenImage(dataURL) {
  currentTokenImage = dataURL;
  updateUploadButtonLabel();
}
function clearCurrentTokenImage() {
  currentTokenImage = null;
  updateUploadButtonLabel();
}
function updateUploadButtonLabel() {
  const btn = document.getElementById('btn-upload-pic');
  if (btn) btn.textContent = currentTokenImage ? 'Change Picture' : 'Upload Picture';
}

/* ───────── Token spawn / drag / resize ───────── */

function addToken() {
  const name  = document.getElementById('name-input').value.trim() || 'Token';
  const color = document.getElementById('token-color').value;
  const wrap  = document.getElementById('canvas-wrap');
  const center = screenToWorld(wrap.clientWidth / 2, wrap.clientHeight / 2);
  const x = center.x + (Math.random() - 0.5) * 140;
  const y = center.y + (Math.random() - 0.5) * 100;
  spawnToken({ id: nextId++, name, color, image: currentTokenImage, x, y, size: 54 });
  hint.style.display = 'none';
}

function spawnToken(data) {
  const { id, name, color, image, x, y, size } = data;
  tokens[id] = { ...data };

  const el = document.createElement('div');
  el.className = 'token';
  el.dataset.id = id;
  el.style.left = x + 'px';
  el.style.top  = y + 'px';

  const ring = document.createElement('div');
  ring.className = 'token-ring';
  ring.style.width  = size + 'px';
  ring.style.height = size + 'px';
  ring.style.backgroundColor = color;
  if (image) {
    ring.style.backgroundImage    = `url("${image}")`;
    ring.style.backgroundSize     = 'cover';
    ring.style.backgroundPosition = 'center';
  }

  const label = document.createElement('div');
  label.className = 'token-label';
  label.textContent = name;

  const handle = document.createElement('div');
  handle.className = 'resize-handle';
  handle.title = 'Drag to resize';

  const badge = document.createElement('div');
  badge.className = 'token-badge';

  el.appendChild(ring);
  el.appendChild(label);
  el.appendChild(handle);
  el.appendChild(badge);
  tokenLayer.appendChild(el);

  makeDraggable(el, id);
  makeResizable(handle, el, id);

  el.addEventListener('click', e => { e.stopPropagation(); select(id); });
  el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); showCtx(e, id); });
}

function select(id) {
  document.querySelectorAll('.token').forEach(t => t.classList.remove('selected'));
  selectedId = id;
  if (id != null) {
    const el = tokenLayer.querySelector(`[data-id="${id}"]`);
    if (el) { el.classList.add('selected'); el.style.zIndex = Date.now(); }
  }
}

function makeDraggable(el, id) {
  let ox = 0, oy = 0, dragging = false;
  let dragOriginCell = null;
  let lastHoverKey = '';

  el.addEventListener('pointerdown', e => {
    if (e.target.classList.contains('resize-handle')) return;
    e.preventDefault();
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    const w = screenToWorld(e.clientX, e.clientY);
    ox = w.x - tokens[id].x;
    oy = w.y - tokens[id].y;
    dragging = true;
    select(id);

    if (snapToGrid && gridCellSize) {
      dragOriginCell = worldToCell(tokens[id].x, tokens[id].y);
      lastHoverKey = '';
      el.classList.add('dragging');
      const badge = el.querySelector('.token-badge');
      if (badge) badge.textContent = '0 spaces';
    }
  });

  el.addEventListener('pointermove', e => {
    if (!dragging) return;
    const w = screenToWorld(e.clientX, e.clientY);
    const x = w.x - ox;
    const y = w.y - oy;
    tokens[id].x = x;
    tokens[id].y = y;
    el.style.left = x + 'px';
    el.style.top  = y + 'px';

    if (dragOriginCell) {
      const target = worldToCell(x, y);
      const k = target.x + ',' + target.y;
      if (k !== lastHoverKey) {
        lastHoverKey = k;
        const badge = el.querySelector('.token-badge');
        const result = findPath(dragOriginCell, target);
        if (result) {
          showPath(result.cells);
          if (badge) badge.textContent = result.cost + (result.cost === 1 ? ' space' : ' spaces');
        } else {
          clearPath();
          if (badge) badge.textContent = 'blocked';
        }
      }
    }
  });

  const endDrag = () => {
    if (dragging && snapToGrid && gridCellSize) {
      const snapped = snapPoint(tokens[id].x, tokens[id].y);
      tokens[id].x = snapped.x;
      tokens[id].y = snapped.y;
      el.style.left = snapped.x + 'px';
      el.style.top  = snapped.y + 'px';
    }
    dragging = false;
    dragOriginCell = null;
    el.classList.remove('dragging');
    clearPath();
  };
  el.addEventListener('pointerup',     endDrag);
  el.addEventListener('pointercancel', endDrag);
}

function makeResizable(handle, el, id) {
  let startX, startSize, active = false;

  handle.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    startX    = e.clientX;
    startSize = tokens[id].size;
    active    = true;
  });

  handle.addEventListener('pointermove', e => {
    if (!active) return;
    const delta = (e.clientX - startX) / view.zoom;
    const newSize = Math.max(28, Math.min(130, startSize + delta));
    tokens[id].size = newSize;
    const ring = el.querySelector('.token-ring');
    ring.style.width  = newSize + 'px';
    ring.style.height = newSize + 'px';
  });

  handle.addEventListener('pointerup',    () => { active = false; });
  handle.addEventListener('pointercancel',() => { active = false; });
}

/* ───────── Token context menu ───────── */

function showCtx(e, id) {
  if (typeof hideBgCtx === 'function') hideBgCtx();
  select(id);
  ctxTarget = id;
  ctxMenu.style.display = 'block';
  ctxMenu.style.left = Math.min(e.clientX, window.innerWidth  - 200) + 'px';
  ctxMenu.style.top  = Math.min(e.clientY, window.innerHeight - 160) + 'px';
}
function hideCtx() { ctxMenu.style.display = 'none'; }

function ctxRename() {
  hideCtx();
  if (ctxTarget == null) return;
  const n = prompt('New name:', tokens[ctxTarget].name);
  if (n === null) return;
  tokens[ctxTarget].name = n;
  const el = tokenLayer.querySelector(`[data-id="${ctxTarget}"]`);
  if (el) el.querySelector('.token-label').textContent = n;
}

function ctxRecolor() {
  hideCtx();
  if (ctxTarget == null) return;
  const inp = document.createElement('input');
  inp.type = 'color'; inp.value = tokens[ctxTarget].color;
  inp.style.display = 'none'; document.body.appendChild(inp);
  inp.click();
  inp.addEventListener('change', () => {
    tokens[ctxTarget].color = inp.value;
    const el = tokenLayer.querySelector(`[data-id="${ctxTarget}"]`);
    if (el) el.querySelector('.token-ring').style.backgroundColor = inp.value;
  });
  inp.addEventListener('blur', () => { try { document.body.removeChild(inp); } catch(e) {} });
}

function ctxChangePicture() {
  hideCtx();
  if (ctxTarget == null) return;
  uploadPicFor(ctxTarget);
}

function ctxDelete() {
  hideCtx();
  if (ctxTarget == null) return;
  const el = tokenLayer.querySelector(`[data-id="${ctxTarget}"]`);
  if (el) el.remove();
  delete tokens[ctxTarget];
  ctxTarget = null; selectedId = null;
  if (Object.keys(tokens).length === 0) hint.style.display = '';
}

function clearAll() {
  if (!confirm('Remove all tokens?')) return;
  tokenLayer.innerHTML = '';
  tokens = {}; selectedId = null;
  hint.style.display = '';
}

/* ───────── Picture upload + apply ───────── */

let pendingPicTokenId = null; // null = set default for new tokens

function uploadPicForDefault() {
  pendingPicTokenId = null;
  const input = document.getElementById('token-pic-input');
  input.value = '';
  input.click();
}
function uploadPicFor(tokenId) {
  pendingPicTokenId = tokenId;
  const input = document.getElementById('token-pic-input');
  input.value = '';
  input.click();
}

function handleTokenPicUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const targetId = pendingPicTokenId;
  pendingPicTokenId = null;
  openCropModal(url, dataURL => {
    URL.revokeObjectURL(url);
    if (!dataURL) return;
    if (targetId === null) {
      setCurrentTokenImage(dataURL);
    } else {
      applyImageToToken(targetId, dataURL);
    }
  });
  e.target.value = '';
}

function applyImageToToken(id, dataURL) {
  if (!tokens[id]) return;
  tokens[id].image = dataURL;
  const el = tokenLayer.querySelector(`[data-id="${id}"]`);
  if (!el) return;
  const ring = el.querySelector('.token-ring');
  ring.style.backgroundImage    = `url("${dataURL}")`;
  ring.style.backgroundSize     = 'cover';
  ring.style.backgroundPosition = 'center';
}

/* ───────── Crop modal ───────── */

const CROP_SIZE = 400;     // displayed crop area (px)
const CROP_OUTPUT = 256;   // exported token image size (px)

let cropCallback = null;
let cropImgX = 0, cropImgY = 0, cropScale = 1;

function openCropModal(url, onDone) {
  cropCallback = onDone;
  const img = document.getElementById('crop-image');
  img.onload = () => {
    initCropTransform();
    document.getElementById('crop-modal').classList.add('open');
  };
  img.src = url;
}

function initCropTransform() {
  const img = document.getElementById('crop-image');
  const iw = img.naturalWidth, ih = img.naturalHeight;
  // Cover: smallest side fills the crop area, so the inscribed circle is initially full of image
  cropScale = Math.max(CROP_SIZE / iw, CROP_SIZE / ih);
  cropImgX = (CROP_SIZE - iw * cropScale) / 2;
  cropImgY = (CROP_SIZE - ih * cropScale) / 2;
  applyCropTransform();
}

function applyCropTransform() {
  const wrap = document.getElementById('crop-image-wrap');
  wrap.style.transform = `translate(${cropImgX}px, ${cropImgY}px) scale(${cropScale})`;
}

(function setupCropHandlers() {
  const area = document.getElementById('crop-area');
  if (!area) return;
  let active = false, sx = 0, sy = 0, ox0 = 0, oy0 = 0;
  area.addEventListener('pointerdown', e => {
    active = true;
    sx = e.clientX; sy = e.clientY;
    ox0 = cropImgX; oy0 = cropImgY;
    area.setPointerCapture(e.pointerId);
    area.classList.add('dragging');
  });
  area.addEventListener('pointermove', e => {
    if (!active) return;
    cropImgX = ox0 + (e.clientX - sx);
    cropImgY = oy0 + (e.clientY - sy);
    applyCropTransform();
  });
  const end = () => { active = false; area.classList.remove('dragging'); };
  area.addEventListener('pointerup',     end);
  area.addEventListener('pointercancel', end);
  area.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = area.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = Math.max(0.05, Math.min(10, cropScale * factor));
    const wx = (px - cropImgX) / cropScale;
    const wy = (py - cropImgY) / cropScale;
    cropScale = newScale;
    cropImgX = px - wx * newScale;
    cropImgY = py - wy * newScale;
    applyCropTransform();
  }, { passive: false });

  // Backdrop click cancels
  const modal = document.getElementById('crop-modal');
  modal.addEventListener('click', e => {
    if (e.target === modal) cancelCrop();
  });
})();

function acceptCrop() {
  const img = document.getElementById('crop-image');
  const out = document.createElement('canvas');
  out.width  = CROP_OUTPUT;
  out.height = CROP_OUTPUT;
  const ctx = out.getContext('2d');
  const s = CROP_OUTPUT / CROP_SIZE;
  ctx.drawImage(
    img,
    cropImgX * s,
    cropImgY * s,
    img.naturalWidth  * cropScale * s,
    img.naturalHeight * cropScale * s
  );
  const dataURL = out.toDataURL('image/png');
  closeCropModal();
  const cb = cropCallback; cropCallback = null;
  if (cb) cb(dataURL);
}

function cancelCrop() {
  closeCropModal();
  const cb = cropCallback; cropCallback = null;
  if (cb) cb(null);
}

function closeCropModal() {
  document.getElementById('crop-modal').classList.remove('open');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('crop-modal').classList.contains('open')) {
    cancelCrop();
  }
});
