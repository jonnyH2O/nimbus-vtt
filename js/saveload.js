/* ───────── Save / Load board state ─────────
   Serializes tokens, grid, obstacles, background (base64), drawing layer
   (data URL), and view into a downloadable .json. On load, wipes the scene
   and rebuilds it piece by piece, tolerating missing or malformed fields. */

const SAVE_VERSION = 1;

function initSaveLoad() {
  // Save and Load are driven entirely by the inline handlers in index.html
  // (the Save button and the hidden load-file <input>), so there are no
  // listeners to wire up here. Present for a symmetric init() chain.
}

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
    drawing: getDrawingDataURL(),
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
  if (gridDrawMode) cancelGridDraw();
  clearGrid();          // wipes grid + obstacles + exits obstacle-edit mode
  clearPath();
  exitDrawingMode();
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
  restoreBackgroundFromState(state.background);

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
  restoreDrawingFromDataURL(typeof state.drawing === 'string' ? state.drawing : null);

  // ── View ──
  const v = (state.view && typeof state.view === 'object') ? state.view : null;
  if (v) {
    view.x    = Number(v.x)    || 0;
    view.y    = Number(v.y)    || 0;
    view.zoom = Number(v.zoom) || 1;
    applyView();
  }

  restoreHint();
}
