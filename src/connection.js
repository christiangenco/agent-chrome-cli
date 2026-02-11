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

/**
 * Connect to the browser-level CDP target (not a specific page).
 * Needed for Target domain operations (create/close targets).
 * @param {number} port
 * @returns {Promise<CDP.Client>}
 */
export async function connectToBrowser(port) {
  const client = await CDP({ port });
  return client;
}

/**
 * Create a new tab (page target) via the CDP Target domain.
 * @param {number} port
 * @param {string} [url] - URL to open (default: about:blank)
 * @returns {Promise<{targetId: string}>}
 */
export async function createTab(port, url = 'about:blank') {
  const client = await connectToBrowser(port);
  try {
    const { targetId } = await client.Target.createTarget({ url });
    return { targetId };
  } finally {
    await client.close();
  }
}

/**
 * Close a tab (page target) via the CDP Target domain.
 * @param {number} port
 * @param {string} targetId
 * @returns {Promise<{success: boolean}>}
 */
export async function closeTab(port, targetId) {
  const client = await connectToBrowser(port);
  try {
    const { success } = await client.Target.closeTarget({ targetId });
    return { success };
  } finally {
    await client.close();
  }
}

/**
 * Create a new window via the CDP Target domain.
 * @param {number} port
 * @param {string} [url] - URL to open (default: about:blank)
 * @returns {Promise<{targetId: string}>}
 */
export async function createWindow(port, url = 'about:blank') {
  const client = await connectToBrowser(port);
  try {
    const { targetId } = await client.Target.createTarget({
      url,
      newWindow: true,
    });
    return { targetId };
  } finally {
    await client.close();
  }
}

/**
 * Close a window by closing all its tabs.
 * Uses Browser.getWindowForTarget to find the window, then closes all tabs in it.
 * @param {number} port
 * @param {string} anyTargetIdInWindow - A target ID of any tab in the window
 * @returns {Promise<{closed: number}>}
 */
export async function closeWindow(port, anyTargetIdInWindow) {
  const client = await connectToBrowser(port);
  try {
    // Get the windowId for this target
    const { windowId } = await client.Browser.getWindowForTarget({ targetId: anyTargetIdInWindow });

    // Find all page targets in this window
    const allTargets = await listTargets(port);
    let closed = 0;
    for (const target of allTargets) {
      try {
        const tw = await client.Browser.getWindowForTarget({ targetId: target.id });
        if (tw.windowId === windowId) {
          await client.Target.closeTarget({ targetId: target.id });
          closed++;
        }
      } catch {
        // target may already be gone
      }
    }
    return { closed };
  } finally {
    await client.close();
  }
}
