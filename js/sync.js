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

function listenTokens() {
  let prevIds = new Set();
  onValue(pathRef('tokens'), snap => {
    const val = snap.val() || {};
    const curIds = new Set();
    let maxId = 0;
    for (const key in val) {
      const t = val[key];
      if (!t || typeof t !== 'object') continue;
      const id = Number(t.id);
      if (!Number.isFinite(id)) continue;
      curIds.add(id);
      if (id > maxId) maxId = id;
      if (t._by === clientId) continue;            // our own write — skip
      if (window.upsertRemoteToken) window.upsertRemoteToken(t);
    }
    // Tokens that were in the room before but are gone now → remove locally.
    for (const id of prevIds) {
      if (!curIds.has(id) && window.removeTokenLocal) window.removeTokenLocal(id);
    }
    prevIds = curIds;
    if (window.bumpNextId) window.bumpNextId(maxId + 1);
  }, err => console.warn('[sync] tokens listener:', err));
}

function listenGrid() {
  onValue(pathRef('grid'), snap => {
    const g = snap.val();
    if (g && g._by === clientId) return;
    if (window.applyRemoteGrid) window.applyRemoteGrid(g);
    // setGrid() wipes obstacles, so re-apply the last known set afterwards.
    if (window.applyRemoteObstacles) window.applyRemoteObstacles(lastObstacles);
  }, err => console.warn('[sync] grid listener:', err));
}

function listenObstacles() {
  onValue(pathRef('obstacles'), snap => {
    const o = snap.val();
    lastObstacles = (o && Array.isArray(o.cells)) ? o.cells : [];
    if (o && o._by === clientId) return;
    if (window.applyRemoteObstacles) window.applyRemoteObstacles(lastObstacles);
  }, err => console.warn('[sync] obstacles listener:', err));
}

function listenBackground() {
  onValue(pathRef('background'), snap => {
    const b = snap.val();
    if (b && b._by === clientId) return;
    if (window.applyRemoteBackground) window.applyRemoteBackground(b ? b.data : null);
  }, err => console.warn('[sync] background listener:', err));
}

function listenDrawing() {
  onValue(pathRef('drawing'), snap => {
    const d = snap.val();
    if (d && d._by === clientId) return;
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

/* ───────── Bridge to the classic (non-module) scripts ───────── */

if (typeof window !== 'undefined') {
  window.Sync = {
    initSync, pushToken, removeToken,
    pushGrid, pushBackground, pushDrawing, pushObstacles
  };
}
