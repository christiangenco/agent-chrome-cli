import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCacheDir } from './refs.js';
import { sendCommand } from './collectors/ipc.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function collectorPaths(port, targetId, agentId) {
  const short = targetId.slice(0, 8);
  const dir = getCacheDir(agentId);
  return {
    pid: join(dir, `network-${port}-${short}.pid`),
    data: join(dir, `network-${port}-${short}.jsonl`),
    sock: join(dir, `network-${port}-${short}.sock`),
  };
}

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function startNetworkCollector(port, targetId, agentId) {
  const paths = collectorPaths(port, targetId, agentId);

  if (existsSync(paths.pid)) {
    const pid = parseInt(readFileSync(paths.pid, 'utf8'), 10);
    if (isProcessAlive(pid)) {
      return { alreadyRunning: true, pid };
    }
    unlinkSync(paths.pid);
  }

  const child = spawn(
    process.execPath,
    [join(__dirname, 'collectors', 'network-collector.js'), String(port), targetId, paths.data, paths.sock],
    { detached: true, stdio: 'ignore' }
  );
  child.unref();

  writeFileSync(paths.pid, String(child.pid));
  return { started: true, pid: child.pid };
}

export function stopNetworkCollector(port, targetId, agentId) {
  const paths = collectorPaths(port, targetId, agentId);

  if (!existsSync(paths.pid)) {
    return { notRunning: true };
  }

  const pid = parseInt(readFileSync(paths.pid, 'utf8'), 10);
  if (isProcessAlive(pid)) {
    process.kill(pid, 'SIGTERM');
  }

  try { unlinkSync(paths.pid); } catch {}
  try { unlinkSync(paths.data); } catch {}
  try { unlinkSync(paths.sock); } catch {}
  return { stopped: true, pid };
}

export function clearNetworkData(port, targetId, agentId) {
  const paths = collectorPaths(port, targetId, agentId);
  if (existsSync(paths.data)) {
    writeFileSync(paths.data, '');
  }
  return { cleared: true };
}

function readEntries(dataPath) {
  if (!existsSync(dataPath)) return [];
  const lines = readFileSync(dataPath, 'utf8').trim().split('\n').filter(Boolean);
  const entries = [];
  for (const line of lines) {
    try { entries.push(JSON.parse(line)); } catch {}
  }
  return entries;
}

function mergeRequests(entries) {
  const map = new Map();
  for (const e of entries) {
    if (!map.has(e.requestId)) map.set(e.requestId, {});
    const req = map.get(e.requestId);
    if (e.event === 'request') {
      req.requestId = e.requestId;
      req.url = e.url;
      req.method = e.method;
      req.resourceType = e.resourceType;
      req.requestHeaders = e.requestHeaders;
      req.postData = e.postData;
      req.requestTimestamp = e.timestamp;
    } else if (e.event === 'response') {
      req.status = e.status;
      req.statusText = e.statusText;
      req.mimeType = e.mimeType;
      req.responseHeaders = e.responseHeaders;
      req.responseTimestamp = e.timestamp;
      req.encodedDataLength = e.encodedDataLength;
    } else if (e.event === 'finished') {
      req.finished = true;
      req.finishedTimestamp = e.timestamp;
      req.encodedDataLength = e.encodedDataLength;
    } else if (e.event === 'failed') {
      req.failed = true;
      req.errorText = e.errorText;
      req.canceled = e.canceled;
    }
  }
  return [...map.values()].filter(r => r.url);
}

function matchGlob(pattern, str) {
  const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return re.test(str);
}

export function listNetworkRequests(port, targetId, agentId, filters = {}) {
  const paths = collectorPaths(port, targetId, agentId);
  const entries = readEntries(paths.data);
  const allRequests = mergeRequests(entries);

  let filtered = allRequests;

  if (filters.type) {
    const types = filters.type.split(',').map(t => t.trim().toLowerCase());
    filtered = filtered.filter(r => types.includes((r.resourceType || '').toLowerCase()));
  }

  if (filters.url) {
    filtered = filtered.filter(r => matchGlob(filters.url, r.url));
  }

  if (filters.status) {
    const status = parseInt(filters.status, 10);
    filtered = filtered.filter(r => r.status === status);
  }

  if (filters.json) {
    filtered = filtered.filter(r => (r.mimeType || '').includes('json'));
  }

  return { total: allRequests.length, requests: filtered };
}

