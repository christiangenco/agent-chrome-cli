# Plan: Coordinate Clicks + Grid Screenshots

## Context

`agent-chrome-cli` currently resolves clicks via `@eN` refs pulled from an accessibility snapshot. Refs fail in several common situations:

- Elements inside `<iframe>` (AX tree stops at the boundary)
- Canvas-based UIs (Figma, maps, whiteboards)
- Shadow DOM components that don't expose accessibility nodes
- Custom dropdowns/comboboxes that render options outside the AX tree of the trigger

`browser-harness` sidesteps all of this by dispatching raw mouse events at `(x, y)` via `Input.dispatchMouseEvent`. Coordinate clicks pass through iframes, shadow DOM, and cross-origin content at the compositor level — the same path a real user's mouse takes.

The challenge: agents need a way to *find* the coordinates. Two complementary tools solve it — a coordinate grid overlay, and x,y coordinates in `--annotate` output.

## Scope

Add coordinate-based interactions as an escape hatch alongside (not replacing) the existing ref-based system.

## Changes

### 1. New: `click <x> <y>` (positional form)

Extend `src/actions.js` with a coordinate-click path that dispatches `Input.dispatchMouseEvent` directly:

```js
export async function clickAt(client, x, y, { button = 'left', clicks = 1 } = {}) {
  await client.Input.dispatchMouseEvent({ type: 'mousePressed',  x, y, button, clickCount: clicks });
  await client.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button, clickCount: clicks });
  return { x, y };
}
```

In `bin/agent-chrome.js`, update `cmdClick`:

```js
async function cmdClick(client, targetId) {
  const a = restArgs[0];
  const b = restArgs[1];

  // Coordinate form: click <x> <y>
  if (a && b && /^-?\d+$/.test(a) && /^-?\d+$/.test(b)) {
    const { x, y } = await actions.clickAt(client, parseInt(a, 10), parseInt(b, 10));
    console.log(`✓ Clicked at (${x}, ${y})`);
    return;
  }

  // Ref form: click @eN
  requireArg(a, 'click', '@eN | <x> <y>');
  const result = await actions.click(client, port, targetId, a, agentId);
  console.log(`✓ Clicked ${result.role} "${result.name || ''}"`);
}
```

Help text updates to show both forms:
```
click @eN                     Click element by ref
click <x> <y>                 Click at viewport coordinates
```

Consider parallel additions for `hover <x> <y>` (lower priority — add only if it comes up naturally). `press` already works without a target and needs no change.

### 2. New: `screenshot --grid [N]`

Overlays a coordinate grid on the captured PNG. Implemented in `src/screenshot.js` after the existing capture, using `sharp` (already a transitive dep of nothing in the repo today — evaluate adding it) OR plain Canvas via `canvas` npm package OR a pure-pixel approach.

**Preferred approach: do it in the browser before capture, so no new deps.**

Inject a transient overlay `<div>` via `Runtime.evaluate`, capture, then remove it:

```js
async function injectGrid(client, spacing = 50) {
  const js = `
    (() => {
      if (document.getElementById('__ac_grid__')) return;
      const vw = window.innerWidth, vh = window.innerHeight;
      const sp = ${spacing};
      const svg = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="' + vw + '" height="' + vh + '" style="position:fixed;inset:0;z-index:2147483647;pointer-events:none;opacity:0.55">'
      ];
      // vertical lines + x labels
      for (let x = 0; x <= vw; x += sp) {
        svg.push('<line x1="'+x+'" y1="0" x2="'+x+'" y2="'+vh+'" stroke="#ff3860" stroke-width="1"/>');
        svg.push('<text x="'+(x+2)+'" y="10" fill="#ff3860" font-size="10" font-family="monospace">'+x+'</text>');
      }
      // horizontal lines + y labels
      for (let y = 0; y <= vh; y += sp) {
        svg.push('<line x1="0" y1="'+y+'" x2="'+vw+'" y2="'+y+'" stroke="#ff3860" stroke-width="1"/>');
        svg.push('<text x="2" y="'+(y+10)+'" fill="#ff3860" font-size="10" font-family="monospace">'+y+'</text>');
      }
      svg.push('</svg>');
      const d = document.createElement('div');
      d.id = '__ac_grid__';
      d.innerHTML = svg.join('');
      document.documentElement.appendChild(d);
    })();
  `;
  await client.Runtime.evaluate({ expression: js });
}

async function removeGrid(client) {
  await client.Runtime.evaluate({
    expression: `document.getElementById('__ac_grid__')?.remove()`
  });
}
```

