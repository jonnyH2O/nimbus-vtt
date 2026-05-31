/* ───────── Real-time multiplayer sync (Firebase Realtime Database) ─────────
   This is the only ES-module file in the project. The rest of the app is
   classic scripts sharing one global scope, so this module:
     • imports Firebase from the CDN and exports a small push/init API, AND
     • mirrors that API onto window.Sync so the classic modules can call it.

   It is loaded by main.js via a guarded dynamic import(), so if the Firebase
   CDN is blocked or the config is empty/invalid, the app keeps working
   locally as a single-player tool — every entry point fails soft. */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, onValue, remove } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

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
  listenDrawing();
  console.info('[sync] connected. room:', roomId, 'client:', clientId);
}

/* Every listener applies its FIRST snapshot unconditionally (hydration), then
   suppresses our own `_by === clientId` echoes. This matters on reload: the
   clientId persists in sessionStorage but local state is gone, so without
   hydration we'd skip our own data forever and the board would look wiped. */

function listenTokens() {
  let hydrated = false;
  onValue(pathRef('tokens'), snap => {
    const map = snap.val() || {};
    const curIds = new Set();
    let maxId = 0;
    for (const key in map) {
      const t = map[key];
      if (!t || typeof t !== 'object') continue;
      const id = Number(t.id);
      if (!Number.isFinite(id)) continue;
      curIds.add(id);
      if (id > maxId) maxId = id;
      if (hydrated && t._by === clientId) continue;   // our own live echo — skip
      if (window.upsertRemoteToken) window.upsertRemoteToken(t);
    }
    // Room is authoritative: drop any LOCAL token that isn't in the snapshot.
    // This is what makes a loaded board (or a remote delete) clear leftover
    // tokens everywhere — including local-only ones that were never pushed.
    if (window.getLocalTokenIds && window.removeTokenLocal) {
      for (const id of window.getLocalTokenIds()) {
        if (!curIds.has(id)) window.removeTokenLocal(id);
      }
    }
    hydrated = true;
    if (window.bumpNextId) window.bumpNextId(maxId + 1);
  }, err => console.warn('[sync] tokens listener:', err));
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

function listenDrawing() {
  let hydrated = false;
  onValue(pathRef('drawing'), snap => {
    const d = snap.val();
    if (hydrated && d && d._by === clientId) return;
    hydrated = true;
    if (window.restoreDrawingFromDataURL) window.restoreDrawingFromDataURL(d ? d.data : null);
  }, err => console.warn('[sync] drawing listener:', err));
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

export function pushDrawing(base64) {
  if (!ready()) return;
  if (base64) set(pathRef('drawing'), { data: base64, _by: clientId }).catch(warn);
  else        remove(pathRef('drawing')).catch(warn);
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
  set(ref(db, 'rooms/' + roomId), {
    tokens:     tokensObj,
    grid:       state.grid ? { ...state.grid, _by: clientId } : null,
    obstacles:  { cells: state.obstacles || [], _by: clientId },
    background: state.background ? { data: state.background, _by: clientId } : null,
    drawing:    state.drawing ? { data: state.drawing, _by: clientId } : null
  }).catch(warn);
}

/* True only when actually connected to a room (lets callers prompt before a
   destructive room-wide write, but stay silent when offline/single-player). */
export function isConnected() { return ready(); }

/* ───────── Bridge to the classic (non-module) scripts ───────── */

if (typeof window !== 'undefined') {
  window.Sync = {
    initSync, pushToken, removeToken,
    pushGrid, pushBackground, pushDrawing, pushObstacles,
    pushFullState, isConnected
  };
}
