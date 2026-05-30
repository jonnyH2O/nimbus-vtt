/* ───────── Shared application state ─────────
   The board's data model that several modules read and mutate: the token
   registry and the view (camera) transform. initState() resets everything
   to defaults and is the first thing main.js calls on startup. */

let tokens;       // id → token data
let nextId;       // next token id to assign
let selectedId;   // currently selected token id, or null
let ctxTarget;    // token id targeted by the context menu, or null

const view = { x: 0, y: 0, zoom: 1 };

function initState() {
  tokens = {};
  nextId = 1;
  selectedId = null;
  ctxTarget = null;
  view.x = 0;
  view.y = 0;
  view.zoom = 1;
}