In `screenshot.js`, when `options.grid` is truthy:
1. `injectGrid(client, gridSize)`
2. Capture as usual
3. `removeGrid(client)` in a `finally` so we never leave grids behind on errors

Caveats to document:
- Grid lives in the page's DOM briefly (~50ms). On fullscreen games or apps that track DOM mutations this could fire listeners — fine for debugging, not for production monitoring.
- With `--full`, the viewport-fixed SVG only covers viewport portion. For full-page grid, compute `document.documentElement.scrollWidth/scrollHeight` instead and use `position:absolute`.

CLI wiring in `bin/agent-chrome.js` `cmdScreenshot`:

```js
const gridIdx = restArgs.findIndex(a => a === '--grid' || a.startsWith('--grid='));
let grid = false, gridSize = 50;
if (gridIdx !== -1) {
  grid = true;
  const inline = restArgs[gridIdx].startsWith('--grid=') ? restArgs[gridIdx].split('=')[1] : null;
  const next = restArgs[gridIdx + 1];
  if (inline) gridSize = parseInt(inline, 10);
  else if (next && /^\d+$/.test(next)) gridSize = parseInt(next, 10);
}
```

Pass `{ grid, gridSize }` through to `screenshot()`.

Help text:
```
screenshot --grid [N]         Overlay coordinate grid (default 50px spacing)
```

### 3. Extend `screenshot --annotate` to print x,y

Currently `--annotate` output looks like:
```
@e5  button "Sign in"
@e7  link "Settings"
```

After change:
```
@e5  button "Sign in"       (340, 412)
@e7  link "Settings"        (1120, 48)
```

The annotation collection already computes each element's bounding rect to place the numbered label — just include the center `(x, y)` of that rect in the returned `annotations` array and print it alongside role/name in `cmdScreenshot`.

This lets an agent do `screenshot --annotate` once and then either `click @e5` or `click 340 412` depending on which feels more reliable.

### 4. Help + README + AGENTS.md

- Update `--help` in `bin/agent-chrome.js` with the new forms.
- Update `README.md` "Interactions" table with `click <x> <y>`.
- Update `README.md` "Info" table with `screenshot --grid [N]`.
- Add a short note in AGENTS.md pointing agents to coordinate clicks as the escape hatch for iframes/shadow DOM.

## Testing

```bash
# Coordinate clicks
agent-chrome tab new "https://example.com"
agent-chrome --tab t2 click 100 100   # Clicks viewport (100, 100)

# Grid screenshot
agent-chrome --tab t2 screenshot --grid
agent-chrome --tab t2 screenshot --grid 100  # Coarser grid
agent-chrome --tab t2 screenshot --grid --full

# Annotate with coords
agent-chrome --tab t2 screenshot --annotate
# Output should include "(x, y)" alongside each @eN

# Verify grid overlay is removed after capture
agent-chrome --tab t2 eval "document.getElementById('__ac_grid__')"
# → null

# Iframe/shadow DOM sanity check (manual): open any site with an embedded iframe,
# take a grid screenshot, coordinate-click something inside the iframe, verify it
# actually clicked.
```

## Out of scope

- `hover <x> <y>`, `scroll-at <x> <y>` — add only if they come up in real use.
- Image-based grid overlay (post-capture) using `sharp`/`canvas` — revisit if the in-page SVG approach causes issues with specific sites.
- Annotating beyond the viewport when `--full` is set — v1 only labels elements visible in the initial viewport.
