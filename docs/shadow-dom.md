# Shadow DOM

Some components (Salesforce Lightning, Stencil-based widgets, some design
systems) render their content inside a closed or open shadow root that
`Accessibility.getFullAXTree` doesn't traverse into.

## Symptom

- `snapshot -ic` doesn't show the button/input you can clearly see on screen.
- The page's own DOM shows `<my-widget></my-widget>` with nothing inside in
  devtools' Elements pane unless you expand `#shadow-root`.

## Recipe

Coordinate-click through — it passes through shadow roots at the compositor
level:

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

The `dispatchEvent` line is almost always required — React/Vue/etc. don't
react to bare `.value =` assignment.

## Gotcha

Closed shadow roots (`mode: 'closed'`) can't be pierced with `querySelector` at
all. You're limited to coordinate clicks and keyboard input (`press`).
