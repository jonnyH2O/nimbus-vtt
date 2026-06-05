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

function endPan(e) {
  if (gridDrawMode) { gridDrawUp(e); return; }
  if (obstaclePaintActive) { obstaclePaintUp(e); return; }
  if (drawActive) { drawUp(e); return; }
  if (!panActive) return;
  panActive = false;
  canvasWrap.classList.remove('panning');
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
    if (e.target.closest('.token')) return;
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
    applyView();
  });
  canvasWrap.addEventListener('pointerup',     endPan);
  canvasWrap.addEventListener('pointercancel', endPan);

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
