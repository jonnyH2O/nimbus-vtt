/* ───────── Board: view (pan + zoom), themes, panels, background menu ─────────
   Board-specific behaviour only. State (the `view` transform) lives in
   state.js; initBoard() renders the initial view and wires up the pan/zoom,
   theme, panel and background-menu listeners. main.js calls it on startup. */

const canvasWrap = document.getElementById('canvas-wrap');
const world      = document.getElementById('world');
const bgCtxMenu  = document.getElementById('bg-ctx-menu');

/* ───────── View (pan + zoom) ───────── */

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 5;

function applyView() {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
}

function screenToWorld(cx, cy) {
  const r = canvasWrap.getBoundingClientRect();
  return { x: (cx - r.left - view.x) / view.zoom, y: (cy - r.top - view.y) / view.zoom };
}

function fitToView(w, h) {
  const r = canvasWrap.getBoundingClientRect();
  const pad = 40;
  const z = Math.min((r.width - pad * 2) / w, (r.height - pad * 2) / h, 1);
  view.zoom = Math.max(MIN_ZOOM, z);
  view.x = (r.width  - w * view.zoom) / 2;
  view.y = (r.height - h * view.zoom) / 2;
  applyView();
}

/* ───────── Pan state (mutated by the listeners wired in initBoard) ───────── */

let spaceHeld = false;
let panActive = false, panMoved = false, panStartX = 0, panStartY = 0, panOrigX = 0, panOrigY = 0;

/* Pinch (two-finger zoom + pan): track active touch points by id */
const touchPts = new Map();
let pinchActive = false, pinchDist = 0, pinchMidX = 0, pinchMidY = 0;
// canvasWrap is a fixed full-viewport element, so its rect is stable during a
// gesture — cache it at gesture start to avoid a forced reflow on every move.
let canvasRect = null;

/* Batch transform writes to one per frame. High-rate pointermove events (mobile
   digitizers fire many per frame, plus coalesced events) would otherwise trigger
   a style write — and previously a getBoundingClientRect reflow — on every event,
   flooding the main thread on fast gestures. We mutate `view` synchronously and
   only paint here, so the latest state is always rendered. */
let viewRaf = 0;
function scheduleApplyView() {
  if (viewRaf) return;
  viewRaf = requestAnimationFrame(() => { viewRaf = 0; applyView(); });
}

function endPan(e) {
  if (gridDrawMode) { gridDrawUp(e); return; }
  if (obstaclePaintActive) { obstaclePaintUp(e); return; }
  if (drawActive) { drawUp(e); return; }
  if (!panActive) return;
  panActive = false;
  canvasRect = null;
  canvasWrap.classList.remove('panning');
}

/* Begin a pinch once two fingers are down — cancel any in-progress pan */
function startPinch() {
  pinchActive = true;
  panActive = false;
  canvasWrap.classList.remove('panning');
  canvasRect = canvasWrap.getBoundingClientRect();
  const [a, b] = [...touchPts.values()];
  pinchDist = Math.hypot(b.x - a.x, b.y - a.y);
  pinchMidX = (a.x + b.x) / 2;
  pinchMidY = (a.y + b.y) / 2;
}

/* Update zoom (distance ratio) and pan (midpoint drift), anchored at the
   midpoint — same anchor math as the wheel handler. */
function pinchMove() {
  if (touchPts.size < 2) return;
  const [a, b] = [...touchPts.values()];
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  const r = canvasRect || (canvasRect = canvasWrap.getBoundingClientRect());
  const cx = midX - r.left;
  const cy = midY - r.top;
  // Only zoom when both distances are usable; a 0/NaN ratio would corrupt view.
  if (pinchDist > 0 && dist > 0) {
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom * (dist / pinchDist)));
    const wx = (cx - view.x) / view.zoom;
    const wy = (cy - view.y) / view.zoom;
    view.zoom = newZoom;
    view.x = cx - wx * newZoom;
    view.y = cy - wy * newZoom;
  }
  view.x += midX - pinchMidX;
  view.y += midY - pinchMidY;
  pinchDist = dist;
  pinchMidX = midX;
  pinchMidY = midY;
  // Bail out of a corrupted state rather than render a broken transform.
  if (!Number.isFinite(view.x) || !Number.isFinite(view.y) || !Number.isFinite(view.zoom)) {
    view.x = view.x || 0; view.y = view.y || 0; view.zoom = view.zoom || 1;
  }
  scheduleApplyView();
}

