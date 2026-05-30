const canvasWrap = document.getElementById('canvas-wrap');
const world      = document.getElementById('world');
const bgGrid     = document.getElementById('bg-grid');
const bgImgWrap  = document.getElementById('bg-img-wrap');
const bgCtxMenu  = document.getElementById('bg-ctx-menu');
const gridCanvas    = document.getElementById('grid-canvas');
const gridCtx       = gridCanvas.getContext('2d');
const obstacleLayer = document.getElementById('obstacle-layer');
const GRID_CANVAS_SIZE = 4000;

/* ───────── View (pan + zoom) ───────── */

const view = { x: 0, y: 0, zoom: 1 };
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
let spaceHeld = false;
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
let panActive = false, panMoved = false, panStartX = 0, panStartY = 0, panOrigX = 0, panOrigY = 0;
canvasWrap.addEventListener('pointerdown', e => {
  if (e.target.closest('.token')) return;
  if (!spaceHeld) {
    if (gridDrawMode) { gridDrawDown(e); return; }
    if (obstacleEditMode && e.button === 0) { obstaclePaintDown(e); return; }
    if (typeof isDrawingActive === 'function' && isDrawingActive() && e.button === 0) { drawDown(e); return; }
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
  if (typeof drawActive !== 'undefined' && drawActive) { drawMove(e); return; }
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
function endPan(e) {
  if (gridDrawMode) { gridDrawUp(e); return; }
  if (obstaclePaintActive) { obstaclePaintUp(e); return; }
  if (typeof drawActive !== 'undefined' && drawActive) { drawUp(e); return; }
  if (!panActive) return;
  panActive = false;
  canvasWrap.classList.remove('panning');
}
canvasWrap.addEventListener('pointerup',     endPan);
canvasWrap.addEventListener('pointercancel', endPan);

/* ───────── Grid system ───────── */

let gridCellSize = 0;
let gridOriginX = 0, gridOriginY = 0;
let snapToGrid = false;

let gridDrawMode = false;
let gridDragActive = false;
let gridDragStartW = null;
let gridDragPreview = null;
const HINT_DEFAULT = 'Drag to pan · Scroll to zoom · Right-click for options · Delete key removes selected';
const HINT_GRID    = 'Drag to define one grid cell · Esc to cancel';

function setHint(text) { hint.textContent = text; hint.style.display = ''; }
function restoreHint() {
  hint.textContent = HINT_DEFAULT;
  hint.style.display = Object.keys(tokens).length === 0 ? '' : 'none';
}

function startGridDraw() {
  if (gridDrawMode) return;
  gridDrawMode = true;
  canvasWrap.classList.add('grid-draw-mode');
  setHint(HINT_GRID);
}
function cancelGridDraw() {
  if (!gridDrawMode) return;
  gridDrawMode = false;
  gridDragActive = false;
  canvasWrap.classList.remove('grid-draw-mode');
  if (gridDragPreview) { gridDragPreview.remove(); gridDragPreview = null; }
  restoreHint();
}

function gridDragRect(currW) {
  const dx = currW.x - gridDragStartW.x;
  const dy = currW.y - gridDragStartW.y;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  const x = dx >= 0 ? gridDragStartW.x : gridDragStartW.x - side;
  const y = dy >= 0 ? gridDragStartW.y : gridDragStartW.y - side;
  return { x, y, side };
}

function gridDrawDown(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  canvasWrap.setPointerCapture(e.pointerId);
  gridDragStartW = screenToWorld(e.clientX, e.clientY);
  gridDragActive = true;
  gridDragPreview = document.createElement('div');
  gridDragPreview.className = 'grid-draw-preview';
  gridDragPreview.style.left = gridDragStartW.x + 'px';
  gridDragPreview.style.top  = gridDragStartW.y + 'px';
  gridDragPreview.style.width = '0px';
  gridDragPreview.style.height = '0px';
  world.appendChild(gridDragPreview);
}
function gridDrawMove(e) {
  if (!gridDragActive) return;
  const w = screenToWorld(e.clientX, e.clientY);
  const r = gridDragRect(w);
  gridDragPreview.style.left = r.x + 'px';
  gridDragPreview.style.top  = r.y + 'px';
  gridDragPreview.style.width  = r.side + 'px';
  gridDragPreview.style.height = r.side + 'px';
}
function gridDrawUp(e) {
  if (!gridDragActive) return;
  const w = screenToWorld(e.clientX, e.clientY);
  const r = gridDragRect(w);
  gridDragActive = false;
  if (gridDragPreview) { gridDragPreview.remove(); gridDragPreview = null; }
  gridDrawMode = false;
  canvasWrap.classList.remove('grid-draw-mode');
  restoreHint();
  if (r.side >= 5) {
    setGrid(r.side, r.x, r.y);
  }
}

function setGrid(cellSize, originX, originY) {
  gridCellSize = cellSize;
  gridOriginX = originX;
  gridOriginY = originY;
  obstacles.clear();
  const half = GRID_CANVAS_SIZE / 2;
  gridCanvas.style.left = (originX - half) + 'px';
  gridCanvas.style.top  = (originY - half) + 'px';
  redrawGrid();
  renderObstacles();
}

function clearGrid() {
  gridCellSize = 0;
  obstacles.clear();
  redrawGrid();
  renderObstacles();
  exitObstacleEdit();
}

function redrawGrid() {
  gridCtx.clearRect(0, 0, GRID_CANVAS_SIZE, GRID_CANVAS_SIZE);
  if (!gridCellSize) return;
  const half = GRID_CANVAS_SIZE / 2;
  const kMin = Math.ceil(-half / gridCellSize);
  const kMax = Math.floor(half / gridCellSize);
  gridCtx.strokeStyle = 'rgba(255, 220, 150, 0.45)';
  gridCtx.lineWidth = 1.5;
  gridCtx.beginPath();
  for (let k = kMin; k <= kMax; k++) {
    const p = half + k * gridCellSize;
    gridCtx.moveTo(p, 0);            gridCtx.lineTo(p, GRID_CANVAS_SIZE);
    gridCtx.moveTo(0, p);            gridCtx.lineTo(GRID_CANVAS_SIZE, p);
  }
  gridCtx.stroke();
}

function snapPoint(wx, wy) {
  if (!snapToGrid || !gridCellSize) return { x: wx, y: wy };
  const i = Math.round((wx - gridOriginX) / gridCellSize - 0.5);
  const j = Math.round((wy - gridOriginY) / gridCellSize - 0.5);
  return {
    x: gridOriginX + (i + 0.5) * gridCellSize,
    y: gridOriginY + (j + 0.5) * gridCellSize
  };
}

/* ───────── Obstacles + A* (5-10-5 diagonals) ───────── */

const obstacles = new Set();
const obstacleKey = (x, y) => x + ',' + y;
function blockCell(x, y)   { obstacles.add(obstacleKey(x, y)); }
function unblockCell(x, y) { obstacles.delete(obstacleKey(x, y)); }
function isBlocked(x, y)   { return obstacles.has(obstacleKey(x, y)); }

function worldToCell(wx, wy) {
  return {
    x: Math.floor((wx - gridOriginX) / gridCellSize),
    y: Math.floor((wy - gridOriginY) / gridCellSize)
  };
}
function cellCenter(cx, cy) {
  return {
    x: gridOriginX + (cx + 0.5) * gridCellSize,
    y: gridOriginY + (cy + 0.5) * gridCellSize
  };
}

const PATH_NEIGHBORS = [
  [-1,-1],[ 0,-1],[ 1,-1],
  [-1, 0],        [ 1, 0],
  [-1, 1],[ 0, 1],[ 1, 1]
];

/* 5-10-5 admissible heuristic: best-case alternating diagonals starting at cost 1.
   For dx,dy with lo = min, hi = max: lo diagonals + (hi - lo) straights.
   Best diagonal sum starting at parity 0 = lo + floor(lo/2).
   Total = (hi - lo) + lo + floor(lo/2) = hi + floor(lo/2). */
function pathHeuristic(ax, ay, bx, by) {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  const lo = Math.min(dx, dy);
  const hi = Math.max(dx, dy);
  return hi + Math.floor(lo / 2);
}

function findPath(start, goal) {
  if (start.x === goal.x && start.y === goal.y) {
    return { cells: [{ x: start.x, y: start.y }], cost: 0 };
  }
  if (isBlocked(goal.x, goal.y)) return null;

  const stateKey = (x, y, dp) => x + ',' + y + ',' + dp;
  const open = [];
  const gScore = new Map();
  const cameFrom = new Map();

  const sKey = stateKey(start.x, start.y, 0);
  gScore.set(sKey, 0);
  open.push({
    x: start.x, y: start.y, dp: 0, g: 0,
    f: pathHeuristic(start.x, start.y, goal.x, goal.y)
  });

  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bi].f) bi = i;
    }
    const cur = open.splice(bi, 1)[0];
    const curKey = stateKey(cur.x, cur.y, cur.dp);
    if (cur.g > gScore.get(curKey)) continue; // stale

    if (cur.x === goal.x && cur.y === goal.y) {
      const cells = [{ x: cur.x, y: cur.y }];
      let k = curKey;
      while (cameFrom.has(k)) {
        const p = cameFrom.get(k);
        cells.unshift({ x: p.x, y: p.y });
        k = p.k;
      }
      return { cells, cost: cur.g };
    }

    for (const [dx, dy] of PATH_NEIGHBORS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (isBlocked(nx, ny)) continue;
      const isDiag = dx !== 0 && dy !== 0;
      // Prevent diagonal squeeze through two adjacent blocked cells
      if (isDiag && isBlocked(cur.x + dx, cur.y) && isBlocked(cur.x, cur.y + dy)) continue;

      let stepCost, newDp;
      if (isDiag) {
        stepCost = cur.dp === 0 ? 1 : 2;
        newDp = 1 - cur.dp;
      } else {
        stepCost = 1;
        newDp = cur.dp;
      }
      const tentG = cur.g + stepCost;
      const nKey = stateKey(nx, ny, newDp);
      if (tentG < (gScore.get(nKey) ?? Infinity)) {
        gScore.set(nKey, tentG);
        cameFrom.set(nKey, { k: curKey, x: cur.x, y: cur.y });
        open.push({
          x: nx, y: ny, dp: newDp, g: tentG,
          f: tentG + pathHeuristic(nx, ny, goal.x, goal.y)
        });
      }
    }
  }
  return null;
}

