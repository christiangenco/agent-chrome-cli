/**
 * Tab listing and resolution.
 * Assigns short IDs (t1, t2, ...) to Chrome page targets.
 */
import { listTargets } from './connection.js';
import { loadTabMap, saveTabMap } from './refs.js';

/**
 * Build the tab list with short IDs.
 * Tries to preserve existing short IDs for known targets.
 * @param {number} port
 * @param {string} [agentId]
 * @returns {Promise<{tabs: Array<{shortId: string, targetId: string, title: string, url: string}>, map: object}>}
 */
export async function getTabs(port, agentId) {
  const targets = await listTargets(port);
  const oldMap = loadTabMap(port, agentId) || {};

  // Build reverse: targetId → old shortId
  const targetToShort = {};
  for (const [k, v] of Object.entries(oldMap)) {
    if (k.startsWith('t')) targetToShort[v] = k;
  }

  let nextNum = 1;
  // Find highest existing number so we don't reuse
  for (const k of Object.keys(oldMap)) {
    const m = k.match(/^t(\d+)$/);
    if (m) nextNum = Math.max(nextNum, parseInt(m[1], 10) + 1);
  }

  const newMap = {};
  const tabs = [];

  for (const target of targets) {
    // Reuse old short ID if target is known, otherwise assign new
    let shortId = targetToShort[target.id];
    if (!shortId) {
      shortId = `t${nextNum++}`;
    }
    newMap[shortId] = target.id;
    tabs.push({
      shortId,
      targetId: target.id,
      title: target.title,
      url: target.url,
    });
  }

  // Preserve __last if still valid
  if (oldMap.__last && newMap[oldMap.__last]) {
    newMap.__last = oldMap.__last;
  }

  saveTabMap(port, newMap, agentId);
  return { tabs, map: newMap };
}

/**
 * Resolve a tab argument to a CDP target ID.
 * Accepts: short ID (t1), nothing (uses __last or first tab).
 * @param {number} port
 * @param {string|undefined} tabArg
 * @param {string} [agentId]
 * @returns {Promise<{targetId: string, shortId: string}>}
 */
export async function resolveTab(port, tabArg, agentId) {
  const { tabs, map } = await getTabs(port, agentId);

  if (tabs.length === 0) {
    throw new Error('No Chrome page tabs found. Is Chrome running with --remote-debugging-port?');
  }

  if (tabArg) {
    // Look up by short ID
    const targetId = map[tabArg];
    if (!targetId) {
      const available = tabs.map(t => `${t.shortId} (${t.title.slice(0, 40)})`).join('\n  ');
      throw new Error(`Tab "${tabArg}" not found. Available tabs:\n  ${available}`);
    }
    // Update __last
    map.__last = tabArg;
    saveTabMap(port, map, agentId);
    return { targetId, shortId: tabArg };
  }

  // No tab specified — use __last or first
  const lastShort = map.__last;
  if (lastShort && map[lastShort]) {
    return { targetId: map[lastShort], shortId: lastShort };
  }

  // Default to first tab
  const first = tabs[0];
  map.__last = first.shortId;
  saveTabMap(port, map, agentId);
  return { targetId: first.targetId, shortId: first.shortId };
}