/* A touch lifted: drop it, end the pinch, and hand off to one-finger pan
   if a single finger remains (so the view doesn't jump). */
function handleTouchUp(e) {
  touchPts.delete(e.pointerId);
  if (pinchActive) {
    if (touchPts.size === 1) {
      const [p] = [...touchPts.values()];
      pinchActive = false;
      panActive = true; panMoved = true;
      panStartX = p.x; panStartY = p.y;
      panOrigX = view.x; panOrigY = view.y;
      return;
    }
    pinchActive = false;
  }
  endPan(e);
}

/* ───────── Theme ───────── */

function setTheme(name) {
  document.body.dataset.theme = name;
  try { localStorage.setItem('vtt-theme', name); } catch (_) {}
}

function restoreTheme() {
  let saved = null;
  try { saved = localStorage.getItem('vtt-theme'); } catch (_) {}
  if (!saved) return;
  document.body.dataset.theme = saved;
  const sel = document.getElementById('theme-select');
  if (sel) sel.value = saved;
}

/* ───────── Room (multiplayer) ───────── */

// Current room id — prefer the live value from the sync module, fall back to
// the URL so it works before sync has loaded (or when running offline).
function currentRoomId() {
  if (window.Sync && window.Sync.getRoomId) {
    const r = window.Sync.getRoomId();
    if (r) return r;
  }
  return new URLSearchParams(location.search).get('room') || '';
}

