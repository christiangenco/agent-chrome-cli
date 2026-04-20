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
`screenshot` first; if the page looks frozen and no modal is visible, assume a
native dialog and handle it.

## Gotcha

Dialogs are per-session events. If a click triggers an alert on the page
session, the command that triggered it may hang until the dialog is handled
from *another* invocation (or you raise `--timeout`). When you expect a dialog,
call `Page.handleJavaScriptDialog` in a separate terminal, or run the
triggering command in the background with `&`.
