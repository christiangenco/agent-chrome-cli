# Plan: Iframe Snapshot Recursion

## Context

`src/snapshot.js` uses `Accessibility.getFullAXTree()` on the top-level page
session. That API stops at iframe boundaries — any content inside `<iframe>`
elements is invisible to the agent, even for same-origin iframes where we
have full access.

This is the single biggest source of "can't find the element" failures:
Stripe checkout, Google sign-in, YouTube embeds, Salesforce blades, Azure
portal, Intercom widgets, recaptcha — all iframes.

`browser-harness` punts on this and relies on coordinate clicks (plan 02
covers adding those). `agent-browser` solves it properly by recursing into
each iframe target, taking an AX snapshot there, and inlining the subtree
under the parent `Iframe` node with +2 indent (see
`/tmp/agent-browser/cli/src/native/snapshot.rs:490-528`).

Porting that approach to `agent-chrome-cli` makes iframes invisible to the
agent — snapshots Just Work across them.

## Scope

Same-origin iframes, one level deep. Cross-origin iframes are skipped
silently (coordinate clicks still work for those). Nested iframes-within-
iframes are not expanded — matches agent-browser's bound.

## Design

### AX-tree walk

Current snapshot pipeline:

1. `Accessibility.getFullAXTree({ fetchRelatives: true })` on default session
2. Build tree text with refs
3. Save ref map `{ backendDOMNodeId, role, name, ... }`

New pipeline:

1. AX tree on default session — same as today
2. Build tree text, assign refs
3. **Before emitting the output**, walk the nodes. For each node where
   `role === 'Iframe'` and `backendDOMNodeId` is set:
   a. `DOM.describeNode({ backendNodeId, depth: 0 })` → read
      `contentDocument.frameId`
   b. `Page.getFrameTree()` → look up the target info for that frameId, or
      `Target.getTargets()` and match by `type === 'iframe'` + url
   c. `Target.attachToTarget({ targetId, flatten: true })` → get sessionId
   d. `Accessibility.enable({ sessionId })` (defensive — some iframes come
      without this pre-enabled)
   e. `Accessibility.getFullAXTree({ fetchRelatives: true }, sessionId)`
   f. Render that subtree with `+2` indent relative to the Iframe line
   g. Assign refs from a **shared counter** so `@e5` stays globally unique
   h. Store each ref as `{ sessionId, backendNodeId, role, name, ... }` —
      the key change to the ref record
4. Splice child text into the parent output after each Iframe line
5. Save ref map (with session info) via `saveRefs`

### Ref-map schema change

`src/refs.js` currently stores:

```json
{
  "e5": { "backendDOMNodeId": 123, "role": "button", "name": "Sign in" }
}
```

New:

```json
{
  "e5": { "sessionId": "A1B2...", "backendDOMNodeId": 123, "role": "button", "name": "Sign in" },
  "e7": { "sessionId": null, "backendDOMNodeId": 45, "role": "link", "name": "Home" }
}
```

`sessionId: null` (or absent) means "use the default attached session" — the
existing behavior for all top-frame refs. Old cached ref maps from previous
`agent-chrome` versions will lack `sessionId` and resolve as `null`, which is
the right fallback — no migration needed.

### Action routing

Every action in `src/actions.js` that currently calls
`Runtime.callFunctionOn` / `DOM.resolveNode` / `Input.*` on `client` needs to
route through the ref's session when set:

```js
async function resolveRef(client, ref) {
  const sessionId = ref.sessionId || undefined;
  const { object } = await client.DOM.resolveNode(
    { backendNodeId: ref.backendDOMNodeId },
    sessionId
  );
  return { object, sessionId };
}

async function click(client, port, targetId, refStr, agentId) {
  const ref = loadRef(...);
  const { object, sessionId } = await resolveRef(client, ref);
  await client.Runtime.callFunctionOn(
    { objectId: object.objectId, functionDeclaration: '...click impl...' },
    sessionId
  );
}
```

The `chrome-remote-interface` client supports a third argument for sessionId
on most methods. Audit each action once (`click`, `fill`, `type`, `select`,
`check`, `uncheck`, `focus`, `hover`, `upload`, `scrollIntoView`) and thread
`sessionId` through.

`Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` remain on the root
session — input events are dispatched at the browser level, not per-frame.
That means `click @eN` on an iframe ref needs to:

1. Resolve the ref to get its `DOMRect` (via
   `Runtime.callFunctionOn` → `el.getBoundingClientRect()` in the iframe's
   session)
2. Translate to viewport coords by walking parent frame offsets (agent-
   browser does this in `interaction.rs`) — or, simpler: call
   `el.getBoundingClientRect()` on the iframe element itself and sum
3. Dispatch `Input.dispatchMouseEvent` on the root session at that
   viewport coord

Fallback if step 2 gets hairy: call the element's `.click()` via
`Runtime.callFunctionOn` inside the iframe session. Less realistic (no real
mouse event) but works for most form controls.

**Start with the fallback.** Iframes are mostly forms — a synthesized click
works. If real mouse events turn out to matter, upgrade to coord translation
later.

### Output format

Before:
```
[1] RootWebArea "Checkout"
  [2] main
    [3] Iframe @e1
    [4] button "Back" @e2
```

After:
```
[1] RootWebArea "Checkout"
  [2] main
    [3] Iframe @e1
      [5] RootWebArea "Stripe" (iframe)
        [6] textbox "Card number" @e3
        [7] textbox "Expiry" @e4
        [8] textbox "CVC" @e5
    [4] button "Back" @e2
```