/* ───────── Path highlight rendering ───────── */

const pathLayer = document.getElementById('path-layer');

function showPath(cells) {
  pathLayer.innerHTML = '';
  if (!gridCellSize) return;
  for (const c of cells) {
    const ctr = cellCenter(c.x, c.y);
    const div = document.createElement('div');
    div.className = 'path-cell';
    div.style.left   = (ctr.x - gridCellSize / 2) + 'px';
    div.style.top    = (ctr.y - gridCellSize / 2) + 'px';
    div.style.width  = gridCellSize + 'px';
    div.style.height = gridCellSize + 'px';
    pathLayer.appendChild(div);
  }
}
function clearPath() { pathLayer.innerHTML = ''; }

/* ───────── Obstacle rendering + edit mode ───────── */

function renderObstacles() {
  obstacleLayer.innerHTML = '';
  if (!gridCellSize) return;
  for (const k of obstacles) {
    const [cx, cy] = k.split(',').map(Number);
    const ctr = cellCenter(cx, cy);
    const div = document.createElement('div');
    div.className = 'obstacle-cell';
    div.style.left   = (ctr.x - gridCellSize / 2) + 'px';
    div.style.top    = (ctr.y - gridCellSize / 2) + 'px';
    div.style.width  = gridCellSize + 'px';
    div.style.height = gridCellSize + 'px';
    obstacleLayer.appendChild(div);
  }
}

