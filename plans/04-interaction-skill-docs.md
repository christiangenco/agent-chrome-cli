# Plan: Interaction Skill Docs

## Context

`browser-harness` ships two parallel doc trees: `interaction-skills/` (generic
mechanics — dialogs, uploads, shadow DOM, iframes, scrolling) and `domain-skills/`
(site-specific knowledge — LinkedIn, Amazon, etc.). Agents are instructed to
search those before inventing a new approach, which eliminates most of the
"figure it out again every session" tax.

`agent-chrome-cli` has a `README.md` and `AGENTS.md` but no equivalent short
notes for the handful of UI mechanics that reliably trip agents up. These notes
are cheap to write and pay off the first time the agent hits the pattern.

## Scope

A new `docs/` directory with short (≤ 60 line) markdown notes — one per sticky
UI mechanic. Agents read them on demand, not as part of every session.

## Layout

```
docs/
  README.md               # Index + when-to-read guidance
  dialogs.md              # (written in plan 03)
  iframes.md              # (written in plan 05)
  shadow-dom.md
  dropdowns.md
  uploads.md
  scrolling.md
  canvas-and-maps.md
```

Two of these (`dialogs.md`, `iframes.md`) land in other plans. The remaining
five are this plan.

## What each file should contain

Keep each one focused on:

1. **Symptom** — how the agent recognizes this situation
2. **Why it's hard** — one sentence, so the agent knows why the obvious path fails
3. **Recipe** — the minimum set of commands that works
4. **Gotcha** — the one thing that still bites even after reading this

Skip narrative intros, history, or alternate approaches. If two recipes exist,
pick one and say so.

## Files to write

### `docs/README.md`

Short index with one-line hook per file. Mirrors the style of `SKILL.md` in
browser-harness. End with: *"If you solved something non-obvious about a site
or UI mechanic, add a note here."*

```md
# agent-chrome interaction skills

Short notes on UI mechanics that need more than a `click`/`fill`/`snapshot`.
Read only the one you need.

- [dialogs.md](./dialogs.md) — native alert/confirm/prompt/beforeunload
- [iframes.md](./iframes.md) — snapshotting and clicking inside iframes
- [shadow-dom.md](./shadow-dom.md) — elements the AX tree can't see
- [dropdowns.md](./dropdowns.md) — custom comboboxes that need keyboard, not clicks
- [uploads.md](./uploads.md) — file inputs (visible or hidden)
- [scrolling.md](./scrolling.md) — virtualized lists, scroll containers, infinite scroll
- [canvas-and-maps.md](./canvas-and-maps.md) — Figma, Google Maps, whiteboards

## When to read

Start with a `screenshot --annotate` and the default commands. Only open one of
these when the default approach fails — e.g. "clicked the dropdown trigger but
no options appeared" (→ dropdowns.md), "fill succeeded but the form didn't
update" (→ shadow-dom.md).

If you learn something non-obvious and reusable, add a short note here.
```

### `docs/shadow-dom.md`

```md
# Shadow DOM

Some components (Salesforce Lightning, Stencil-based widgets, some design
systems) render their content inside a closed or open shadow root that
`Accessibility.getFullAXTree` doesn't traverse into.

## Symptom

- `snapshot -ic` doesn't show the button/input you can clearly see on screen.
- The page's own DOM shows `<my-widget></my-widget>` with nothing inside in devtools'
  Elements pane unless you expand `#shadow-root`.

## Recipe

Coordinate-click through — it passes through shadow roots at the compositor level:

```bash
agent-chrome screenshot --grid
# read the coords off the image
agent-chrome click 420 312
```

For form fields inside shadow DOM, use `eval` to pierce the root:

```bash
agent-chrome eval "document.querySelector('my-widget').shadowRoot.querySelector('input').value = 'hello'"
agent-chrome eval "document.querySelector('my-widget').shadowRoot.querySelector('input').dispatchEvent(new Event('input', {bubbles:true}))"
```

The `dispatchEvent` line is almost always required — React/Vue/etc. don't react
to bare `.value =` assignment.

## Gotcha

Closed shadow roots (`mode: 'closed'`) can't be pierced with `querySelector` at
all. You're limited to coordinate clicks and keyboard input (`press`).
```

### `docs/dropdowns.md`

```md
# Custom dropdowns / comboboxes

Native `<select>` works with `agent-chrome select @eN "value"`. Custom dropdowns
(Headless UI combobox, React Select, MUI Autocomplete) don't — they're `<div>`s
with ARIA roles and keyboard-driven state machines.

## Symptom

- Clicking the trigger opens the menu, but clicking an option does nothing.
- `fill @eN "foo"` types into the search box but no option gets selected.
- Options appear in a portal (`<body>` last-child), not as children of the trigger.

## Recipe: keyboard-first

This is the most reliable pattern and works with nearly every framework.

```bash
agent-chrome click @eN                 # trigger the combobox
agent-chrome fill @eN "united"         # or: type @eN
agent-chrome press ArrowDown           # highlight first match
agent-chrome press Enter               # commit
```

For options that don't filter by typing, step through them:

```bash
agent-chrome click @eN
agent-chrome press ArrowDown
agent-chrome press ArrowDown
agent-chrome press ArrowDown
agent-chrome press Enter
```

## Recipe: click the option

If keyboard doesn't work, the options are rendered in a portal. Re-snapshot
after opening the dropdown:

