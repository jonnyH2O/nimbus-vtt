/* ───────── Real-time multiplayer sync (Firebase Realtime Database) ─────────
   This is the only ES-module file in the project. The rest of the app is
   classic scripts sharing one global scope, so this module:
     • imports Firebase from the CDN and exports a small push/init API, AND
     • mirrors that API onto window.Sync so the classic modules can call it.

   It is loaded by main.js via a guarded dynamic import(), so if the Firebase
   CDN is blocked or the config is empty/invalid, the app keeps working
   locally as a single-player tool — every entry point fails soft. */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, onValue, remove, push, get,
         onChildAdded, onChildChanged, onChildRemoved } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBgL5KT9_sUoU2X-E-_eojSM7IYjm4cSL0",
  authDomain: "vtt-app-1e6b2.firebaseapp.com",
  databaseURL: "https://vtt-app-1e6b2-default-rtdb.firebaseio.com",
  projectId: "vtt-app-1e6b2",
  storageBucket: "vtt-app-1e6b2.firebasestorage.app",
  messagingSenderId: "429664567515",
  appId: "1:429664567515:web:c766880f8c385fb9014cfe"
};

let db = null;
let roomId = null;
const clientId = getClientId();
let lastObstacles = [];   // cached so re-applying the grid can restore them

/* ───────── Identity + room ───────── */

function getClientId() {
  let id = null;
  try { id = sessionStorage.getItem('vtt-client-id'); } catch (_) {}
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    try { sessionStorage.setItem('vtt-client-id', id); } catch (_) {}
  }
  return id;
}

function genRoomId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/* Returns the room id, or null if it had to redirect (page is reloading). */
function resolveRoom() {
  const params = new URLSearchParams(location.search);
  const existing = params.get('room');
  if (existing) return existing;
  params.set('room', genRoomId());
  // replace() keeps the no-room URL out of history; the reload re-runs init.
  location.replace(location.pathname + '?' + params.toString() + location.hash);
  return null;
}

function pathRef(sub) { return ref(db, `rooms/${roomId}/${sub}`); }
function warn(err) { console.warn('[sync] write failed:', err); }
function ready() { return !!db && !!roomId; }

/* ───────── Init + listeners ───────── */

export function initSync() {
  roomId = resolveRoom();
  if (!roomId) return;                 // redirecting to ?room=… ; bail out

  if (!firebaseConfig.databaseURL) {
    console.info('[sync] no Firebase config — running locally. Room:', roomId);
    return;
  }

  try {
    const app = initializeApp(firebaseConfig);
    db = getDatabase(app);
  } catch (err) {
    console.warn('[sync] Firebase init failed — running locally:', err);
    db = null;
    return;
  }

  listenTokens();
  listenGrid();
  listenObstacles();
  listenBackground();
  listenStrokes();
  console.info('[sync] connected. room:', roomId, 'client:', clientId);
}

/* Every listener applies its FIRST snapshot unconditionally (hydration), then
   suppresses our own `_by === clientId` echoes. This matters on reload: the
   clientId persists in sessionStorage but local state is gone, so without
   hydration we'd skip our own data forever and the board would look wiped. */

/* Per-child token listeners: a single token change downloads only that token,
   not the whole collection. child_removed handles deletes individually (a loaded
   board / full-state replace drops stale tokens via removed + added). The hydrate
   guard mirrors the old listener: apply our own data while hydrating (so a reload
   rebuilds the board), then suppress our own live echoes. */
function listenTokens() {
  let hydrated = false;
  const tokensRef = pathRef('tokens');
  const apply = t => {
    if (!t || typeof t !== 'object') return;
    const id = Number(t.id);
    if (!Number.isFinite(id)) return;
    if (window.bumpNextId) window.bumpNextId(id + 1);
    if (window.upsertRemoteToken) window.upsertRemoteToken(t);
  };
  onChildAdded(tokensRef, snap => {
    const t = snap.val();
    if (hydrated && t && t._by === clientId) return;   // our own creation echo
    apply(t);
  }, err => console.warn('[sync] token added:', err));
  onChildChanged(tokensRef, snap => {
    const t = snap.val();
    if (t && t._by === clientId) return;               // our own live drag/edit echo
    apply(t);
  }, err => console.warn('[sync] token changed:', err));
  onChildRemoved(tokensRef, snap => {
    const t = snap.val();
    const id = t ? Number(t.id) : NaN;
    if (Number.isFinite(id) && window.removeTokenLocal) window.removeTokenLocal(id);
  }, err => console.warn('[sync] token removed:', err));
  get(tokensRef).then(() => { hydrated = true; }).catch(() => { hydrated = true; });
}

function listenGrid() {
  let hydrated = false;
  onValue(pathRef('grid'), snap => {
    const g = snap.val();
    if (hydrated && g && g._by === clientId) return;
    hydrated = true;
    if (window.applyRemoteGrid) window.applyRemoteGrid(g);
    // setGrid() wipes obstacles, so re-apply the last known set afterwards.
    if (window.applyRemoteObstacles) window.applyRemoteObstacles(lastObstacles);
  }, err => console.warn('[sync] grid listener:', err));
}

