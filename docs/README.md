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
