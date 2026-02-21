# agent-chrome

Control the user's running Chrome browser via CDP. Connects to real tabs, logged-in sessions, and cookies. Chrome must be running with `--remote-debugging-port=9222`.

## Commands

```bash
agent-chrome tabs                              # List all open tabs (t1, t2, ...)
agent-chrome --tab t1 snapshot -c              # Compact accessibility snapshot
agent-chrome --tab t1 snapshot -ic             # Interactive elements only (smallest)
agent-chrome --tab t1 click @e5                # Click element by ref
agent-chrome --tab t1 fill @e3 "text"          # Clear field and type text
agent-chrome --tab t1 type @e3 "text"          # Append text (don't clear)
agent-chrome --tab t1 select @e3 "value"       # Select dropdown option
agent-chrome --tab t1 check @e3                # Check checkbox/radio
agent-chrome --tab t1 uncheck @e3              # Uncheck checkbox
agent-chrome --tab t1 hover @e5                # Hover element
agent-chrome --tab t1 focus @e5                # Focus element
agent-chrome --tab t1 press Enter              # Press key (Enter, Tab, Escape, ArrowDown, ...)
agent-chrome --tab t1 scroll down 400          # Scroll page (up/down/left/right, default 400px)
agent-chrome --tab t1 scrollintoview @e5       # Scroll element into view
agent-chrome --tab t1 upload @e3 /path/to/file # Upload file to input
agent-chrome --tab t1 screenshot               # Screenshot (viewport only)
agent-chrome --tab t1 screenshot --full        # Full-page screenshot
agent-chrome --tab t1 screenshot --annotate    # Screenshot with numbered labels on interactive elements
agent-chrome --tab t1 open "https://x.com"     # Navigate tab to URL
agent-chrome --tab t1 back                     # Go back
agent-chrome --tab t1 forward                  # Go forward
agent-chrome --tab t1 reload                   # Reload page
agent-chrome --tab t1 eval "document.title"    # Run JavaScript in page
agent-chrome --tab t1 get url                  # Get current URL
agent-chrome --tab t1 get title                # Get page title
agent-chrome --tab t1 wait 2000                # Wait milliseconds
agent-chrome tab new "https://example.com"     # Open new tab
agent-chrome tab close t3                      # Close a tab
agent-chrome window new "https://example.com"  # Open new window
agent-chrome window close t3                   # Close window containing tab
```

## Typical Workflow

```bash
agent-chrome tabs                              # 1. See what's open
agent-chrome tab new "https://example.com"     # 2. Open target page
agent-chrome --tab t2 snapshot -c              # 3. Read the page (get refs)
agent-chrome --tab t2 fill @e3 "My Value"      # 4. Interact using refs
agent-chrome --tab t2 click @e8                # 5. Click buttons
agent-chrome --tab t2 screenshot               # 6. Verify visually if needed
agent-chrome tab close t2                      # 7. Clean up
```

## Key Concepts

- **Refs**: `snapshot` assigns `@eN` refs to elements. Use these refs with `click`, `fill`, etc. Refs persist between commands but go stale after page changes — re-run `snapshot` to refresh.
- **Tab targeting**: `--tab t1` targets a specific tab. Omit to use the last-used tab.
- **Stateless**: Each invocation connects via CDP, runs one command, and exits. No daemon.

## Parallel Agents

Use `--agent-id` (or `AGENT_CHROME_ID` env) to isolate ref caches when multiple agents run concurrently. Assign each agent its own tab(s).

```bash
agent-chrome --agent-id agent1 --tab t1 snapshot -c
agent-chrome --agent-id agent2 --tab t3 snapshot -c
```

## Notes

- Requires Chrome running with `--remote-debugging-port=9222`
- Default port 9222, override with `--port` or `AGENT_CHROME_PORT` env
- Screenshots save to `~/.agent-chrome/screenshots/` by default
- Output is plain text to stdout, errors to stderr
- Default 30-second timeout; override with `--timeout <seconds>` or `AGENT_CHROME_TIMEOUT` env
- No credentials needed — no `.env` file required