function listenObstacles() {
  let hydrated = false;
  onValue(pathRef('obstacles'), snap => {
    const o = snap.val();
    lastObstacles = (o && Array.isArray(o.cells)) ? o.cells : [];
    if (hydrated && o && o._by === clientId) return;
    hydrated = true;
    if (window.applyRemoteObstacles) window.applyRemoteObstacles(lastObstacles);
  }, err => console.warn('[sync] obstacles listener:', err));
}

function listenBackground() {
  let hydrated = false;
  onValue(pathRef('background'), snap => {
    const b = snap.val();
    if (hydrated && b && b._by === clientId) return;
    hydrated = true;
    if (window.applyRemoteBackground) window.applyRemoteBackground(b ? b.data : null);
  }, err => console.warn('[sync] background listener:', err));
}

/* Drawing is an append-only stream of strokes under drawing/strokes. Each new
   stroke arrives as one small child; Clear-All removes the whole node. The only
   removal is a clear, so any child_removed means "wipe". */
function listenStrokes() {
  let hydrated = false;
  const strokesRef = pathRef('drawing/strokes');
  onChildAdded(strokesRef, snap => {
    const s = snap.val();
    if (!s || typeof s !== 'object') return;
    // Our own live stroke is already on the local canvas — skip its echo so it
    // isn't appended twice. On reload (hydrated still false) we DO apply our own,
    // since local state is empty and the room is the source of truth.
    if (hydrated && s._by === clientId) return;
    if (window.applyRemoteStroke) window.applyRemoteStroke(s);
  }, err => console.warn('[sync] strokes added:', err));
  onChildRemoved(strokesRef, () => {
    if (window.clearDrawingLocal) window.clearDrawingLocal();
  }, err => console.warn('[sync] strokes removed:', err));
  // Initial children fire child_added before get() resolves, so flipping the echo
  // guard here means hydration strokes apply, then our own live strokes are skipped.
  get(strokesRef).then(() => { hydrated = true; }).catch(() => { hydrated = true; });
}

/* ───────── Push API (writes to Firebase immediately) ───────── */

export function pushToken(token) {
  if (!ready() || !token || token.id == null) return;
  set(pathRef('tokens/' + token.id), { ...token, _by: clientId }).catch(warn);
}

export function removeToken(id) {
  if (!ready() || id == null) return;
  remove(pathRef('tokens/' + id)).catch(warn);
}

export function pushGrid(gridState) {
  if (!ready() || !gridState) return;
  set(pathRef('grid'), { ...gridState, _by: clientId }).catch(warn);
}

export function pushBackground(base64) {
  if (!ready()) return;
  if (base64) set(pathRef('background'), { data: base64, _by: clientId }).catch(warn);
  else        remove(pathRef('background')).catch(warn);
}

// Append one stroke to the room (tiny delta — no full-canvas re-upload).
export function pushStroke(stroke) {
  if (!ready() || !stroke || typeof stroke !== 'object') return;
  push(pathRef('drawing/strokes'), { ...stroke, _by: clientId }).catch(warn);
}

// Clear-All wipes the whole stroke stream in one delete.
export function clearDrawingStrokes() {
  if (!ready()) return;
  remove(pathRef('drawing/strokes')).catch(warn);
}

export function pushObstacles(obstacles) {
  if (!ready()) return;
  set(pathRef('obstacles'), { cells: obstacles || [], _by: clientId }).catch(warn);
}

/* Replace the entire room in one atomic write. Used when a local save file is
   loaded so every connected client adopts the loaded board — and any stale
   tokens / drawing / background left in the room are dropped, not merged.
   `view` is intentionally omitted: the camera is per-person, not shared. */
export function pushFullState(state) {
  if (!ready() || !state) return;
  const tokensObj = {};
  for (const t of (state.tokens || [])) {
    if (t && t.id != null) tokensObj[t.id] = { ...t, _by: clientId };
  }
  // Drawing is now a stroke stream: rebuild drawing/strokes with fresh push keys
  // so order is preserved and remote clients hydrate via child_added.
  const strokesObj = {};
  for (const s of (state.drawing || [])) {
    if (s && typeof s === 'object') {
      strokesObj[push(pathRef('drawing/strokes')).key] = { ...s, _by: clientId };
    }
  }
  set(ref(db, 'rooms/' + roomId), {
    tokens:     tokensObj,
    grid:       state.grid ? { ...state.grid, _by: clientId } : null,
    obstacles:  { cells: state.obstacles || [], _by: clientId },
    background: state.background ? { data: state.background, _by: clientId } : null,
    drawing:    Object.keys(strokesObj).length ? { strokes: strokesObj } : null
  }).catch(warn);
}

/* True only when actually connected to a room (lets callers prompt before a
   destructive room-wide write, but stay silent when offline/single-player). */
export function isConnected() { return ready(); }

/* The current room id. Set by resolveRoom() during init (even when Firebase is
   offline), so the UI can show/copy it regardless of connection state. */
export function getRoomId() { return roomId; }

/* ───────── Bridge to the classic (non-module) scripts ───────── */

if (typeof window !== 'undefined') {
  window.Sync = {
    initSync, pushToken, removeToken,
    pushGrid, pushBackground, pushStroke, clearDrawingStrokes, pushObstacles,
    pushFullState, isConnected, getRoomId
  };
}
