# Canvas / maps / whiteboards

Figma, Google Maps, Miro, tldraw — anything that renders to `<canvas>`. The
entire UI is one element from the AX tree's perspective.

## Symptom

- `snapshot -ic` shows a single `canvas` node and nothing else useful.
- No refs for the things you can clearly see (pins, shapes, buttons drawn on
  the canvas).

## Recipe

Coordinate clicks, full stop.

```bash
agent-chrome screenshot --grid
# read target coords off the overlaid grid
agent-chrome click 612 340
```

For multi-step interactions (drag to pan a map, select a shape), use the raw
CDP mouse events:

```bash
agent-chrome cdp Input.dispatchMouseEvent --params '{"type":"mousePressed","x":500,"y":400,"button":"left","clickCount":1}'
agent-chrome cdp Input.dispatchMouseEvent --params '{"type":"mouseMoved","x":700,"y":400,"button":"left"}'
agent-chrome cdp Input.dispatchMouseEvent --params '{"type":"mouseReleased","x":700,"y":400,"button":"left","clickCount":1}'
```

## Gotcha

Text inside the canvas is rendered — not text in the DOM. `eval` can't read
it. Take a screenshot and describe what you see; don't try to query it.

Many of these apps have a keyboard-driven command palette (Cmd+/, Cmd+K).
When one exists, prefer it:

```bash
agent-chrome press "Meta+K"
agent-chrome type @eN "zoom to fit"
agent-chrome press Enter
```
