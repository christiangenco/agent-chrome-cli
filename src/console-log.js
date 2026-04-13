import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCacheDir } from './refs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function collectorPaths(port, targetId, agentId) {
  const short = targetId.slice(0, 8);
  const dir = getCacheDir(agentId);
  return {
    pid: join(dir, `console-${port}-${short}.pid`),
    data: join(dir, `console-${port}-${short}.jsonl`),
  };
}

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function startConsoleCollector(port, targetId, agentId) {
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
    [join(__dirname, 'collectors', 'console-collector.js'), String(port), targetId, paths.data],
    { detached: true, stdio: 'ignore' }
  );
  child.unref();

  writeFileSync(paths.pid, String(child.pid));
  return { started: true, pid: child.pid };
}

export function stopConsoleCollector(port, targetId, agentId) {
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
  return { stopped: true, pid };
}

export function clearConsoleData(port, targetId, agentId) {
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

export function listConsoleMessages(port, targetId, agentId, filters = {}) {
  const paths = collectorPaths(port, targetId, agentId);
  const all = readEntries(paths.data);

  let filtered = all;
  if (filters.level) {
    const levels = filters.level.split(',').map(l => l.trim().toLowerCase());
    filtered = filtered.filter(m => levels.includes(m.level));
  }

  return { total: all.length, messages: filtered };
}

export function getConsoleMessage(port, targetId, agentId, displayId) {
  const paths = collectorPaths(port, targetId, agentId);
  const all = readEntries(paths.data);

  const idx = parseInt(displayId.replace(/^m/, ''), 10) - 1;
  if (idx < 0 || idx >= all.length) {
    throw new Error(`Message ${displayId} not found. ${all.length} messages captured.`);
  }

  return all[idx];
}

export function formatConsoleList(total, messages) {
  const lines = [];
  lines.push(`${total} console messages${messages.length !== total ? ` (showing ${messages.length} matching)` : ''}:`);

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const id = m.msgId || `m${i + 1}`;
    const level = m.level.padEnd(8);
    const text = m.text.length > 55 ? m.text.slice(0, 52) + '...' : m.text.padEnd(55);
    const file = m.url ? m.url.split('/').pop() + ':' + m.lineNumber : '';
    lines.push(`  ${id.padEnd(5)} ${level} ${text}  ${file}`);
  }
  return lines.join('\n');
}

export function formatConsoleDetail(msg) {
  const lines = [];
  lines.push(`[${msg.level}] ${msg.text}`);
  if (msg.url) lines.push(`Source: ${msg.url}:${msg.lineNumber}:${msg.columnNumber}`);
  if (msg.stackTrace) {
    lines.push('\nStack Trace:');
    lines.push(msg.stackTrace);
  }
  return lines.join('\n');
}
