/* ───────── Drawing layer (freehand + shapes + eraser + undo/redo) ───────── */

const DRAW_CANVAS_SIZE   = 2560;   // default buffer size when no background is loaded
const DRAW_CANVAS_OFFSET = 1280;   // default world (0,0) → canvas pixel (1280,1280)
const DRAW_PAD     = 300;          // world-px drawable margin kept around the background
const DRAW_MAX_DIM = 8192;         // cap on canvas buffer dimension (browser canvas limits)

const drawingCanvas = document.getElementById('drawing-layer');
const drawingCtx    = drawingCanvas.getContext('2d');

/* Live drawing-canvas geometry. The canvas tracks the background: it is sized and
   positioned to cover the loaded image (see updateDrawingGeometryForBackground).
   A world point (wx,wy) maps to canvas pixel (wx + drawOffX, wy + drawOffY); the
   canvas top-left therefore sits at world (-drawOffX, -drawOffY). Strokes are stored
   in WORLD coordinates so they survive geometry changes (the canvas is only the
   render target, not the source of truth). */
let drawW    = DRAW_CANVAS_SIZE;
let drawH    = DRAW_CANVAS_SIZE;
let drawOffX = DRAW_CANVAS_OFFSET;
let drawOffY = DRAW_CANVAS_OFFSET;

let currentDrawTool  = null;        // null | 'pen' | 'rect' | 'circle' | 'line' | 'eraser'
let currentDrawColor = '#e04040';
let currentDrawSize  = 6;

let drawingStrokes   = [];         // strokes in WORLD coordinates (the source of truth)
let drawingBaseImage = null;       // HTMLCanvasElement | null — raster from a loaded PNG save
let drawingSourceURL = null;       // last full-canvas PNG applied (legacy load); kept so it
                                   // can be repainted if the canvas geometry changes

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
    drawingCtx.setTransform(1, 0, 0, 1, 0, 0);
    drawingCtx.clearRect(0, 0, drawW, drawH);
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

// Pointer → world coordinates (strokes are stored in world space; the canvas
// translation in drawStrokeOnContext maps them to pixels at render time).
function screenToDrawWorld(cx, cy) {
  return screenToWorld(cx, cy);
}

/* ───── Canvas geometry: track the background ───── */

// Size + position the drawing canvas to cover a background whose displayed box is
// boxW × boxH (anchored at world origin). Pass 0×0 (no background) for the default
// origin-centred window. Called from background.js whenever the background changes.
function updateDrawingGeometryForBackground(boxW, boxH) {
  if (boxW > 0 && boxH > 0) {
    applyDrawingGeometry(
      Math.min(DRAW_MAX_DIM, Math.round(boxW) + DRAW_PAD * 2),
      Math.min(DRAW_MAX_DIM, Math.round(boxH) + DRAW_PAD * 2),
      DRAW_PAD, DRAW_PAD);
  } else {
    applyDrawingGeometry(DRAW_CANVAS_SIZE, DRAW_CANVAS_SIZE,
                         DRAW_CANVAS_OFFSET, DRAW_CANVAS_OFFSET);
  }
}

// Resize/reposition the canvas buffer and repaint the existing drawing into it.
function applyDrawingGeometry(newW, newH, newOffX, newOffY) {
  if (newW === drawW && newH === drawH && newOffX === drawOffX && newOffY === drawOffY) return;

  const dx = newOffX - drawOffX, dy = newOffY - drawOffY;
  const oldBase = drawingBaseImage;

  drawW = newW; drawH = newH; drawOffX = newOffX; drawOffY = newOffY;
  drawingCanvas.width  = newW;          // resizing clears the buffer + resets the transform
  drawingCanvas.height = newH;
  drawingCanvas.style.width  = newW + 'px';
  drawingCanvas.style.height = newH + 'px';
  drawingCanvas.style.left   = (-newOffX) + 'px';
  drawingCanvas.style.top    = (-newOffY) + 'px';

  // A drawing applied from a PNG (remote/loaded) whose true geometry may not have
  // been known when it was painted (load races background) is authoritative — repaint
  // it from source at the corrected geometry. Locally-drawn content (has strokes, or a
  // base flattened in a known geometry) just shifts by the pure pixel translation.
  if (drawingSourceURL && drawingStrokes.length === 0) {
    drawingBaseImage = null;
    paintSourceURL(drawingSourceURL);
    return;
  }
  if (oldBase) {
    const nb = document.createElement('canvas');
    nb.width = newW; nb.height = newH;
    nb.getContext('2d').drawImage(oldBase, dx, dy);
    drawingBaseImage = nb;
  }
  redrawAll();
}

// Paint a full-canvas PNG into a fresh base image at the current geometry, then redraw.
function paintSourceURL(dataURL) {
  const img = new Image();
  img.onload = () => {
    const b = document.createElement('canvas');
    b.width = drawW; b.height = drawH;
    b.getContext('2d').drawImage(img, 0, 0);
    drawingBaseImage = b;
    redrawAll();
  };
  img.onerror = () => {};
  img.src = dataURL;
}

/* ───── Pointer handlers (called from board.js) ───── */

function drawDown(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  canvasWrap.setPointerCapture(e.pointerId);
  drawActive = true;
  const pt = screenToDrawWorld(e.clientX, e.clientY);
  drawStartPt = pt;

  if (currentDrawTool === 'pen' || currentDrawTool === 'eraser') {
    drawCurrentPoints = [pt];
    applyFreehandSegment(pt, pt);
  } else {
    drawShapeSnapshot = document.createElement('canvas');
    drawShapeSnapshot.width  = drawW;
    drawShapeSnapshot.height = drawH;
    drawShapeSnapshot.getContext('2d').drawImage(drawingCanvas, 0, 0);
  }
}

