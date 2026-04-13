# Plan: Network Request Logging & Console Message Monitoring

## Context

`agent-chrome-cli` is a stateless CLI that connects to Chrome via CDP, runs one command, and exits. We need to add network request inspection (for API discovery) and console message extraction. The challenge is that monitoring requires continuous listening during page activity.

## Architecture

**Background collector process** approach: spawn a small detached Node process that holds a CDP connection open and logs events to disk. The main CLI reads from disk for listing, and communicates with the collector via unix socket for operations needing a live CDP connection (like fetching response bodies).

### File layout

```
~/.agent-chrome/
  network-9222-<targetShort>.pid      # PID of background collector
  network-9222-<targetShort>.jsonl    # One JSON object per line (request metadata)
  network-9222-<targetShort>.sock     # Unix socket for body fetching
  console-9222-<targetShort>.pid
  console-9222-<targetShort>.jsonl
```

Where `<targetShort>` is the first 8 chars of the CDP target ID (same convention as refs.js).

### New source files

1. **`src/collectors/network-collector.js`** — Background process that:
   - Connects to Chrome CDP target (port + targetId passed as CLI args)
   - Enables `Network.enable`
   - Listens to `Network.requestWillBeSent`, `Network.responseReceived`, `Network.loadingFinished`, `Network.loadingFailed`
   - Appends request metadata as JSONL to the data file
   - Opens a unix socket server that accepts JSON commands:
     - `{"cmd": "getBody", "requestId": "..."}` → calls `Network.getResponseBody` and returns result
     - `{"cmd": "ping"}` → returns `{"ok": true}`
   - Handles SIGTERM gracefully (cleanup socket file, close CDP)

2. **`src/collectors/console-collector.js`** — Background process that:
   - Connects to Chrome CDP target
   - Enables `Runtime.enable`
   - Listens to `Runtime.consoleAPICalled` and `Runtime.exceptionThrown`
   - Appends messages as JSONL to the data file
   - Each entry: `{msgId, level, text, url, lineNumber, timestamp, stackTrace?}`
   - No socket needed (no lazy-fetch requirement)

3. **`src/collectors/ipc.js`** — Shared helpers:
   - `sendCommand(sockPath, cmd)` → connects to unix socket, sends JSON, reads JSON response
   - Used by the main CLI to ask the network collector for response bodies

4. **`src/network.js`** — CLI-facing functions:
   - `startNetworkCollector(port, targetId, agentId)` — spawns the background process detached, writes PID file
   - `stopNetworkCollector(port, targetId, agentId)` — reads PID, sends SIGTERM, cleans up files
   - `listNetworkRequests(port, targetId, agentId, filters)` — reads JSONL file, applies filters, returns formatted list
   - `getNetworkRequest(port, targetId, agentId, reqId)` — reads metadata from JSONL, fetches body via IPC socket
   - Helper: `collectorPaths(port, targetId, agentId)` — returns paths for pid/jsonl/sock files

5. **`src/console-log.js`** — CLI-facing functions:
   - `startConsoleCollector(port, targetId, agentId)` — spawns background process
   - `stopConsoleCollector(port, targetId, agentId)` — kills it
   - `listConsoleMessages(port, targetId, agentId, filters)` — reads JSONL, applies filters
   - `getConsoleMessage(port, targetId, agentId, msgId)` — reads specific message

### CLI commands (add to bin/agent-chrome.js)

**Network:**
```
agent-chrome --tab t1 network start           # Start collector
agent-chrome --tab t1 network stop            # Stop collector
agent-chrome --tab t1 network list            # List all requests
agent-chrome --tab t1 network list --type Fetch,XHR   # Filter by resource type
agent-chrome --tab t1 network list --url "*/api/*"     # Filter by URL glob
agent-chrome --tab t1 network list --status 200        # Filter by status
agent-chrome --tab t1 network list --json              # Filter to only application/json responses
agent-chrome --tab t1 network clear           # Clear collected data without stopping
agent-chrome --tab t1 network get r15         # Full details + response body for request r15
```

**Console:**
```
agent-chrome --tab t1 console start           # Start collector  
agent-chrome --tab t1 console stop            # Stop collector
agent-chrome --tab t1 console list            # List all messages
agent-chrome --tab t1 console list --level error,warning  # Filter by level
agent-chrome --tab t1 console clear           # Clear collected data
agent-chrome --tab t1 console get m3          # Full details of message m3
```

### Network request metadata format (JSONL entries)

Each line in the JSONL file is one of these event types:

