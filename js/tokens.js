const tokenLayer = document.getElementById('token-layer');
const ctxMenu    = document.getElementById('ctx-menu');
const hint       = document.getElementById('hint');

let tokens = {};
let nextId = 1;
let selectedId = null;
let ctxTarget = null;
let tokenType = 'hero';

const ICONS = { hero: '🧙', enemy: '💀' };

function setType(t) {
  tokenType = t;
  document.getElementById('btn-hero').classList.toggle('active', t === 'hero');
  document.getElementById('btn-enemy').classList.toggle('active', t === 'enemy');
}

function addToken() {
  const name  = document.getElementById('name-input').value.trim() || (tokenType === 'hero' ? 'Hero' : 'Enemy');
  const color = document.getElementById('token-color').value;
  const wrap  = document.getElementById('canvas-wrap');
  const x = wrap.clientWidth  / 2 + (Math.random() - 0.5) * 140;
  const y = wrap.clientHeight / 2 + (Math.random() - 0.5) * 100;
  spawnToken({ id: nextId++, name, color, type: tokenType, x, y, size: 54 });
  hint.style.display = 'none';
}

function spawnToken(data) {
  const { id, name, color, type, x, y, size } = data;
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
  ring.style.background = color;

  const icon = document.createElement('div');
  icon.className = 'token-icon';
  icon.textContent = ICONS[type] || '●';
  icon.style.fontSize = (size * 0.42) + 'px';

  const label = document.createElement('div');
  label.className = 'token-label';
  label.textContent = name;

  const handle = document.createElement('div');
  handle.className = 'resize-handle';
  handle.title = 'Drag to resize';

  ring.appendChild(icon);
  el.appendChild(ring);
  el.appendChild(label);
  el.appendChild(handle);
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

  el.addEventListener('pointerdown', e => {
    if (e.target.classList.contains('resize-handle')) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    ox = e.clientX - tokens[id].x;
    oy = e.clientY - tokens[id].y;
    dragging = true;
    select(id);
  });

  el.addEventListener('pointermove', e => {
    if (!dragging) return;
    const x = e.clientX - ox;
    const y = e.clientY - oy;
    tokens[id].x = x;
    tokens[id].y = y;
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
  });

  el.addEventListener('pointerup',    () => { dragging = false; });
  el.addEventListener('pointercancel',() => { dragging = false; });
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
    const newSize = Math.max(28, Math.min(130, startSize + (e.clientX - startX)));
    tokens[id].size = newSize;
    const ring = el.querySelector('.token-ring');
    ring.style.width  = newSize + 'px';
    ring.style.height = newSize + 'px';
    ring.querySelector('.token-icon').style.fontSize = (newSize * 0.42) + 'px';
  });

  handle.addEventListener('pointerup',    () => { active = false; });
  handle.addEventListener('pointercancel',() => { active = false; });
}

function showCtx(e, id) {
  select(id);
  ctxTarget = id;
  ctxMenu.style.display = 'block';
  ctxMenu.style.left = Math.min(e.clientX, window.innerWidth  - 160) + 'px';
  ctxMenu.style.top  = Math.min(e.clientY, window.innerHeight - 130) + 'px';
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
    if (el) el.querySelector('.token-ring').style.background = inp.value;
  });
  inp.addEventListener('blur', () => { try { document.body.removeChild(inp); } catch(e) {} });
}

function ctxToggleType() {
  hideCtx();
  if (ctxTarget == null) return;
  const t = tokens[ctxTarget];
  t.type = t.type === 'hero' ? 'enemy' : 'hero';
  const el = tokenLayer.querySelector(`[data-id="${ctxTarget}"]`);
  if (el) el.querySelector('.token-icon').textContent = ICONS[t.type];
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
