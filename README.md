# agent-chrome

CLI for AI agents to interact with your **running Chrome browser** via CDP (Chrome DevTools Protocol). Roughly the same API as [agent-browser](https://github.com/vercel-labs/agent-browser), but connects to your real Chrome session instead of launching a sandboxed one.

Takes compact accessibility snapshots with clickable refs, fills forms, clicks buttons, takes screenshots, opens/closes tabs and windows — all scoped to specific tabs.

## Prerequisites

Start Chrome with the remote debugging port enabled:

```bash
# Linux
google-chrome --remote-debugging-port=9222

# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# Or add to your Chrome shortcut/alias permanently
```

## Install

```bash
cd agent-chrome && npm link
```

## Usage

```bash
# List all open tabs
agent-chrome tabs

# Take a compact accessibility snapshot (best for AI agents)
agent-chrome snapshot -c

# Interactive elements only (smallest output)
agent-chrome snapshot -i

# Scope to a specific tab
agent-chrome --tab t2 snapshot -c

# Fill a form field
agent-chrome fill @e3 "christian@example.com"

# Click a button
agent-chrome click @e5

# Take a screenshot
agent-chrome screenshot

# Navigate
agent-chrome open "https://example.com"

# Open and close tabs/windows
agent-chrome tab new "https://example.com"
agent-chrome tab close t3
agent-chrome window new "https://example.com"
agent-chrome window close t3
```

## Commands

### Tab & Window Management
| Command | Description |
|---|---|
| `tabs` | List all Chrome tabs with short IDs (t1, t2, ...) |
| `tab new [url]` | Open a new tab (optionally navigate to URL) |
| `tab close [id]` | Close a tab (default: current tab) |
| `window new [url]` | Open a new window (optionally navigate to URL) |
| `window close [id]` | Close window containing tab (default: current) |

### Snapshots
| Command | Description |
|---|---|
| `snapshot` | Full accessibility tree with `[ref=eN]` annotations |
| `snapshot -i` | Interactive elements only (smallest) |
| `snapshot -c` | Compact — strips empty structural wrappers |
| `snapshot -ic` | Both interactive and compact |
| `snapshot -d N` | Limit tree depth |

### Interactions
| Command | Description |
|---|---|
| `click @eN` | Click element by ref |
| `fill @eN "text"` | Clear field and type text |
| `type @eN "text"` | Append text (don't clear first) |
| `select @eN "value"` | Select dropdown option |
| `check @eN` | Check checkbox/radio |
| `uncheck @eN` | Uncheck checkbox |
| `focus @eN` | Focus element |
| `hover @eN` | Hover element |
| `press <key>` | Press key (Enter, Tab, Escape, ArrowDown, ...) |
| `scroll <dir> [px]` | Scroll page (up/down/left/right, default 400px) |
| `scrollintoview @eN` | Scroll element into view |

### Navigation
| Command | Description |
|---|---|
| `open <url>` | Navigate to URL |
| `back` | Go back |
| `forward` | Go forward |
| `reload` | Reload page |

### Info
| Command | Description |
|---|---|
| `screenshot [path]` | Take PNG screenshot |
| `eval <js>` | Run JavaScript in page |
| `get url` | Get current URL |
| `get title` | Get page title |
| `wait <ms>` | Wait milliseconds |

## Options

| Flag | Description |
|---|---|
| `--port, -p <port>` | Chrome debug port (default: 9222, or `AGENT_CHROME_PORT` env) |
| `--tab, -t <id>` | Target tab (e.g., t1). Omit to use last-used tab |

## AI Agent Workflow

Typical workflow for an AI agent filling out a form:

```bash
# 1. See what tabs are open
agent-chrome tabs

# 2. Open a new tab and navigate to the form
agent-chrome tab new "https://ads.google.com/..."

# 3. Get a snapshot to understand the page
agent-chrome --tab t2 snapshot -c

# 4. Fill form fields using refs from the snapshot
agent-chrome --tab t2 fill @e3 "My Campaign"
agent-chrome --tab t2 fill @e5 "100.00"
agent-chrome --tab t2 click @e8

# 5. If something's unclear, take a screenshot
agent-chrome --tab t2 screenshot

# 6. Submit
agent-chrome --tab t2 click @e12

# 7. Close the tab when done
agent-chrome tab close t2
```

## How It Works

- **Stateless CLI**: Each invocation connects to Chrome via CDP, runs one command, exits
- **Ref cache**: `~/.agent-chrome/` stores the ref→element mapping between invocations so `snapshot` assigns refs and `click @e5` resolves them
- **Accessibility tree**: Uses Chrome's `Accessibility.getFullAXTree()` CDP API for the snapshot, not DOM scraping
- **Element interaction**: Uses `backendDOMNodeId` from the accessibility tree to resolve elements, then interacts via `Runtime.callFunctionOn` and `Input.insertText`
- **Single dependency**: Just `chrome-remote-interface` (no Playwright, no Puppeteer)