let obstacleEditMode = false;
let obstaclePaintActive = false;
let obstaclePaintAction = 'add';
let obstaclePaintedThisDrag = null;

function toggleObstacleEdit() {
  if (!gridCellSize) return; // No grid → nothing to edit
  obstacleEditMode = !obstacleEditMode;
  canvasWrap.classList.toggle('obstacle-edit-mode', obstacleEditMode);
  updateObstacleButton();
}
function exitObstacleEdit() {
  if (!obstacleEditMode && !obstaclePaintActive) return;
  obstacleEditMode = false;
  obstaclePaintActive = false;
  obstaclePaintedThisDrag = null;
  canvasWrap.classList.remove('obstacle-edit-mode');
  updateObstacleButton();
}
function updateObstacleButton() {
  const btn = document.getElementById('btn-obstacle-toggle');
  if (!btn) return;
  btn.classList.toggle('active', obstacleEditMode);
}

function obstaclePaintDown(e) {
  if (!gridCellSize) return;
  e.preventDefault();
  canvasWrap.setPointerCapture(e.pointerId);
  const w = screenToWorld(e.clientX, e.clientY);
  const cell = worldToCell(w.x, w.y);
  obstaclePaintActive = true;
  obstaclePaintAction = isBlocked(cell.x, cell.y) ? 'remove' : 'add';
  obstaclePaintedThisDrag = new Set();
  applyObstaclePaint(cell);
}
function obstaclePaintMove(e) {
  const w = screenToWorld(e.clientX, e.clientY);
  const cell = worldToCell(w.x, w.y);
  applyObstaclePaint(cell);
}
function obstaclePaintUp() {
  obstaclePaintActive = false;
  obstaclePaintedThisDrag = null;
}
function applyObstaclePaint(cell) {
  const k = cell.x + ',' + cell.y;
  if (obstaclePaintedThisDrag.has(k)) return;
  obstaclePaintedThisDrag.add(k);
  if (obstaclePaintAction === 'add') blockCell(cell.x, cell.y);
  else                                unblockCell(cell.x, cell.y);
  renderObstacles();
}

