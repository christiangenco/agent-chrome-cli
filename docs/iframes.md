# iframes

`snapshot -ic` recurses one level into same-origin iframes automatically and
inlines their AX tree under the `Iframe` node. You can click/fill refs inside
the iframe the same way you do top-level refs — no special flags required.

## Symptom that recursion didn't happen

- `Iframe` line appears with no children below it in the non-compact snapshot.
- The iframe is cross-origin (Stripe, YouTube, Google sign-in, recaptcha).

## Recipe for cross-origin iframes

Coordinate clicks pass through iframe boundaries:

```bash
agent-chrome screenshot --grid
# read target coords
agent-chrome click 420 312
```

For typing, coordinate-click first to focus, then use `press` and raw key
input. Don't use `fill @eN` — there's no ref for a cross-origin element.

## Gotcha

Nested iframes (iframe inside an iframe) are not expanded. If you need those,
drop to raw CDP:

```bash
# Find frame IDs
agent-chrome cdp Page.getFrameTree

# Pull an AX tree from a specific frame
agent-chrome cdp Accessibility.getFullAXTree --params '{"frameId":"<id>"}'
```

If an iframe's AX fetch hangs, the recursion gives up after ~2s and returns
the top-level snapshot with the Iframe left empty.