```json
{"event":"request","requestId":"123.4","timestamp":1234567890.123,"url":"https://example.com/api/v2/search","method":"POST","resourceType":"Fetch","requestHeaders":{"Content-Type":"application/json"},"postData":"{\"q\":\"test\"}"}
{"event":"response","requestId":"123.4","timestamp":1234567890.456,"status":200,"statusText":"OK","mimeType":"application/json","responseHeaders":{"content-type":"application/json","content-length":"1234"},"encodedDataLength":1234}
{"event":"finished","requestId":"123.4","timestamp":1234567890.789,"encodedDataLength":1234}
{"event":"failed","requestId":"123.4","timestamp":1234567890.789,"errorText":"net::ERR_FAILED","canceled":false}
```

When `network list` is called, it merges these into a unified view per requestId.

### Console message format (JSONL entries)

```json
{"msgId":"m1","level":"log","text":"Hello world","url":"https://example.com/app.js","lineNumber":42,"columnNumber":10,"timestamp":1234567890.123}
{"msgId":"m2","level":"error","text":"Uncaught TypeError: Cannot read properties of undefined","url":"https://example.com/app.js","lineNumber":100,"columnNumber":5,"timestamp":1234567890.456,"stackTrace":"..."}
```

### Display format for `network list`

```
12 requests captured (showing 8 matching):
  r1   GET  200  text/html         2.3KB   https://example.com/
  r2   GET  200  application/js    45.1KB  https://example.com/app.js
  r3   POST 200  application/json  0.4KB   https://example.com/api/v2/search
  r4   GET  304  image/png         0B      https://example.com/logo.png
  ...
```

### Display format for `network get r3`

```
POST https://example.com/api/v2/search
Status: 200 OK
Resource Type: Fetch
Time: 145ms

Request Headers:
  Content-Type: application/json
  Authorization: Bearer eyJ...
  Cookie: session=abc123

Request Body:
  {"query": "test", "page": 1}

Response Headers:
  content-type: application/json
  content-length: 1234
  
Response Body:
  {"results": [...], "total": 42, "page": 1}
```

### Display format for `console list`

```
8 console messages (showing 3 matching):
  m1  log      Hello world                                    app.js:42
  m2  error    Uncaught TypeError: Cannot read properties...  app.js:100
  m3  warning  Deprecation notice: fetch() with...            vendor.js:1500
```

### Implementation notes

- The background collector is spawned with `child_process.spawn` with `detached: true` and `stdio: 'ignore'`, then `unref()`'d so the parent CLI can exit immediately.
- The collector gets port, targetId, data file path, socket path as CLI arguments.
- Use `getCacheDir(agentId)` from refs.js for path consistency (extract to shared utility if needed).
- JSONL append uses `fs.appendFileSync` — fine for the throughput we expect.
- The unix socket protocol: newline-delimited JSON. Client sends one line, server responds with one line.
- `network list` assigns display IDs (r1, r2, ...) based on order in the file. These are NOT the CDP requestIds — they're sequential for readability. Store a mapping file or just use line-number-based indexing.
- `network get rN` resolves the display ID to the CDP requestId, then asks the collector for the body.
- For `--json` filter: check if responseHeaders contain `content-type: application/json` (or similar).
- For `--url` filter: use simple glob matching (convert `*` to `.*` regex).
- The `network clear` command truncates the JSONL file without stopping the collector.
- Add `network start` and `console start` to the help text in bin/agent-chrome.js.
- Update AGENTS.md and README.md with the new commands.

### Edge cases

- If collector is already running for a tab, `network start` should say so (check PID file + process existence).
- If collector dies unexpectedly, `network list` should still work (reads from file). `network get` will fail gracefully with "collector not running, cannot fetch body".
- Page navigation: CDP Network domain persists across navigations on the same target, so the collector keeps working.
- Tab close: collector will error on CDP disconnect and exit. PID file becomes stale — detect via `kill(pid, 0)`.

### Testing

After implementation, test with:
```bash
# Open a tab
agent-chrome tab new "https://jsonplaceholder.typicode.com/posts"

# Start network monitoring
agent-chrome --tab t2 network start

# Trigger some API requests via eval
agent-chrome --tab t2 eval "fetch('/posts/1').then(r => r.json())"
agent-chrome --tab t2 eval "fetch('/posts', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({title:'test',body:'hello',userId:1})})"

# List requests — should show the fetch calls
agent-chrome --tab t2 network list
agent-chrome --tab t2 network list --json

# Get full request/response details
agent-chrome --tab t2 network get r1

# Console monitoring
agent-chrome --tab t2 console start
agent-chrome --tab t2 eval "console.log('hello'); console.error('oh no'); console.warn('careful')"
agent-chrome --tab t2 console list
agent-chrome --tab t2 console list --level error
agent-chrome --tab t2 console get m1

# Cleanup
agent-chrome --tab t2 network stop
agent-chrome --tab t2 console stop
agent-chrome tab close t2
```