function toggleSnap() {
  snapToGrid = !snapToGrid;
  updateSnapButton();
}
function updateSnapButton() {
  const btn = document.getElementById('btn-snap-toggle');
  if (!btn) return;
  btn.classList.toggle('active', snapToGrid);
}
updateSnapButton();

/* ───────── Theme ───────── */

function setTheme(name) {
  document.body.dataset.theme = name;
  try { localStorage.setItem('vtt-theme', name); } catch (_) {}
}

(function restoreTheme() {
  let saved = null;
  try { saved = localStorage.getItem('vtt-theme'); } catch (_) {}
  if (!saved) return;
  document.body.dataset.theme = saved;
  const sel = document.getElementById('theme-select');
  if (sel) sel.value = saved;
})();

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
  if (openPanel !== 'drawing' && typeof exitDrawingMode === 'function') exitDrawingMode();
}

/* ───────── Background ───────── */

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

/* ───────── Background context menu ───────── */

function showBgCtx(e) {
  hideCtx();
  bgCtxMenu.style.display = 'block';
  bgCtxMenu.style.left = Math.min(e.clientX, window.innerWidth  - 220) + 'px';
  bgCtxMenu.style.top  = Math.min(e.clientY, window.innerHeight - 160) + 'px';
}
function hideBgCtx() { bgCtxMenu.style.display = 'none'; }

function bgCtxLoad()       { hideBgCtx(); document.getElementById('file-input').click(); }
function bgCtxClear()      { hideBgCtx(); clearBG(); }
function bgCtxRotate()     { hideBgCtx(); rotateBG(); }
function bgCtxClearAll()   { hideBgCtx(); clearAll(); }

document.getElementById('main').addEventListener('contextmenu', e => {
  if (e.target.closest('.token')) return;
  e.preventDefault();
  if (gridDrawMode) { cancelGridDraw(); return; }
  showBgCtx(e);
});

/* ───────── Global listeners ───────── */

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

/* ───────── Save / Load board state ───────── */

const SAVE_VERSION = 1;

async function saveBoard() {
  const state = {
    version: SAVE_VERSION,
    tokens: Object.values(tokens).map(t => ({
      id: t.id,
      name: t.name,
      color: t.color,
      image: t.image || null,
      size: t.size,
      x: t.x,
      y: t.y
    })),
    grid: {
      cellSize: gridCellSize,
      originX: gridOriginX,
      originY: gridOriginY,
      snapToGrid: snapToGrid
    },
    obstacles: Array.from(obstacles),
    background: await captureBackgroundState(),
    drawing: (typeof getDrawingDataURL === 'function') ? getDrawingDataURL() : null,
    view: { x: view.x, y: view.y, zoom: view.zoom }
  };
  const json = JSON.stringify(state, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'vtt-save.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
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

function loadBoardFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    let state;
    try {
      state = JSON.parse(ev.target.result);
    } catch (_) {
      alert('Load failed: file is not valid JSON.');
      return;
    }
    try {
      restoreBoard(state);
    } catch (err) {
      console.error(err);
      alert('Load failed: ' + (err && err.message ? err.message : 'unknown error'));
    }
  };
  reader.onerror = () => alert('Load failed: could not read file.');
  reader.readAsText(file);
  e.target.value = '';
}

