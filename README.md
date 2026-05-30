## Features

### Board, pan & zoom
- **Infinite canvas** with smooth pan and zoom.
- **Pan** by dragging an empty area of the board with the left or middle mouse button.
- **Hold `Space`** to temporarily pan with any tool active, then release to return to your tool.
- **Zoom** with the mouse wheel, anchored to the point under the cursor (zoom range 0.15×–5×).
- **Auto fit-to-view** when a background image is loaded.
- A persistent **hint bar** shows context-appropriate controls.

### Tokens
- **Place tokens** with a custom name and color from the Tokens panel.
- **Upload a picture** for a token; an interactive **crop modal** lets you pan (drag) and zoom (scroll) to frame the image inside a circular mask before applying.
- **Drag tokens** around the board. A **pick-up animation** scales the token up and casts a drop shadow while dragging, so it looks like it's being lifted, then settles back on release.
- **Resize** a selected token by dragging its corner handle.
- **Select** a token by clicking it; click empty space to deselect.
- **Right-click context menu** per token: **Rename**, **Recolor**, **Change Picture**, and **Remove**.
- **Delete / Backspace** removes the selected token.
- **Clear All Tokens** wipes every token at once (from the background right-click menu).
- Token name labels and a movement badge are shown beneath each miniature.

### Grid
- **Define the grid** by clicking *Set Grid* and dragging out a single square cell — the grid scales itself from that one cell, so it matches any battle map.
- **Snap to Grid** toggle aligns tokens to cell centers when dragged.
- **Clear Grid** removes the grid (and any obstacles).

### Obstacles & walls
- **Add Obstacle Cells** mode lets you paint blocked cells by dragging across the grid.
- Painting toggles intelligently: starting on an empty cell adds obstacles, starting on a blocked cell erases them.
- Obstacles are rendered as an overlay and are respected by pathfinding.

### Pathfinding & movement
- Built-in **A\* pathfinder** runs live while you drag a token (with snap enabled).
- Uses **D&D-style 5-10-5 diagonal movement** — alternating diagonals cost 1/2/1/2… squares — for accurate distance counting.
- A **movement badge** on the token shows the path cost in spaces, or *blocked* when no path exists.
- The computed route is highlighted cell-by-cell, and **diagonal squeezing** between two blocked cells is prevented.

### Drawing layer
- Freehand and shape tools: **Pen**, **Rectangle**, **Circle**, **Line**, and **Eraser**.
- **Color** picker with quick swatches plus a full custom color input.
- Adjustable **brush size** (2–40 px).
- **Undo / Redo** with up to 50 steps of history.
- **Clear Drawing** wipes the layer.
- Drawing persists with save/load and sits between the grid and tokens.

### Backgrounds
- **Load a background image** via the board's right-click menu; the view auto-fits to it.
- **Rotate** the background in 90° increments.
- **Clear** the background to return to the solid theme color.
- Backgrounds are embedded in saves so a board is fully self-contained.

### Themes
Three hand-tuned visual themes, selectable from Settings and remembered between sessions (via `localStorage`):
- **Autumn Hearth** (default)
- **Midnight Nimbus**
- **Mist and Moss**

### Save & load
- **Save** exports the entire board to a `vtt-save.json` file, including tokens (with embedded images), grid configuration, obstacles, the background image, the drawing layer, and the current view.
- **Load** restores a saved board, rebuilding the scene piece by piece and tolerating missing or malformed fields.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` (hold) | Temporarily pan, overriding the active tool |
| `D` | Toggle the **draw** (pen) tool on/off |
| `E` | Toggle the **erase** tool on/off |
| `Ctrl`/`Cmd` + `Z` | Undo drawing |
| `Ctrl`/`Cmd` + `Shift` + `Z` / `Ctrl` + `Y` | Redo drawing |
| `Delete` / `Backspace` | Remove the selected token |
| `Esc` | Cancel grid-definition mode |

## Project structure

Plain HTML/CSS/vanilla JavaScript, split into focused modules:

| File | Responsibility |
| --- | --- |
| `index.html` | Markup, panels, menus, and modal |
| `css/style.css` | Theming and all styling |
| `js/main.js` | Entry point — initializes shared state then bootstraps every module in order |
| `js/state.js` | Shared application state (token registry + view transform) and `initState()` |
| `js/board.js` | View (pan/zoom), panels, themes, background context menu, global input |
| `js/tokens.js` | Token spawn/drag/resize, context menu, picture upload & crop |
| `js/grid.js` | Grid definition, snap math, cell/world conversions, obstacles |
| `js/pathfinding.js` | A\* pathfinder with 5-10-5 movement and path rendering |
| `js/drawing.js` | Drawing layer: tools, color/size, undo/redo, shortcuts |
| `js/background.js` | Background image load/clear/rotate and serialization |
| `js/saveload.js` | JSON export/import of the full board state |

Each module that needs setup exposes a global `init*()` function; `js/main.js` is loaded last and calls them in a fixed order (`initState → initBoard → initTokens → initGrid → initDrawing → initBackground → initSaveLoad`), then lays out the opening scene.

## License

No license file is currently included.
