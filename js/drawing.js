/* ───────── Drawing layer (freehand + shapes + eraser + undo/redo) ───────── */

const DRAW_CANVAS_SIZE   = 4000;
const DRAW_CANVAS_OFFSET = 2000; // world (0,0) → canvas pixel (2000,2000)
const MAX_UNDO = 50;

const drawingCanvas = document.getElementById('drawing-layer');
const drawingCtx    = drawingCanvas.getContext('2d');

let currentDrawTool  = null;        // null | 'pen' | 'rect' | 'circle' | 'line' | 'eraser'
let currentDrawColor = '#e04040';
let currentDrawSize  = 6;

let drawingStrokes       = [];
let drawingUndoneStrokes = [];
let drawingBaseImage     = null;   // HTMLCanvasElement | null

let drawActive        = false;
let drawStartPt       = null;
let drawCurrentPoints = null;
let drawShapeSnapshot = null;

function isDrawingActive() { return currentDrawTool !== null; }

function setDrawTool(tool) {
  currentDrawTool = (currentDrawTool === tool) ? null : tool;
  refreshToolButtons();
  document.body.classList.toggle('drawing-active', currentDrawTool !== null);
}

function exitDrawingMode() {
  if (drawActive && drawShapeSnapshot) {
    drawingCtx.clearRect(0, 0, DRAW_CANVAS_SIZE, DRAW_CANVAS_SIZE);
    drawingCtx.drawImage(drawShapeSnapshot, 0, 0);
    drawShapeSnapshot = null;
  }
  drawActive = false;
  drawCurrentPoints = null;
  drawStartPt = null;
  currentDrawTool = null;
  refreshToolButtons();
  document.body.classList.remove('drawing-active');
}

function refreshToolButtons() {
  for (const t of ['pen', 'rect', 'circle', 'line', 'eraser']) {
    const btn = document.getElementById('btn-tool-' + t);
    if (btn) btn.classList.toggle('active', currentDrawTool === t);
  }
}

function setDrawColor(color) {
  currentDrawColor = color;
  const picker = document.getElementById('draw-color-picker');
  if (picker) picker.value = color;
  document.querySelectorAll('.swatch').forEach(s => {
    s.classList.toggle('active', (s.dataset.color || '').toLowerCase() === color.toLowerCase());
  });
}

function setDrawSize(size) {
  currentDrawSize = Number(size) || 6;
}

function screenToDrawCanvas(cx, cy) {
  const w = screenToWorld(cx, cy);
  return { x: w.x + DRAW_CANVAS_OFFSET, y: w.y + DRAW_CANVAS_OFFSET };
}

/* ───── Pointer handlers (called from board.js) ───── */

function drawDown(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  canvasWrap.setPointerCapture(e.pointerId);
  drawActive = true;
  const pt = screenToDrawCanvas(e.clientX, e.clientY);
  drawStartPt = pt;

  if (currentDrawTool === 'pen' || currentDrawTool === 'eraser') {
    drawCurrentPoints = [pt];
    applyFreehandSegment(pt, pt);
  } else {
    drawShapeSnapshot = document.createElement('canvas');
    drawShapeSnapshot.width  = DRAW_CANVAS_SIZE;
    drawShapeSnapshot.height = DRAW_CANVAS_SIZE;
    drawShapeSnapshot.getContext('2d').drawImage(drawingCanvas, 0, 0);
  }
}

function drawMove(e) {
  if (!drawActive) return;
  const pt = screenToDrawCanvas(e.clientX, e.clientY);

  if (currentDrawTool === 'pen' || currentDrawTool === 'eraser') {
    const prev = drawCurrentPoints[drawCurrentPoints.length - 1];
    drawCurrentPoints.push(pt);
    applyFreehandSegment(prev, pt);
  } else {
    drawingCtx.clearRect(0, 0, DRAW_CANVAS_SIZE, DRAW_CANVAS_SIZE);
    drawingCtx.drawImage(drawShapeSnapshot, 0, 0);
    drawShapeOnto(drawingCtx, currentDrawTool, drawStartPt, pt, currentDrawColor, currentDrawSize);
  }
}

function drawUp(e) {
  if (!drawActive) return;
  drawActive = false;
  const pt = screenToDrawCanvas(e.clientX, e.clientY);

  if (currentDrawTool === 'pen') {
    pushStroke({ type: 'pen', color: currentDrawColor, width: currentDrawSize, points: drawCurrentPoints });
  } else if (currentDrawTool === 'eraser') {
    pushStroke({ type: 'eraser', width: currentDrawSize, points: drawCurrentPoints });
  } else if (currentDrawTool === 'rect' || currentDrawTool === 'circle' || currentDrawTool === 'line') {
    pushStroke({
      type:  currentDrawTool,
      color: currentDrawColor,
      width: currentDrawSize,
      x0: drawStartPt.x, y0: drawStartPt.y,
      x1: pt.x,          y1: pt.y,
    });
  }

  drawCurrentPoints = null;
  drawStartPt = null;
  drawShapeSnapshot = null;
  syncDrawing();
}

/* ───── Stroke primitives ───── */

