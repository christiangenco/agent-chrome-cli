/**
 * Ref cache — persists the ref→backendDOMNodeId mapping between CLI invocations.
 *
 * Stored at ~/.agent-chrome/[agentId/]<port>-<targetId>.refs.json
 * Also stores the tab mapping (short id → CDP target id).
 *
 * When --agent-id is provided, cache files are namespaced into a subdirectory
 * so multiple agents can operate concurrently without clobbering each other.
 *
 * All writes use atomic write (temp file + rename) to prevent partial reads.
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

/**
 * Atomically write a file by writing to a temp file first, then renaming.
 * rename() is atomic on the same filesystem on Linux/macOS.
 */
function atomicWriteFileSync(filePath, data) {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.' + randomBytes(6).toString('hex') + '.tmp';
  writeFileSync(tmp, data);
  renameSync(tmp, filePath);
}

function getCacheDir(agentId) {
  const base = join(homedir(), '.agent-chrome');
  const dir = agentId ? join(base, agentId) : base;
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Ref cache (per tab) ─────────────────────────────────────────────

function refCachePath(port, targetId, agentId) {
  // Use first 8 chars of targetId to keep filenames short
  const short = targetId.slice(0, 8);
  return join(getCacheDir(agentId), `${port}-${short}.refs.json`);
}

/**
 * Save the ref map for a specific tab.
 * @param {number} port
 * @param {string} targetId
 * @param {Record<string, {backendDOMNodeId: number, role: string, name: string}>} refs
 * @param {string} [agentId]
 */
export function saveRefs(port, targetId, refs, agentId) {
  atomicWriteFileSync(refCachePath(port, targetId, agentId), JSON.stringify(refs, null, 2));
}

/**
 * Load the ref map for a specific tab.
 * @param {number} port
 * @param {string} targetId
 * @param {string} [agentId]
 * @returns {Record<string, {backendDOMNodeId: number, role: string, name: string}>|null}
 */
export function loadRefs(port, targetId, agentId) {
  const p = refCachePath(port, targetId, agentId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

// ── Tab mapping (port-level) ────────────────────────────────────────

function tabMapPath(port, agentId) {
  return join(getCacheDir(agentId), `${port}-tabs.json`);
}

/**
 * Save tab mapping: { shortId → cdpTargetId, __last → shortId }
 * @param {number} port
 * @param {object} map
 * @param {string} [agentId]
 */
export function saveTabMap(port, map, agentId) {
  atomicWriteFileSync(tabMapPath(port, agentId), JSON.stringify(map, null, 2));
}

/**
 * Load tab mapping.
 * @param {number} port
 * @param {string} [agentId]
 */
export function loadTabMap(port, agentId) {
  const p = tabMapPath(port, agentId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}
