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

`window.scrollTo` is ignored inside iframes and some SPAs that intercept
scroll events. `scrollBy` on the actual scrolling container is more reliable.