// Reduce a raw code, a pasted share URL, or messy input to the canonical
// lowercase-alphanumeric room code (matches genRoomId()'s alphabet in sync.js).
function parseRoomCode(raw) {
  const s = (raw || '').trim();
  const m = s.match(/[?&]room=([a-z0-9]+)/i);
  if (m) return m[1].toLowerCase();
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function refreshRoomInput() {
  const input = document.getElementById('room-input');
  if (input) input.value = currentRoomId();
}

async function copyRoom() {
  const code = currentRoomId();
  if (!code) return;
  const btn = document.getElementById('btn-copy-room');
  let ok = false;
  try {
    await navigator.clipboard.writeText(code);
    ok = true;
  } catch (_) {
    // Fallback for non-secure contexts / older browsers: select + execCommand
    const input = document.getElementById('room-input');
    if (input) {
      input.focus();
      input.select();
      try { ok = document.execCommand('copy'); } catch (_) {}
    }
  }
  const use = btn && btn.querySelector('use');
  if (use) {
    use.setAttribute('href', ok ? 'icons/icons.svg#check' : 'icons/icons.svg#copy');
    setTimeout(() => { use.setAttribute('href', 'icons/icons.svg#copy'); }, 1200);
  }
}

function goToRoom() {
  const input = document.getElementById('room-input');
  if (!input) return;
  const code = parseRoomCode(input.value);
  if (!code) { refreshRoomInput(); return; }   // nothing usable — reset the field
  if (code === currentRoomId()) return;        // already in this room
  const params = new URLSearchParams(location.search);
  params.set('room', code);
  // Reload into the new room; sync re-runs init against ?room=<code>.
  location.search = params.toString();
}

/* ───────── Side panels ───────── */

let openPanel = null;
function togglePanel(name) {
  hideCtx(); hideBgCtx();
  const panel = document.getElementById('panel-' + name);
  const btn   = document.getElementById('btn-panel-' + name);
  if (openPanel === name) {
    panel.classList.remove('open');
    btn.classList.remove('active');
    openPanel = null;
  } else {
    if (openPanel) {
      document.getElementById('panel-' + openPanel).classList.remove('open');
      document.getElementById('btn-panel-' + openPanel).classList.remove('active');
    }
    panel.classList.add('open');
    btn.classList.add('active');
    openPanel = name;
  }
  document.body.classList.toggle('grid-panel-open', openPanel === 'grid');
  if (openPanel !== 'grid') exitObstacleEdit();
  if (openPanel !== 'drawing') exitDrawingMode();
  if (openPanel === 'settings') refreshRoomInput();
  if (btn) btn.blur();   // drop focus so the button doesn't stay highlighted after closing
}

/* Collapsible top-right dock: flips the arrow and slides the panel icons in/out. */
function toggleDock() {
  document.getElementById('panel-dock').classList.toggle('open');
}

/* ───────── Background context menu ───────── */

function showBgCtx(e) {
  hideCtx();
  bgCtxMenu.style.display = 'block';
  bgCtxMenu.style.left = Math.min(e.clientX, window.innerWidth  - 220) + 'px';
  bgCtxMenu.style.top  = Math.min(e.clientY, window.innerHeight - 160) + 'px';
}
function hideBgCtx() { bgCtxMenu.style.display = 'none'; }

function bgCtxLoad()       { hideBgCtx(); document.getElementById('file-input').click(); }
function bgCtxClear()      { hideBgCtx(); clearBG(); syncBackground(); }
function bgCtxRotate()     { hideBgCtx(); rotateBG(); }
function bgCtxClearAll()   { hideBgCtx(); clearAll(); }

/* ───────── Init ───────── */

function initBoard() {
  applyView();

  /* Wheel zoom — anchor the world point under the cursor */
  canvasWrap.addEventListener('wheel', e => {
    e.preventDefault();
    const r = canvasWrap.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom * factor));
    if (newZoom === view.zoom) return;
    const wx = (cx - view.x) / view.zoom;
    const wy = (cy - view.y) / view.zoom;
    view.zoom = newZoom;
    view.x = cx - wx * newZoom;
    view.y = cy - wy * newZoom;
    applyView();
  }, { passive: false });

  /* Hold Space to temporarily override any active tool and pan instead */
  document.addEventListener('keydown', e => {
    if (e.key !== ' ' && e.code !== 'Space') return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    e.preventDefault();
    if (!spaceHeld) {
      spaceHeld = true;
      document.body.classList.add('space-pan');
    }
  });
  document.addEventListener('keyup', e => {
    if (e.key !== ' ' && e.code !== 'Space') return;
    spaceHeld = false;
    document.body.classList.remove('space-pan');
  });
  window.addEventListener('blur', () => {
    if (spaceHeld) { spaceHeld = false; document.body.classList.remove('space-pan'); }
  });

  /* Pan — drag empty canvas with left or middle button */
  canvasWrap.addEventListener('pointerdown', e => {
    // A pointer that starts on a token drives that token's own drag — never let
    // it into the pan/pinch tracker, so a second finger can't turn a token drag
    // into a pinch-zoom.
    if (e.target.closest('.token')) return;
    if (e.pointerType === 'touch') {
      touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchPts.size === 2) { startPinch(); return; }
    }
    if (pinchActive) return;
    if (!spaceHeld) {
      if (gridDrawMode) { gridDrawDown(e); return; }
      if (obstacleEditMode && e.button === 0) { obstaclePaintDown(e); return; }
      if (isDrawingActive() && e.button === 0) { drawDown(e); return; }
    }
    if (e.button !== 0 && e.button !== 1) return;
    panActive = true;
    panMoved = false;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panOrigX = view.x;
    panOrigY = view.y;
    canvasWrap.setPointerCapture(e.pointerId);
  });
  canvasWrap.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch' && touchPts.has(e.pointerId)) {
      touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (pinchActive) { pinchMove(); return; }
    if (gridDrawMode) { gridDrawMove(e); return; }
    if (obstaclePaintActive) { obstaclePaintMove(e); return; }
    if (drawActive) { drawMove(e); return; }
    if (!panActive) return;
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    if (!panMoved) {
      if (Math.hypot(dx, dy) < 3) return;
      panMoved = true;
      canvasWrap.classList.add('panning');
    }
    view.x = panOrigX + dx;
    view.y = panOrigY + dy;
    scheduleApplyView();
  });
  canvasWrap.addEventListener('pointerup',     e => { if (e.pointerType === 'touch') { handleTouchUp(e); return; } endPan(e); });
  canvasWrap.addEventListener('pointercancel', e => { if (e.pointerType === 'touch') { handleTouchUp(e); return; } endPan(e); });

  /* Background context menu */
  document.getElementById('main').addEventListener('contextmenu', e => {
    if (e.target.closest('.token')) return;
    e.preventDefault();
    if (gridDrawMode) { cancelGridDraw(); return; }
    showBgCtx(e);
  });

  /* Global listeners */
  document.addEventListener('click', e => {
    hideCtx();
    hideBgCtx();
    if (!e.target.closest('.token')) select(null);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && gridDrawMode) {
      cancelGridDraw();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId !== null) {
      if (document.activeElement.tagName === 'INPUT') return;
      ctxTarget = selectedId;
      ctxDelete();
    }
  });

  restoreTheme();
}
