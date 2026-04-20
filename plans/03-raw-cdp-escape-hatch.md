# Plan: Raw CDP Escape Hatch

## Context

`agent-chrome-cli` wraps ~25 CDP methods behind named subcommands (`click`, `fill`, `screenshot`, etc.). Every few months something useful comes up that isn't wrapped — file uploads via `DOM.setFileInputFiles`, dialog handling via `Page.handleJavaScriptDialog`, cookie manipulation via `Network.setCookie`, CSS coverage, emulation toggles, etc.

Rather than keep adding one-off subcommands, add a single `cdp` command that passes straight through to the attached session. This mirrors `browser-harness`'s `cdp()` helper — the agent uses raw CDP method names it looks up in the Chrome docs.

## Scope

One new subcommand. No new source files. A small chunk of CLI arg parsing and a short docs file to point at.

## Changes

### 1. New: `cdp <Domain.method> [--params '<json>'] [--session <sid>]`

Passes the request to `Runtime`/`Page`/whatever domain straight through via the existing `chrome-remote-interface` client.

Add to `bin/agent-chrome.js`:

```js
case 'cdp': return await cmdCdp(client);

// ...

async function cmdCdp(client) {
  requireArg(restArgs[0], 'cdp', '<Domain.method> [--params \'<json>\']');
  const method = restArgs[0];
  if (!/^[A-Z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/.test(method)) {
    error(`Invalid CDP method "${method}". Expected form: Domain.method (e.g. Page.navigate).`);
  }

  let params = {};
  let sessionId;
  for (let i = 1; i < restArgs.length; i++) {
    const a = restArgs[i];
    if (a === '--params' && restArgs[i + 1]) {
      try { params = JSON.parse(restArgs[++i]); }
      catch (e) { error(`Invalid JSON for --params: ${e.message}`); }
    } else if (a.startsWith('--params=')) {
      try { params = JSON.parse(a.slice('--params='.length)); }
      catch (e) { error(`Invalid JSON for --params: ${e.message}`); }
    } else if (a === '--session' && restArgs[i + 1]) {
      sessionId = restArgs[++i];
    } else if (a.startsWith('--session=')) {
      sessionId = a.slice('--session='.length);
    }
  }

  const [domain, fn] = method.split('.');
  const target = sessionId ? client : client; // placeholder — see note below
  let result;
  try {
    if (sessionId) {
      result = await client.send(method, params, sessionId);
    } else {
      result = await client[domain][fn](params);
    }
  } catch (err) {
    error(`CDP ${method} failed: ${err.message || err}`);
  }
  if (result !== undefined) {
    console.log(JSON.stringify(result, null, 2));
  }
}
```

Notes on the implementation:
- `chrome-remote-interface` exposes methods as `client.Page.navigate({url})` etc. For unknown domains it still works via the raw send path — `client.send(method, params, sessionId)` is the lower-level call.
- Prefer `client.send(method, params, sessionId)` as the one uniform path; it handles both flat and session-routed calls. Verify against the chrome-remote-interface version pinned in `package.json` and adjust the two branches if needed.
- `--session` is optional and only needed for iframe work (see plan 05). Omit it and calls go to the default attached session.

### 2. Help text

```
Raw CDP:
  cdp <Domain.method> [--params '<json>']
                                Send a raw CDP command and print the JSON result
  cdp <Domain.method> --session <sid>
                                Target a specific session (e.g. iframe target)
```

### 3. README + AGENTS.md

Add a short section to `README.md`:

```md
### Raw CDP escape hatch

For anything not covered by a named command, use `cdp`:

```bash
# Set file input
agent-chrome cdp DOM.setFileInputFiles --params '{"files":["/tmp/x.pdf"],"backendNodeId":123}'

# Handle a native dialog
agent-chrome cdp Page.handleJavaScriptDialog --params '{"accept":true,"promptText":"yes"}'

# Set a cookie
agent-chrome cdp Network.setCookie --params '{"name":"s","value":"abc","domain":"example.com"}'

# Poke at anything
agent-chrome cdp Performance.getMetrics
```

The result is printed as JSON. Method reference: https://chromedevtools.github.io/devtools-protocol/
```

Add to AGENTS.md a one-liner: *"When something isn't wrapped, use `agent-chrome cdp <Domain.method> --params '<json>'`."*

### 4. New: `docs/dialogs.md`

Short skill note the agent can read when a page hangs because of a native alert/confirm/beforeunload:

```md
# Dialogs

Native `alert()`, `confirm()`, `prompt()`, and `beforeunload` prompts freeze the
page's JS thread until the dialog is handled. They also swallow every subsequent
action silently — clicks succeed but nothing happens.

## Symptoms

- `eval "document.title"` returns the right value but nothing else works.
- `click @eN` reports success but the page doesn't change.
- Navigation via `open <url>` hangs (beforeunload).

## Handling

Raw CDP — no listener needed:

```bash
# Accept the dialog (OK / confirm / navigate-away)
agent-chrome cdp Page.handleJavaScriptDialog --params '{"accept":true}'

# Dismiss (Cancel / stay on page)
agent-chrome cdp Page.handleJavaScriptDialog --params '{"accept":false}'

# Answer a prompt()
agent-chrome cdp Page.handleJavaScriptDialog --params '{"accept":true,"promptText":"my answer"}'
```

If you don't know what the dialog says, a screenshot usually reveals it — the
dialog is part of the browser chrome but not the captured image, so take a
`screenshot` first, then check whether the page looks frozen vs. showing a modal.

## Gotcha

CDP only reports dialogs on a session that has `Page.enable` called on it. The
default connection enables Page automatically, so most cases just work. If
`handleJavaScriptDialog` returns `No dialog is showing`, there's no pending
dialog — the page is frozen for some other reason.
```

### 5. Safety

Don't add any method allowlist or param validation beyond "is the method name well-formed and is the JSON valid." This is an intentionally sharp tool.

## Testing

```bash
# Sanity: read performance metrics
agent-chrome cdp Performance.enable
agent-chrome cdp Performance.getMetrics

# Dialog handling
agent-chrome tab new "data:text/html,<button onclick=\"alert('hi')\">go</button>"
agent-chrome --tab t2 click @e1  # Triggers alert — page is now frozen
agent-chrome --tab t2 cdp Page.handleJavaScriptDialog --params '{"accept":true}'
# Page should be responsive again

# Invalid method
agent-chrome cdp badformat   # Should error with "Invalid CDP method"

# Invalid JSON
agent-chrome cdp Page.navigate --params '{bad json}'   # Should error cleanly

# Unknown method (forwarded to Chrome, Chrome rejects)
agent-chrome cdp Page.doesNotExist   # Should print Chrome's error message
```

## Out of scope

- A `cdp-stream` command for subscribing to CDP events — that would need the collector-process model from plan 01.
- Convenience wrappers for the common dialog cases (`dialog accept`, `dialog dismiss`). Possible future add if `docs/dialogs.md` turns out to be friction.