function drawMove(e) {
  if (!drawActive) return;
  const pt = screenToDrawWorld(e.clientX, e.clientY);

  if (currentDrawTool === 'pen' || currentDrawTool === 'eraser') {
    const prev = drawCurrentPoints[drawCurrentPoints.length - 1];
    drawCurrentPoints.push(pt);
    applyFreehandSegment(prev, pt);
  } else {
    drawingCtx.setTransform(1, 0, 0, 1, 0, 0);
    drawingCtx.clearRect(0, 0, drawW, drawH);
    drawingCtx.drawImage(drawShapeSnapshot, 0, 0);
    drawingCtx.save();
    drawingCtx.setTransform(1, 0, 0, 1, drawOffX, drawOffY);
    drawShapeOnto(drawingCtx, currentDrawTool, drawStartPt, pt, currentDrawColor, currentDrawSize);
    drawingCtx.restore();
  }
}

function drawUp(e) {
  if (!drawActive) return;
  drawActive = false;
  const pt = screenToDrawWorld(e.clientX, e.clientY);

  let stroke = null;
  if (currentDrawTool === 'pen') {
    stroke = { type: 'pen', color: currentDrawColor, width: currentDrawSize, points: drawCurrentPoints };
  } else if (currentDrawTool === 'eraser') {
    stroke = { type: 'eraser', width: currentDrawSize, points: drawCurrentPoints };
  } else if (currentDrawTool === 'rect' || currentDrawTool === 'circle' || currentDrawTool === 'line') {
    stroke = {
      type:  currentDrawTool,
      color: currentDrawColor,
      width: currentDrawSize,
      x0: drawStartPt.x, y0: drawStartPt.y,
      x1: pt.x,          y1: pt.y,
    };
  }

  drawCurrentPoints = null;
  drawStartPt = null;
  drawShapeSnapshot = null;

  if (stroke) {
    pushStroke(stroke);                                    // local source of truth
    if (window.Sync) window.Sync.pushStroke(stroke);       // broadcast just this stroke
  }
}

/* ───── Stroke primitives ───── */

function applyFreehandSegment(a, b) {
  drawingCtx.save();
  drawingCtx.setTransform(1, 0, 0, 1, drawOffX, drawOffY);
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
  if (stroke.type === 'clear') {                 // pixel-space full-buffer wipe
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, drawW, drawH);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, drawOffX, drawOffY);   // world → pixel translation
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
  } else {
    drawShapeOnto(ctx, stroke.type,
      { x: stroke.x0, y: stroke.y0 },
      { x: stroke.x1, y: stroke.y1 },
      stroke.color, stroke.width);
  }
  ctx.restore();
}

function redrawAll() {
  drawingCtx.setTransform(1, 0, 0, 1, 0, 0);
  drawingCtx.clearRect(0, 0, drawW, drawH);
  if (drawingBaseImage) drawingCtx.drawImage(drawingBaseImage, 0, 0);
  for (const s of drawingStrokes) drawStrokeOnContext(drawingCtx, s);
}

// Append-only: a stroke is added and never removed mid-history (no undo). The only
// reset is clearDrawing(), which empties the whole list.
function pushStroke(stroke) {
  drawingStrokes.push(stroke);
}

/* ───── Clear ───── */

function clearDrawing() {
  drawingStrokes = [];
  drawingBaseImage = null;
  drawingSourceURL = null;
  drawingCtx.setTransform(1, 0, 0, 1, 0, 0);
  drawingCtx.clearRect(0, 0, drawW, drawH);
  if (window.Sync) window.Sync.clearDrawingStrokes();
}

/* ───── Remote apply (called by sync.js) ───── */

// A stroke arrived from another client: append it and draw just that stroke on
// top. Append-only means nothing below it changes, so no full redraw is needed.
function applyRemoteStroke(stroke) {
  if (!stroke || typeof stroke !== 'object') return;
  if (stroke.type === 'clear') { clearDrawingLocal(); return; }
  drawingStrokes.push(stroke);
  drawStrokeOnContext(drawingCtx, stroke);
}

// A remote Clear-All (or load): wipe local strokes and the canvas, no rebroadcast.
function clearDrawingLocal() {
  drawingStrokes = [];
  drawingBaseImage = null;
  drawingSourceURL = null;
  drawingCtx.setTransform(1, 0, 0, 1, 0, 0);
  drawingCtx.clearRect(0, 0, drawW, drawH);
}

/* ───── Save / Load hooks ───── */

// Save files store the stroke list directly (vector, compact) instead of a PNG.
function getDrawingStrokes() {
  return drawingStrokes.slice();
}

function setDrawingStrokes(strokes) {
  drawingStrokes = Array.isArray(strokes) ? strokes.slice() : [];
  drawingBaseImage = null;
  drawingSourceURL = null;
  redrawAll();
}

// Legacy load path: older save files stored the drawing as a full-canvas PNG.
function restoreDrawingFromDataURL(dataURL) {
  drawingStrokes = [];
  drawingBaseImage = null;
  drawingSourceURL = (dataURL && typeof dataURL === 'string') ? dataURL : null;
  drawingCtx.setTransform(1, 0, 0, 1, 0, 0);
  drawingCtx.clearRect(0, 0, drawW, drawH);
  // The canvas geometry is set from the background (restored separately). If the
  // background arrives after this, applyDrawingGeometry repaints the PNG at the corrected
  // geometry via paintSourceURL — so the drawing lines up regardless of arrival order.
  if (drawingSourceURL) paintSourceURL(drawingSourceURL);
}

/* ───── Init (keyboard shortcuts + initial color) ───── */

function initDrawing() {
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
