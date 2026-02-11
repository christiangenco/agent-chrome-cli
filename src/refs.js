/**
 * Ref cache — persists the ref→backendDOMNodeId mapping between CLI invocations.
 *
 * Stored at ~/.agent-chrome/<port>-<targetId>.refs.json
 * Also stores the tab mapping (short id → CDP target id).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

function getCacheDir() {
  const dir = join(homedir(), '.agent-chrome');
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Ref cache (per tab) ─────────────────────────────────────────────

function refCachePath(port, targetId) {
  // Use first 8 chars of targetId to keep filenames short
  const short = targetId.slice(0, 8);
  return join(getCacheDir(), `${port}-${short}.refs.json`);
}

/**
 * Save the ref map for a specific tab.
 * @param {number} port
 * @param {string} targetId
 * @param {Record<string, {backendDOMNodeId: number, role: string, name: string}>} refs
 */
export function saveRefs(port, targetId, refs) {
  writeFileSync(refCachePath(port, targetId), JSON.stringify(refs, null, 2));
}

/**
 * Load the ref map for a specific tab.
 * @param {number} port
 * @param {string} targetId
 * @returns {Record<string, {backendDOMNodeId: number, role: string, name: string}>|null}
 */
export function loadRefs(port, targetId) {
  const p = refCachePath(port, targetId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

// ── Tab mapping (port-level) ────────────────────────────────────────

function tabMapPath(port) {
  return join(getCacheDir(), `${port}-tabs.json`);
}

/**
 * Save tab mapping: { shortId → cdpTargetId, __last → shortId }
 */
export function saveTabMap(port, map) {
  writeFileSync(tabMapPath(port), JSON.stringify(map, null, 2));
}

/**
 * Load tab mapping.
 */
export function loadTabMap(port) {
  const p = tabMapPath(port);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}
