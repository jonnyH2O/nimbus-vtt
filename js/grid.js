/* ───────── Grid system ─────────
   Owns the grid canvas + the obstacle overlay, the grid-draw rectangle
   picker, snap-to-grid math, cell ↔ world conversions, the obstacle
   layer (paint mode + render), and the hint text helpers used while
   the grid-draw mode is active. */

const gridCanvas    = document.getElementById('grid-canvas');
const gridCtx       = gridCanvas.getContext('2d');
const obstacleLayer = document.getElementById('obstacle-layer');
const GRID_CANVAS_SIZE = 2560;   // backing store kept modest for mobile (iOS) memory

/* ───────── Grid state ───────── */

let gridCellSize = 0;
let gridOriginX = 0, gridOriginY = 0;
let snapToGrid = false;

let gridDrawMode = false;
let gridDragActive = false;
let gridDragStartW = null;
let gridDragPreview = null;

/* ───────── Hint text (used by grid-draw lifecycle) ───────── */

const HINT_DEFAULT = 'Drag to pan · Scroll to zoom · Right-click for options · Delete key removes selected';
const HINT_GRID    = 'Drag to define one grid cell · Esc to cancel';

function setHint(text) { hint.textContent = text; hint.style.display = ''; }
function restoreHint() {
  hint.textContent = '';
  hint.style.display = 'none';
}

/* ───────── Grid-draw mode (rectangle picker) ───────── */

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
    syncGrid();
    syncObstacles();   // setGrid cleared obstacles; broadcast the empty set
  }
}

/* ───────── Grid set / clear / redraw ───────── */

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

/* ───────── Cell math + snap ───────── */

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

function snapPoint(wx, wy) {
  if (!snapToGrid || !gridCellSize) return { x: wx, y: wy };
  const i = Math.round((wx - gridOriginX) / gridCellSize - 0.5);
  const j = Math.round((wy - gridOriginY) / gridCellSize - 0.5);
  return {
    x: gridOriginX + (i + 0.5) * gridCellSize,
    y: gridOriginY + (j + 0.5) * gridCellSize
  };
}

function toggleSnap() {
  snapToGrid = !snapToGrid;
  updateSnapButton();
  syncGrid();
}
function updateSnapButton() {
  const btn = document.getElementById('btn-snap-toggle');
  if (!btn) return;
  btn.classList.toggle('active', snapToGrid);
}

function initGrid() {
  updateSnapButton();
}

/* ───────── Sync helpers (push local changes + apply remote ones) ───────── */

function currentGridState() {
  return {
    cellSize: gridCellSize,
    offsetX:  gridOriginX,
    offsetY:  gridOriginY,
    visible:  gridCellSize > 0,
    snap:     snapToGrid
  };
}

function syncGrid()      { if (window.Sync) window.Sync.pushGrid(currentGridState()); }
function syncObstacles() { if (window.Sync) window.Sync.pushObstacles(Array.from(obstacles)); }

// Called by sync.js when the grid config changes remotely.
function applyRemoteGrid(g) {
  if (!g || !g.visible || !(Number(g.cellSize) > 0)) {
    clearGrid();
  } else {
    setGrid(Number(g.cellSize), Number(g.offsetX) || 0, Number(g.offsetY) || 0);
  }
  snapToGrid = !!(g && g.snap);
  updateSnapButton();
}

// Called by sync.js when the obstacle set changes remotely.
function applyRemoteObstacles(cells) {
  obstacles.clear();
  if (Array.isArray(cells)) {
    for (const k of cells) {
      if (typeof k === 'string' && /^-?\d+,-?\d+$/.test(k)) obstacles.add(k);
    }
  }
  renderObstacles();
}

// User-facing "Clear Grid" (wired from index.html) — clears and broadcasts.
function userClearGrid() {
  clearGrid();
  syncGrid();
  syncObstacles();
}

/* ───────── Obstacles (data-model API) ───────── */

const obstacles = new Set();
const obstacleKey = (x, y) => x + ',' + y;
function blockCell(x, y)   { obstacles.add(obstacleKey(x, y)); }
function unblockCell(x, y) { obstacles.delete(obstacleKey(x, y)); }
function isBlocked(x, y)   { return obstacles.has(obstacleKey(x, y)); }

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
  syncObstacles();
}
function applyObstaclePaint(cell) {
  const k = obstacleKey(cell.x, cell.y);
  if (obstaclePaintedThisDrag.has(k)) return;
  obstaclePaintedThisDrag.add(k);
  if (obstaclePaintAction === 'add') blockCell(cell.x, cell.y);
  else                                unblockCell(cell.x, cell.y);
  renderObstacles();
}
