/* ───────── Application entry point ─────────
   Loaded last (after every module's functions are defined). It owns nothing
   but orchestration: initialize shared state and bootstrap each module in a
   fixed order, then connect multiplayer.

   All scripts are classic (non-module) and share one global scope, so each
   init*() is a plain global function defined in its own module file. */

(function main() {
  initState();
  initBoard();
  initTokens();
  initGrid();
  initDrawing();
  initBackground();
  initSaveLoad();

  // The board starts empty (the shared room is the source of truth); show the
  // default hint until tokens arrive.
  restoreHint();

  // Real-time multiplayer (optional). sync.js is an ES module loaded last via
  // dynamic import so a blocked Firebase CDN or empty config can never break
  // local play — by the time this runs the app is already fully initialized.
  // The URL is resolved against the document base so it works under Live
  // Server and GitHub Pages project sites (e.g. /<repo>/) alike.
  const syncUrl = new URL('js/sync.js', document.baseURI).href;
  import(syncUrl)
    .then(mod => mod.initSync())
    .catch(err => console.warn('[sync] multiplayer disabled:', err));
})();
