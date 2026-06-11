const tokenLayer = document.getElementById('token-layer');
const ctxMenu    = document.getElementById('ctx-menu');
const hint       = document.getElementById('hint');

/* Token registry state (tokens / nextId / selectedId / ctxTarget) lives in
   state.js so save/load and board.js can share it. */

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
  const id = nextId++;
  spawnToken({ id, name, color, image: currentTokenImage, x, y, size: 54 });
  hint.style.display = 'none';
  syncToken(id);
}

function spawnToken(data) {
  const { id, name, color, image, x, y, size } = data;
  tokens[id] = { ...data };

  // Rendered vs. target position. They start equal so a freshly spawned token
  // appears exactly in place; only a remote update sets the target ahead of the
  // rendered position, which the animation loop then eases toward (see
  // animateRemoteTokens). x/y remain the authoritative logical position.
  tokens[id].renderX = x;
  tokens[id].renderY = y;
  tokens[id].targetX = x;
  tokens[id].targetY = y;

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

/* ───────── Sync helpers (push local changes + apply remote ones) ───────── */

function serializeToken(t) {
  return {
    id: t.id, name: t.name, type: t.type ?? null,
    color: t.color, image: t.image ?? null,
    x: t.x, y: t.y, size: t.size
  };
}

// Push a single token's current state to the shared room (no-op if offline).
function syncToken(id) {
  if (window.Sync && tokens[id]) window.Sync.pushToken(serializeToken(tokens[id]));
}

function normalizeRemoteToken(d) {
  return {
    id:    Number(d.id),
    name:  String(d.name ?? 'Token'),
    type:  d.type ?? null,
    color: String(d.color ?? '#888888'),
    image: typeof d.image === 'string' ? d.image : null,
    x:     Number(d.x) || 0,
    y:     Number(d.y) || 0,
    size:  Number(d.size) || 54
  };
}

// Called by sync.js when a remote token is added or changed.
function upsertRemoteToken(data) {
  const t = normalizeRemoteToken(data);
  if (!Number.isFinite(t.id)) return;
  const el = tokenLayer.querySelector(`[data-id="${t.id}"]`);
  if (!tokens[t.id] || !el) { spawnToken(t); hint.style.display = 'none'; return; }

  Object.assign(tokens[t.id], t);   // updates x/y + visual props (not render*)
  // Don't move the element here — set the lerp target and let animateRemoteTokens
  // ease renderX/renderY (and thus the element) toward it, so remote moves glide
  // instead of teleporting.
  tokens[t.id].targetX = t.x;
  tokens[t.id].targetY = t.y;
  const ring = el.querySelector('.token-ring');
  if (ring) {
    ring.style.width  = t.size + 'px';
    ring.style.height = t.size + 'px';
    ring.style.backgroundColor = t.color;
    if (t.image) {
      ring.style.backgroundImage    = `url("${t.image}")`;
      ring.style.backgroundSize     = 'cover';
      ring.style.backgroundPosition = 'center';
    } else {
      ring.style.backgroundImage = '';
    }
  }
  const label = el.querySelector('.token-label');
  if (label) label.textContent = t.name;
}

// Called by sync.js when a remote token is removed.
function removeTokenLocal(id) {
  const el = tokenLayer.querySelector(`[data-id="${id}"]`);
  if (el) el.remove();
  delete tokens[id];
  if (selectedId === id) selectedId = null;
  if (ctxTarget === id) ctxTarget = null;
  if (Object.keys(tokens).length === 0) hint.style.display = '';
}

// Keep local id allocation ahead of ids seen from other clients.
function bumpNextId(n) {
  if (Number.isFinite(n) && n > nextId) nextId = n;
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
    // If a remote lerp is still in flight, adopt the on-screen position and
    // cancel the lerp so grabbing the token doesn't make it jump.
    tokens[id].x = tokens[id].renderX;
    tokens[id].y = tokens[id].renderY;
    tokens[id].targetX = tokens[id].renderX;
    tokens[id].targetY = tokens[id].renderY;
    const w = screenToWorld(e.clientX, e.clientY);
    ox = w.x - tokens[id].x;
    oy = w.y - tokens[id].y;
    dragging = true;
    select(id);
    el.classList.add('lifted');

    if (snapToGrid && gridCellSize) {
      dragOriginCell = worldToCell(tokens[id].x, tokens[id].y);
      lastHoverKey = '';
      el.classList.add('dragging');
      const badge = el.querySelector('.token-badge');
      if (badge) { badge.textContent = '0 spaces'; badge.classList.remove('show'); }
    }
  });

  el.addEventListener('pointermove', e => {
    if (!dragging) return;
    // Captured-pointer events still bubble; keep this finger's moves out of the
    // board's pan/pinch handlers so a second finger can pan independently.
    e.stopPropagation();
    const w = screenToWorld(e.clientX, e.clientY);
    const x = w.x - ox;
    const y = w.y - oy;
    tokens[id].x = x;
    tokens[id].y = y;
    // Keep render/target pinned to the live drag position so the animation loop
    // stays converged and never tugs against an instant local drag.
    tokens[id].renderX = x;
    tokens[id].renderY = y;
    tokens[id].targetX = x;
    tokens[id].targetY = y;
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
          if (badge) {
            badge.textContent = result.cost + (result.cost === 1 ? ' space' : ' spaces');
            badge.classList.toggle('show', result.cost > 0);   // hide when back at origin
          }
        } else {
          clearPath();
          if (badge) { badge.textContent = 'blocked'; badge.classList.add('show'); }
        }
      }
    }
  });

  const endDrag = (e) => {
    if (dragging && e) e.stopPropagation();   // don't let lift-off end a second finger's pan
    if (dragging && snapToGrid && gridCellSize) {
      const snapped = snapPoint(tokens[id].x, tokens[id].y);
      tokens[id].x = snapped.x;
      tokens[id].y = snapped.y;
      tokens[id].renderX = snapped.x;
      tokens[id].renderY = snapped.y;
      tokens[id].targetX = snapped.x;
      tokens[id].targetY = snapped.y;
      el.style.left = snapped.x + 'px';
      el.style.top  = snapped.y + 'px';
    }
    dragging = false;
    dragOriginCell = null;
    el.classList.remove('dragging');
    el.classList.remove('lifted');
    const badge = el.querySelector('.token-badge');
    if (badge) badge.classList.remove('show');
    clearPath();
    syncToken(id);
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
    e.stopPropagation();
    const delta = (e.clientX - startX) / view.zoom;
    const newSize = Math.max(28, Math.min(200, startSize + delta));
    tokens[id].size = newSize;
    const ring = el.querySelector('.token-ring');
    ring.style.width  = newSize + 'px';
    ring.style.height = newSize + 'px';
  });

  handle.addEventListener('pointerup',    e => { if (active) e.stopPropagation(); active = false; syncToken(id); });
  handle.addEventListener('pointercancel',e => { if (active) e.stopPropagation(); active = false; });
}

