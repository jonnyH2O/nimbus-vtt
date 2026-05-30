/* ───────── A* on the grid with 5-10-5 alternating-diagonal cost ─────────
   Reads gridCellSize, gridOriginX/Y, obstacles (and uses isBlocked / cellCenter)
   from board.js. Called by the token drag handler in tokens.js. */

const PATH_NEIGHBORS = [
  [-1,-1],[ 0,-1],[ 1,-1],
  [-1, 0],        [ 1, 0],
  [-1, 1],[ 0, 1],[ 1, 1]
];

/* 5-10-5 admissible heuristic: best-case alternating diagonals starting at cost 1.
   For dx,dy with lo = min, hi = max: lo diagonals + (hi - lo) straights.
   Best diagonal sum starting at parity 0 = lo + floor(lo/2).
   Total = (hi - lo) + lo + floor(lo/2) = hi + floor(lo/2). */
function pathHeuristic(ax, ay, bx, by) {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  const lo = Math.min(dx, dy);
  const hi = Math.max(dx, dy);
  return hi + Math.floor(lo / 2);
}

function findPath(start, goal) {
  if (start.x === goal.x && start.y === goal.y) {
    return { cells: [{ x: start.x, y: start.y }], cost: 0 };
  }
  if (isBlocked(goal.x, goal.y)) return null;

  const stateKey = (x, y, dp) => x + ',' + y + ',' + dp;
  const open = [];
  const gScore = new Map();
  const cameFrom = new Map();

  const sKey = stateKey(start.x, start.y, 0);
  gScore.set(sKey, 0);
  open.push({
    x: start.x, y: start.y, dp: 0, g: 0,
    f: pathHeuristic(start.x, start.y, goal.x, goal.y)
  });

  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bi].f) bi = i;
    }
    const cur = open.splice(bi, 1)[0];
    const curKey = stateKey(cur.x, cur.y, cur.dp);
    if (cur.g > gScore.get(curKey)) continue; // stale

    if (cur.x === goal.x && cur.y === goal.y) {
      const cells = [{ x: cur.x, y: cur.y }];
      let k = curKey;
      while (cameFrom.has(k)) {
        const p = cameFrom.get(k);
        cells.unshift({ x: p.x, y: p.y });
        k = p.k;
      }
      return { cells, cost: cur.g };
    }

    for (const [dx, dy] of PATH_NEIGHBORS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (isBlocked(nx, ny)) continue;
      const isDiag = dx !== 0 && dy !== 0;
      // Prevent diagonal squeeze through two adjacent blocked cells
      if (isDiag && isBlocked(cur.x + dx, cur.y) && isBlocked(cur.x, cur.y + dy)) continue;

      let stepCost, newDp;
      if (isDiag) {
        stepCost = cur.dp === 0 ? 1 : 2;
        newDp = 1 - cur.dp;
      } else {
        stepCost = 1;
        newDp = cur.dp;
      }
      const tentG = cur.g + stepCost;
      const nKey = stateKey(nx, ny, newDp);
      if (tentG < (gScore.get(nKey) ?? Infinity)) {
        gScore.set(nKey, tentG);
        cameFrom.set(nKey, { k: curKey, x: cur.x, y: cur.y });
        open.push({
          x: nx, y: ny, dp: newDp, g: tentG,
          f: tentG + pathHeuristic(nx, ny, goal.x, goal.y)
        });
      }
    }
  }
  return null;
}

/* ───────── Path highlight rendering ───────── */

const pathLayer = document.getElementById('path-layer');

function showPath(cells) {
  pathLayer.innerHTML = '';
  if (!gridCellSize) return;
  for (const c of cells) {
    const ctr = cellCenter(c.x, c.y);
    const div = document.createElement('div');
    div.className = 'path-cell';
    div.style.left   = (ctr.x - gridCellSize / 2) + 'px';
    div.style.top    = (ctr.y - gridCellSize / 2) + 'px';
    div.style.width  = gridCellSize + 'px';
    div.style.height = gridCellSize + 'px';
    pathLayer.appendChild(div);
  }
}
function clearPath() { pathLayer.innerHTML = ''; }