```bash
agent-chrome click @eN          # open
agent-chrome snapshot -ic       # options now have their own refs
agent-chrome click @e47         # click the option ref
```

## Gotcha

Some comboboxes (Headless UI, Radix) only commit the selection on `Enter` or
`Tab` — clicking an option highlights it but doesn't commit. If the form reverts
after `click @eN`, press `Enter` afterwards.
```

### `docs/uploads.md`

```md
# File uploads

`agent-chrome upload @eN <path>` works for a visible `<input type="file">` that
the AX tree surfaces. When it doesn't, the input is hidden behind a styled
button.

## Symptom

- No `textbox` with `type=file` shows up in `snapshot -i`.
- The visible "Upload" button is a `<button>` or `<label>` that opens the
  system file picker when clicked — no good in a CDP session (picker is native).

## Recipe: find the hidden input and set files directly

```bash
# Find the input's backendNodeId
agent-chrome eval "
  const inputs = [...document.querySelectorAll('input[type=file]')];
  inputs.map(i => ({id: i.id, name: i.name, accept: i.accept, visible: i.offsetParent !== null}))
"

# Get its backendNodeId via CDP DOM.getDocument + DOM.querySelector
# (or just use upload @eN if snapshot -i (without -c) surfaces it)
agent-chrome upload @eN /absolute/path/to/file.pdf
```

If `upload @eN` still doesn't see it, use raw CDP:

```bash
# Resolve the node
DOC=$(agent-chrome cdp DOM.getDocument | jq '.root.nodeId')
NID=$(agent-chrome cdp DOM.querySelector --params "{\"nodeId\":$DOC,\"selector\":\"input[type=file]\"}" | jq '.nodeId')

# Set the files
agent-chrome cdp DOM.setFileInputFiles --params "{\"nodeId\":$NID,\"files\":[\"/absolute/path/to/file.pdf\"]}"
```

## Gotcha

Paths must be absolute. `~` is not expanded. Many sites require a `change` event
to be fired on the input after setting files — `setFileInputFiles` fires it
automatically, but if the upload doesn't start, dispatch manually:

```bash
agent-chrome eval "document.querySelector('input[type=file]').dispatchEvent(new Event('change', {bubbles:true}))"
```
```

### `docs/scrolling.md`

```md
# Scrolling

`agent-chrome scroll down 800` scrolls the main document. For everything else
(virtualized lists, scroll containers inside modals, infinite-scroll feeds),
that's not the scroller you want.

## Symptom

- `scroll down` does nothing — the page looks identical after.
- An item is clearly "below the fold" but not in `snapshot -ic`.
- A modal has its own scrollbar and `scroll down` scrolls the page behind it.

## Recipe: scrollIntoView for a known ref

```bash
agent-chrome scrollintoview @eN
```

This uses `element.scrollIntoView({block:'center'})`, which walks up through
nested scroll containers and scrolls each one as needed.

## Recipe: scroll a specific container

For infinite-scroll feeds (LinkedIn, Twitter, Reddit), identify the actual
scroller and scroll it:

```bash
agent-chrome eval "
  const el = document.querySelector('[data-test-feed]') || document.scrollingElement;
  el.scrollTop = el.scrollHeight;
"
```

Then wait for new content:

```bash
agent-chrome wait 1500
agent-chrome snapshot -ic
```

## Recipe: virtualized lists

React-virtualized / TanStack Virtual / cdk-virtual-scroll only render visible
rows. A row that doesn't exist in the DOM can't be clicked. Scroll until the
target row renders, then re-snapshot:

```bash
for i in 1 2 3 4 5; do
  agent-chrome eval "document.querySelector('.list-container').scrollBy(0, 800)"
  agent-chrome wait 300
  agent-chrome snapshot -ic | grep -q "Target text" && break
done
```

## Gotcha

`window.scrollTo` is ignored inside iframes and some SPAs that intercept scroll
events. `scrollBy` on the actual scrolling container is more reliable.
```

### `docs/canvas-and-maps.md`

```md
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

Text inside the canvas is rendered — not text in the DOM. `eval` can't read it.
Take a screenshot and describe what you see; don't try to query it.

Many of these apps have a keyboard-driven command palette (Cmd+/, Cmd+K). When
one exists, prefer it:

```bash
agent-chrome press "Meta+K"
agent-chrome type "zoom to fit"
agent-chrome press Enter
```
```

## Ordering

Write in this order — easiest first, so momentum carries through:

1. `docs/README.md`
2. `docs/shadow-dom.md`
3. `docs/dropdowns.md`
4. `docs/uploads.md`
5. `docs/scrolling.md`
6. `docs/canvas-and-maps.md`

(`dialogs.md` and `iframes.md` come from plans 03 and 05.)

## Cross-linking

- In top-level `README.md`, add a one-line section under a new "Skills" heading:
  > See [docs/](./docs/) for short notes on dialogs, iframes, shadow DOM,
  > custom dropdowns, uploads, scrolling, and canvas-based UIs.
- In `AGENTS.md`, add: *"When a default approach fails for a known sticky UI
  pattern (dialogs, iframes, shadow DOM, dropdowns, uploads, scrolling,
  canvas), check `docs/` first."*

## Out of scope

- Domain-specific skills (LinkedIn outreach, Gmail triage, etc.) — those
  already live in other project-specific CLAUDE.md files and in `~/tools/*/AGENTS.md`.
  `docs/` is for generic UI mechanics only.
- Video / media controls, print dialogs, service workers — add only when they
  come up in real use.