export async function getNetworkRequest(port, targetId, agentId, displayId) {
  const paths = collectorPaths(port, targetId, agentId);
  const entries = readEntries(paths.data);
  const allRequests = mergeRequests(entries);

  const idx = parseInt(displayId.replace(/^r/, ''), 10) - 1;
  if (idx < 0 || idx >= allRequests.length) {
    throw new Error(`Request ${displayId} not found. ${allRequests.length} requests captured.`);
  }

  const req = allRequests[idx];
  let body = null;
  let bodyError = null;

  if (existsSync(paths.sock) && existsSync(paths.pid)) {
    const pid = parseInt(readFileSync(paths.pid, 'utf8'), 10);
    if (isProcessAlive(pid)) {
      try {
        const resp = await sendCommand(paths.sock, { cmd: 'getBody', requestId: req.requestId });
        if (resp.ok) {
          body = resp.base64Encoded ? Buffer.from(resp.body, 'base64').toString('utf8') : resp.body;
        } else {
          bodyError = resp.error;
        }
      } catch (err) {
        bodyError = err.message;
      }
    } else {
      bodyError = 'Collector not running — cannot fetch response body.';
    }
  } else {
    bodyError = 'Collector not running — cannot fetch response body.';
  }

  return { ...req, body, bodyError, displayId };
}

export function formatNetworkList(total, requests) {
  const lines = [];
  lines.push(`${total} requests captured${requests.length !== total ? ` (showing ${requests.length} matching)` : ''}:`);

  const allRequests = requests;
  for (let i = 0; i < allRequests.length; i++) {
    const r = allRequests[i];
    const id = `r${i + 1}`;
    const method = (r.method || '?').padEnd(6);
    const status = r.failed ? 'FAIL' : String(r.status || '...').padEnd(4);
    const mime = (r.mimeType || '').replace(/^application\//, '').slice(0, 20).padEnd(20);
    const size = r.encodedDataLength != null ? formatBytes(r.encodedDataLength).padStart(8) : '     ?  ';
    const url = truncUrl(r.url, 80);
    lines.push(`  ${id.padEnd(5)} ${method} ${status} ${mime} ${size}  ${url}`);
  }
  return lines.join('\n');
}

export function formatNetworkDetail(req) {
  const lines = [];
  lines.push(`${req.method} ${req.url}`);
  lines.push(`Status: ${req.status || '?'} ${req.statusText || ''}`);
  if (req.resourceType) lines.push(`Resource Type: ${req.resourceType}`);
  if (req.requestTimestamp && req.responseTimestamp) {
    const ms = Math.round((req.responseTimestamp - req.requestTimestamp) * 1000);
    lines.push(`Time: ${ms}ms`);
  }

  if (req.requestHeaders && Object.keys(req.requestHeaders).length) {
    lines.push('\nRequest Headers:');
    for (const [k, v] of Object.entries(req.requestHeaders)) {
      lines.push(`  ${k}: ${v}`);
    }
  }

  if (req.postData) {
    lines.push('\nRequest Body:');
    lines.push(`  ${tryPrettyJson(req.postData)}`);
  }

  if (req.responseHeaders && Object.keys(req.responseHeaders).length) {
    lines.push('\nResponse Headers:');
    for (const [k, v] of Object.entries(req.responseHeaders)) {
      lines.push(`  ${k}: ${v}`);
    }
  }

  if (req.body != null) {
    lines.push('\nResponse Body:');
    lines.push(`  ${tryPrettyJson(req.body)}`);
  } else if (req.bodyError) {
    lines.push(`\nResponse Body: (unavailable — ${req.bodyError})`);
  }

  return lines.join('\n');
}

function formatBytes(bytes) {
  if (bytes === 0) return '0B';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function truncUrl(url, max) {
  return url.length <= max ? url : url.slice(0, max - 3) + '...';
}

function tryPrettyJson(str) {
  try {
    return JSON.stringify(JSON.parse(str), null, 2).replace(/\n/g, '\n  ');
  } catch {
    return str;
  }
}
