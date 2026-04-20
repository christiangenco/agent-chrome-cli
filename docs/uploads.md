# File uploads

`agent-chrome upload @eN <path>` works for a visible `<input type="file">` that
the AX tree surfaces. When it doesn't, the input is hidden behind a styled
button.

## Symptom

- No `textbox` with `type=file` shows up in `snapshot -i`.
- The visible "Upload" button is a `<button>` or `<label>` that opens the
  system file picker when clicked — no good in a CDP session (picker is
  native).

## Recipe: set files directly via raw CDP

```bash
# Find the input via DOM.getDocument + DOM.querySelector
DOC=$(agent-chrome cdp DOM.getDocument | jq '.root.nodeId')
NID=$(agent-chrome cdp DOM.querySelector --params "{\"nodeId\":$DOC,\"selector\":\"input[type=file]\"}" | jq '.nodeId')

# Set the files
agent-chrome cdp DOM.setFileInputFiles --params "{\"nodeId\":$NID,\"files\":[\"/absolute/path/to/file.pdf\"]}"
```

If `snapshot -i` (without `-c`) surfaces the hidden input, just use the
wrapped command:

```bash
agent-chrome upload @eN /absolute/path/to/file.pdf
```

## Gotcha

Paths must be absolute. `~` is not expanded. Many sites require a `change`
event to be fired on the input after setting files — `setFileInputFiles`
fires it automatically, but if the upload doesn't start, dispatch manually:

```bash
agent-chrome eval "document.querySelector('input[type=file]').dispatchEvent(new Event('change', {bubbles:true}))"
```