function applyFreehandSegment(a, b) {
  drawingCtx.save();
  drawingCtx.lineCap  = 'round';
  drawingCtx.lineJoin = 'round';
  drawingCtx.lineWidth = currentDrawSize;
  if (currentDrawTool === 'eraser') {
    drawingCtx.globalCompositeOperation = 'destination-out';
    drawingCtx.strokeStyle = '#000';
  } else {
    drawingCtx.globalCompositeOperation = 'source-over';
    drawingCtx.strokeStyle = currentDrawColor;
  }
  drawingCtx.beginPath();
  drawingCtx.moveTo(a.x, a.y);
  drawingCtx.lineTo(b.x, b.y);
  drawingCtx.stroke();
  drawingCtx.restore();
}

function drawShapeOnto(ctx, kind, a, b, color, width) {
  ctx.save();
  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.globalCompositeOperation = 'source-over';
  if (kind === 'rect') {
    ctx.strokeRect(
      Math.min(a.x, b.x), Math.min(a.y, b.y),
      Math.abs(b.x - a.x), Math.abs(b.y - a.y),
    );
  } else if (kind === 'circle') {
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const r  = Math.hypot(b.x - a.x, b.y - a.y) / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  } else if (kind === 'line') {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStrokeOnContext(ctx, stroke) {
  ctx.save();
  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke.width || 1;
  if (stroke.type === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = '#000';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = stroke.color || '#000';
  }
  if (stroke.type === 'pen' || stroke.type === 'eraser') {
    const pts = stroke.points;
    if (!pts || pts.length === 0) { ctx.restore(); return; }
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 1) ctx.lineTo(pts[0].x + 0.01, pts[0].y + 0.01);
    else for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  } else if (stroke.type === 'clear') {
    ctx.clearRect(0, 0, DRAW_CANVAS_SIZE, DRAW_CANVAS_SIZE);
  } else {
    drawShapeOnto(ctx, stroke.type,
      { x: stroke.x0, y: stroke.y0 },
      { x: stroke.x1, y: stroke.y1 },
      stroke.color, stroke.width);
  }
  ctx.restore();
}

function redrawAll() {
  drawingCtx.clearRect(0, 0, DRAW_CANVAS_SIZE, DRAW_CANVAS_SIZE);
  if (drawingBaseImage) drawingCtx.drawImage(drawingBaseImage, 0, 0);
  for (const s of drawingStrokes) drawStrokeOnContext(drawingCtx, s);
}

function pushStroke(stroke) {
  drawingStrokes.push(stroke);
  drawingUndoneStrokes = [];
  while (drawingStrokes.length > MAX_UNDO) {
    if (!drawingBaseImage) {
      drawingBaseImage = document.createElement('canvas');
      drawingBaseImage.width  = DRAW_CANVAS_SIZE;
      drawingBaseImage.height = DRAW_CANVAS_SIZE;
    }
    drawStrokeOnContext(drawingBaseImage.getContext('2d'), drawingStrokes.shift());
  }
}

/* ───── Undo / Redo / Clear ───── */

function drawUndo() {
  if (!drawingStrokes.length) return;
  drawingUndoneStrokes.push(drawingStrokes.pop());
  redrawAll();
  syncDrawing();
}
function drawRedo() {
  if (!drawingUndoneStrokes.length) return;
  const s = drawingUndoneStrokes.pop();
  drawingStrokes.push(s);
  drawStrokeOnContext(drawingCtx, s);
  syncDrawing();
}
function clearDrawing() {
  pushStroke({ type: 'clear' });
  drawStrokeOnContext(drawingCtx, { type: 'clear' });
  syncDrawing();
}

/* ───── Sync helper (push the canvas as a data URL) ───── */

// Broadcast the current drawing layer to the room (no-op if offline).
function syncDrawing() {
  if (window.Sync) window.Sync.pushDrawing(getDrawingDataURL());
}

/* ───── Save / Load hooks ───── */

function getDrawingDataURL() {
  if (drawingStrokes.length === 0 && !drawingBaseImage) return null;
  return drawingCanvas.toDataURL('image/png');
}

function restoreDrawingFromDataURL(dataURL) {
  drawingStrokes = [];
  drawingUndoneStrokes = [];
  drawingBaseImage = null;
  drawingCtx.clearRect(0, 0, DRAW_CANVAS_SIZE, DRAW_CANVAS_SIZE);
  if (!dataURL || typeof dataURL !== 'string') return;
  const img = new Image();
  img.onload = () => {
    drawingBaseImage = document.createElement('canvas');
    drawingBaseImage.width  = DRAW_CANVAS_SIZE;
    drawingBaseImage.height = DRAW_CANVAS_SIZE;
    drawingBaseImage.getContext('2d').drawImage(img, 0, 0);
    drawingCtx.clearRect(0, 0, DRAW_CANVAS_SIZE, DRAW_CANVAS_SIZE);
    drawingCtx.drawImage(drawingBaseImage, 0, 0);
  };
  img.onerror = () => {};
  img.src = dataURL;
}

/* ───── Init (keyboard shortcuts + initial color) ───── */

function initDrawing() {
  /* Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y — undo / redo */
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey)                 { e.preventDefault(); drawUndo(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); drawRedo(); }
  });

  /* D = draw, E = erase (toggle; works without the panel open) */
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if (k === 'd')      { e.preventDefault(); setDrawTool('pen'); }
    else if (k === 'e') { e.preventDefault(); setDrawTool('eraser'); }
  });

  setDrawColor(currentDrawColor);
}