/* ───────── Token context menu ───────── */

function showCtx(e, id) {
  hideBgCtx();
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
  syncToken(ctxTarget);
}

function ctxRecolor() {
  hideCtx();
  if (ctxTarget == null) return;
  const inp = document.createElement('input');
  inp.type = 'color'; inp.value = tokens[ctxTarget].color;
  inp.style.display = 'none'; document.body.appendChild(inp);
  const targetId = ctxTarget;
  inp.click();
  inp.addEventListener('change', () => {
    tokens[targetId].color = inp.value;
    const el = tokenLayer.querySelector(`[data-id="${targetId}"]`);
    if (el) el.querySelector('.token-ring').style.backgroundColor = inp.value;
    syncToken(targetId);
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
  const removedId = ctxTarget;
  const el = tokenLayer.querySelector(`[data-id="${ctxTarget}"]`);
  if (el) el.remove();
  delete tokens[ctxTarget];
  ctxTarget = null; selectedId = null;
  if (Object.keys(tokens).length === 0) hint.style.display = '';
  if (window.Sync) window.Sync.removeToken(removedId);
}

function clearAll() {
  if (!confirm('Remove all tokens?')) return;
  if (window.Sync) for (const id of Object.keys(tokens)) window.Sync.removeToken(Number(id));
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
  syncToken(id);
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

function setupCropHandlers() {
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
}

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
  // WebP keeps alpha (for transparent source art) but is ~50-70% smaller than PNG,
  // shrinking the base64 that travels with every token write. Browsers without WebP
  // encoding silently fall back to PNG, so this is safe everywhere.
  const dataURL = out.toDataURL('image/webp', 0.85);
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

/* ───────── Remote token motion (lerp) ─────────
   Local moves write renderX/renderY straight to the token (instant). Remote
   updates only move targetX/targetY (see upsertRemoteToken), so this loop eases
   the rendered position toward the target each frame, gliding tokens that other
   players moved instead of teleporting them. Converged tokens are skipped, so
   single-player / offline play is visually unchanged. */

const REMOTE_LERP_FACTOR = 0.15;
const LERP_SNAP_EPSILON = 0.5;   // within this many px, jump to target and stop

function animateRemoteTokens() {
  for (const id in tokens) {
    const t = tokens[id];
    if (t.renderX === undefined) continue;
    const dx = t.targetX - t.renderX;
    const dy = t.targetY - t.renderY;
    if (dx === 0 && dy === 0) continue;   // converged — leave it alone
    if (Math.abs(dx) < LERP_SNAP_EPSILON && Math.abs(dy) < LERP_SNAP_EPSILON) {
      t.renderX = t.targetX;
      t.renderY = t.targetY;
    } else {
      t.renderX += dx * REMOTE_LERP_FACTOR;
      t.renderY += dy * REMOTE_LERP_FACTOR;
    }
    const el = tokenLayer.querySelector(`[data-id="${id}"]`);
    if (el) {
      el.style.left = t.renderX + 'px';
      el.style.top  = t.renderY + 'px';
    }
  }
  requestAnimationFrame(animateRemoteTokens);
}

/* ───────── Init ───────── */

function initTokens() {
  setupCropHandlers();

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('crop-modal').classList.contains('open')) {
      cancelCrop();
    }
  });

  requestAnimationFrame(animateRemoteTokens);
}