- The iframe subtree uses **parent indent + 2 spaces**, matching the
  browser-harness convention.
- A marker on the iframe's RootWebArea line (`(iframe)`) tells the agent this
  section is inside an iframe.
- Refs are globally sequential — no `@e1.3` or namespace prefixes. Simpler
  for the agent.

### Cross-origin handling

If `Target.attachToTarget` fails (cross-origin or attach denied), skip
silently and leave the Iframe line with no child content. Log at debug level
only. The agent can still coordinate-click inside the iframe via plan 02.

### Bounds

- **Depth: one level.** If an iframe contains another iframe, don't recurse
  further. Matches agent-browser; prevents unbounded output.
- **Timeout per iframe: 2s.** If `Accessibility.getFullAXTree` hangs on an
  iframe session, abort that branch and move on. Use `Promise.race` with a
  2-second timer. Cumulative worst case with 5 iframes: 10s; acceptable.
- **Max iframes: no cap initially.** Revisit if some page has 50 iframes and
  snapshots become useless.

## Changes

### 1. `src/snapshot.js`

- Accept a `client` and recursively fetch AX trees for Iframe children.
- Rewrite ref assignment to include `sessionId` in each ref record.
- New helper: `resolveIframeSession(client, backendNodeId)` → returns
  `{ sessionId }` or `null` if attach fails.
- Splice child subtrees into output after building the top-level text.

### 2. `src/refs.js`

- Extend the ref-record schema to include optional `sessionId`.
- No other changes — load/save already pass-through arbitrary fields.

### 3. `src/actions.js`

- Read `sessionId` from the ref record; pass it through to every
  `Runtime.callFunctionOn` / `DOM.resolveNode` / `DOM.setFileInputFiles`
  call.
- For `click @eN` where the ref has a `sessionId`: call `.click()` via
  `Runtime.callFunctionOn` inside that session (fallback path described
  above). For top-frame refs, keep the existing `Input.dispatchMouseEvent`
  path.
- For `fill` / `type` / `select` / `check` / `uncheck` / `focus` / `hover`
  / `scrollIntoView` / `upload`: these already operate via
  `Runtime.callFunctionOn` or CDP DOM methods — just thread the sessionId.

### 4. `src/connection.js`

- No changes required; `connectToTarget` stays as the root connection. New
  sessions are attached ad-hoc inside `snapshot.js`.

### 5. Help + docs

- `README.md`: add a sentence to the "How It Works" section noting that
  snapshots recurse one level into same-origin iframes.
- `docs/iframes.md`:

```md
# iframes

`snapshot -ic` recurses one level into same-origin iframes automatically and
inlines their AX tree under the `Iframe` node. You can click/fill refs inside
the iframe the same way you do top-level refs.

## Symptom that recursion didn't happen

- `Iframe @eN` line appears with no children below it.
- The iframe is cross-origin (Stripe, YouTube, Google sign-in, recaptcha).

## Recipe for cross-origin iframes

Coordinate clicks pass through iframe boundaries:

```bash
agent-chrome screenshot --grid
# read target coords
agent-chrome click 420 312
```

For typing, coordinate-click first to focus, then use `press` and raw key input.
Don't use `fill @eN` — the ref is for a top-level element, not the iframe.

## Gotcha

Nested iframes (iframe inside an iframe) are not expanded. If you need those,
drop to raw CDP:

```bash
agent-chrome cdp Target.getTargets    # find the nested iframe target
# then send CDP commands with --session <id> (see cdp help)
```
```

## Testing

```bash
# Same-origin iframe (use a test page)
agent-chrome tab new "data:text/html,<h1>top</h1><iframe srcdoc='<button>inner</button>'></iframe>"
agent-chrome --tab t2 snapshot -ic
# Expected: Iframe node followed by an inlined RootWebArea with the button ref

# Click the iframe button
agent-chrome --tab t2 click @eN     # where eN is the button inside the iframe
# Should actually click the button inside the iframe

# Cross-origin iframe (should NOT recurse, should not error)
agent-chrome --tab t2 open "https://en.wikipedia.org/wiki/HTML_element"
agent-chrome --tab t2 snapshot -ic
# Expected: succeeds; any cross-origin Iframe nodes have no children

# Real-world: Stripe checkout
# Requires a page with Stripe Elements mounted. Verify:
#   - snapshot shows an Iframe node for the card element
#   - because Stripe iframes are cross-origin, no children appear
#   - coordinate-click (plan 02) still works inside it

# Real-world: same-origin embed
# Create a page that iframes a same-origin form; verify the form fields
# show up under the Iframe node in snapshot and that fill @eN works.

# Timeout behavior
# Hard to test deterministically — verify by navigating to a page known to
# hang iframes occasionally and confirming the top-level snapshot still returns.
```

## Rollout

1. Land snapshot recursion first without changing the ref schema — stash
   `sessionId` on refs but keep actions routing only to the root session.
   Verify snapshots look right.
2. Thread `sessionId` through `resolveNode` and the handful of
   `callFunctionOn` calls in `actions.js`.
3. Verify `click`/`fill` work inside same-origin iframes.
4. Write `docs/iframes.md`.

Each step is testable independently; stop after step 1 if it's enough value
for now and the action routing turns out to be more work than expected.

## Out of scope

- Nested iframe recursion (2+ levels deep).
- Cross-origin iframe support via `Target.attachToTarget` with higher
  privileges — would require launching Chrome with flags we don't control on
  the user's running browser.
- Real mouse-event coord translation from iframe-local rects to viewport
  rects. Revisit if the `.click()` fallback turns out to be insufficient.
