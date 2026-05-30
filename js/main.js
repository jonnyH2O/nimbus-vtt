/* ───────── Application entry point ─────────
   Loaded last (after every module's functions are defined). It owns nothing
   but orchestration: initialize shared state, bootstrap each module in a
   fixed order, then lay out the opening demo scene.

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

  // Opening scene: a few demo tokens + the default hint text.
  spawnToken({ id: nextId++, name: 'Aldric',  color: '#2a6aaa', x: 220, y: 240, size: 54 });
  spawnToken({ id: nextId++, name: 'Lyria',   color: '#7a3aaa', x: 320, y: 300, size: 54 });
  spawnToken({ id: nextId++, name: 'Goblin',  color: '#882222', x: 580, y: 240, size: 54 });
  spawnToken({ id: nextId++, name: 'Troll',   color: '#554422', x: 660, y: 340, size: 70 });
  restoreHint();
})();