function restoreBoard(state) {
  if (!state || typeof state !== 'object') {
    throw new Error('save file has no state object');
  }

  // Wipe current scene
  tokenLayer.innerHTML = '';
  tokens = {};
  selectedId = null;
  ctxTarget = null;
  obstacles.clear();
  gridCellSize = 0;
  redrawGrid();
  renderObstacles();
  clearPath();
  exitObstacleEdit();
  if (typeof exitDrawingMode === 'function') exitDrawingMode();
  if (gridDrawMode) cancelGridDraw();
  clearBG();

  // ── Grid ──
  const grid = (state.grid && typeof state.grid === 'object') ? state.grid : {};
  const cellSize = Number(grid.cellSize) || 0;
  const originX  = Number(grid.originX)  || 0;
  const originY  = Number(grid.originY)  || 0;
  if (cellSize > 0) {
    setGrid(cellSize, originX, originY); // clears obstacles internally
  }
  snapToGrid = !!grid.snapToGrid;
  updateSnapButton();

  // ── Obstacles (after setGrid, which cleared them) ──
  if (Array.isArray(state.obstacles)) {
    for (const k of state.obstacles) {
      if (typeof k === 'string' && /^-?\d+,-?\d+$/.test(k)) obstacles.add(k);
    }
    renderObstacles();
  }

  // ── Background ──
  const bg = (state.background && typeof state.background === 'object') ? state.background : null;
  if (bg && typeof bg.image === 'string' && bg.image.startsWith('data:')) {
    bgImgWrap.innerHTML = '';
    const img = document.createElement('img');
    img.onload = () => {
      bgGrid.classList.add('hidden');
      bgNaturalW = img.naturalWidth;
      bgNaturalH = img.naturalHeight;
      bgRotation = Number(bg.rotation) || 0;
      applyBgTransform();
    };
    img.onerror = () => {
      bgImgWrap.innerHTML = '';
    };
    img.src = bg.image;
    bgImgWrap.appendChild(img);
  }

  // ── Tokens ──
  let maxId = 0;
  if (Array.isArray(state.tokens)) {
    for (const t of state.tokens) {
      if (!t || typeof t !== 'object') continue;
      const id = Number.isFinite(Number(t.id)) ? Number(t.id) : (maxId + 1);
      if (id > maxId) maxId = id;
      spawnToken({
        id,
        name:  String(t.name ?? 'Token'),
        color: String(t.color ?? '#888888'),
        image: typeof t.image === 'string' ? t.image : null,
        x:     Number(t.x) || 0,
        y:     Number(t.y) || 0,
        size:  Number(t.size) || 54
      });
    }
  }
  nextId = maxId + 1;

  // ── Drawing layer ──
  if (typeof restoreDrawingFromDataURL === 'function') {
    restoreDrawingFromDataURL(typeof state.drawing === 'string' ? state.drawing : null);
  }

  // ── View ──
  const v = (state.view && typeof state.view === 'object') ? state.view : null;
  if (v) {
    view.x    = Number(v.x)    || 0;
    view.y    = Number(v.y)    || 0;
    view.zoom = Number(v.zoom) || 1;
    applyView();
  }

  // Hint visibility
  hint.style.display = Object.keys(tokens).length === 0 ? '' : 'none';
}

/* ───────── Demo tokens ───────── */

spawnToken({ id: nextId++, name: 'Aldric',  color: '#2a6aaa', x: 220, y: 240, size: 54 });
spawnToken({ id: nextId++, name: 'Lyria',   color: '#7a3aaa', x: 320, y: 300, size: 54 });
spawnToken({ id: nextId++, name: 'Goblin',  color: '#882222', x: 580, y: 240, size: 54 });
spawnToken({ id: nextId++, name: 'Troll',   color: '#554422', x: 660, y: 340, size: 70 });
restoreHint();
