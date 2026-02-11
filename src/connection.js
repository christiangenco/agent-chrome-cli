/**
 * CDP connection management.
 * Connects to a running Chrome instance and provides access to specific tabs.
 */
import CDP from 'chrome-remote-interface';

/**
 * List all page targets from Chrome's CDP endpoint.
 * Filters out service workers, extensions, devtools, etc.
 * @param {number} port
 * @returns {Promise<Array<{id: string, title: string, url: string, type: string}>>}
 */
export async function listTargets(port) {
  const targets = await CDP.List({ port });
  return targets.filter(t => t.type === 'page' && !t.url.startsWith('chrome-extension://'));
}

/**
 * Connect to a specific tab by its CDP target ID.
 * @param {number} port
 * @param {string} targetId - Full CDP target ID
 * @returns {Promise<CDP.Client>}
 */
export async function connectToTarget(port, targetId) {
  const client = await CDP({ port, target: targetId });
  // Enable the domains we need
  await client.Page.enable();
  await client.DOM.enable();
  await client.Runtime.enable();
  return client;
}
