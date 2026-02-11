/**
 * Actions — click, fill, type, check, select, press, scroll, navigate, eval.
 * All interactions use backendDOMNodeId from the ref cache.
 */

import { loadRefs } from './refs.js';

/**
 * Parse a ref argument like "@e5" or "e5" and return the ref data.
 * @param {number} port
 * @param {string} targetId
 * @param {string} refArg
 * @param {string} [agentId]
 * @returns {{backendDOMNodeId: number, role: string, name: string}}
 */
export function resolveRef(port, targetId, refArg, agentId) {
  const refs = loadRefs(port, targetId, agentId);
  if (!refs) {
    throw new Error('No snapshot taken yet. Run `agent-chrome snapshot` first to get element refs.');
  }

  let refKey = refArg;
  if (refKey.startsWith('@')) refKey = refKey.slice(1);
  if (refKey.startsWith('ref=')) refKey = refKey.slice(4);

  const data = refs[refKey];
  if (!data) {
    const available = Object.keys(refs).slice(0, 10).join(', ');
    throw new Error(`Ref "${refArg}" not found. Available refs: ${available}${Object.keys(refs).length > 10 ? '...' : ''}. Run \`agent-chrome snapshot\` to refresh.`);
  }
  return data;
}

/**
 * Resolve a backendDOMNodeId to a Runtime object, then call a function on it.
 */
async function callOnNode(client, backendDOMNodeId, fn, ...args) {
  const { DOM, Runtime } = client;
  const { object } = await DOM.resolveNode({ backendNodeId: backendDOMNodeId });
  if (!object || !object.objectId) {
    throw new Error('Element no longer exists in the DOM. Run `agent-chrome snapshot` to refresh refs.');
  }
  const result = await Runtime.callFunctionOn({
    objectId: object.objectId,
    functionDeclaration: fn,
    arguments: args.map(a => ({ value: a })),
    returnByValue: true,
  });
  // Release the object
  await Runtime.releaseObject({ objectId: object.objectId }).catch(() => {});
  if (result.exceptionDetails) {
    throw new Error(`Action failed: ${result.exceptionDetails.text || result.exceptionDetails.exception?.description || 'unknown error'}`);
  }
  return result.result?.value;
}

/**
 * Click an element by ref.
 */
export async function click(client, port, targetId, refArg, agentId) {
  const ref = resolveRef(port, targetId, refArg, agentId);

  // Scroll into view, then click
  await callOnNode(client, ref.backendDOMNodeId, `function() {
    this.scrollIntoView({ block: 'center', behavior: 'instant' });
  }`);

  // Small delay for scroll to settle
  await new Promise(r => setTimeout(r, 50));

  await callOnNode(client, ref.backendDOMNodeId, `function() {
    this.click();
  }`);

  return { clicked: true, ref: refArg, role: ref.role, name: ref.name };
}

/**
 * Fill an element — clear then set value. Works for inputs, textareas, contenteditable.
 * Uses the Input.insertText approach for React/Angular compatibility.
 */
export async function fill(client, port, targetId, refArg, text, agentId) {
  const ref = resolveRef(port, targetId, refArg, agentId);
  const { DOM, Input } = client;

  // Focus the element
  await DOM.focus({ backendNodeId: ref.backendDOMNodeId });

  // Select all existing content
  await Input.dispatchKeyEvent({ type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 }); // Ctrl+A
  await Input.dispatchKeyEvent({ type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 });

  // Delete selected content
  await Input.dispatchKeyEvent({ type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
  await Input.dispatchKeyEvent({ type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });

  // Insert new text (fires all the right input events for React etc.)
  if (text) {
    await Input.insertText({ text });
  }

  // Also dispatch change event for good measure
  await callOnNode(client, ref.backendDOMNodeId, `function() {
    this.dispatchEvent(new Event('change', { bubbles: true }));
  }`);

  return { filled: true, ref: refArg, text };
}

/**
 * Type text into the focused element or a specific ref (append, don't clear).
 */
export async function type(client, port, targetId, refArg, text, agentId) {
  const ref = resolveRef(port, targetId, refArg, agentId);
  const { DOM, Input } = client;

  // Focus the element
  await DOM.focus({ backendNodeId: ref.backendDOMNodeId });

  // Insert text (appends to existing content)
  await Input.insertText({ text });

  return { typed: true, ref: refArg, text };
}

/**
 * Select a dropdown option by value or label.
 */
export async function select(client, port, targetId, refArg, value, agentId) {
  const ref = resolveRef(port, targetId, refArg, agentId);

  const result = await callOnNode(client, ref.backendDOMNodeId, `function(val) {
    if (this.tagName !== 'SELECT') {
      // For combobox roles, try clicking to open and finding the option
      this.click();
      return { note: 'Not a <select>. Clicked to open — use click on the option ref instead.' };
    }
    // Try by value first, then by visible text
    let option = Array.from(this.options).find(o => o.value === val);
    if (!option) option = Array.from(this.options).find(o => o.textContent.trim() === val);
    if (!option) {
      const available = Array.from(this.options).map(o => o.textContent.trim()).join(', ');
      return { error: 'Option not found: ' + val + '. Available: ' + available };
    }
    this.value = option.value;
    this.dispatchEvent(new Event('change', { bubbles: true }));
    return { selected: option.textContent.trim(), value: option.value };
  }`, value);

  if (result?.error) throw new Error(result.error);
  return result;
}

/**
 * Check a checkbox or radio.
 */
export async function check(client, port, targetId, refArg, agentId) {
  const ref = resolveRef(port, targetId, refArg, agentId);
  await callOnNode(client, ref.backendDOMNodeId, `function() {
    if (!this.checked) this.click();
  }`);
  return { checked: true, ref: refArg };
}

/**
 * Uncheck a checkbox.
 */
export async function uncheck(client, port, targetId, refArg, agentId) {
  const ref = resolveRef(port, targetId, refArg, agentId);
  await callOnNode(client, ref.backendDOMNodeId, `function() {
    if (this.checked) this.click();
  }`);
  return { unchecked: true, ref: refArg };
}

/**
 * Focus an element.
 */
export async function focus(client, port, targetId, refArg, agentId) {
  const ref = resolveRef(port, targetId, refArg, agentId);
  await client.DOM.focus({ backendNodeId: ref.backendDOMNodeId });
  return { focused: true, ref: refArg };
}

/**
 * Hover an element (scroll into view + move mouse to center).
 */
export async function hover(client, port, targetId, refArg, agentId) {
  const ref = resolveRef(port, targetId, refArg, agentId);

  // Scroll into view and get bounding rect
  const rect = await callOnNode(client, ref.backendDOMNodeId, `function() {
    this.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = this.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  }`);

  await new Promise(r => setTimeout(r, 50));

  await client.Input.dispatchMouseEvent({
    type: 'mouseMoved',
    x: rect.x,
    y: rect.y,
  });

  return { hovered: true, ref: refArg };
}

/**
 * Press a key (e.g., 'Enter', 'Tab', 'Escape', 'ArrowDown').
 */
export async function press(client, key) {
  const { Input } = client;

  // Map common key names to CDP key event params
  const keyMap = {
    'Enter': { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
    'Tab': { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
    'Escape': { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
    'Backspace': { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
    'Delete': { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
    'ArrowUp': { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
    'ArrowDown': { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
    'ArrowLeft': { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
    'ArrowRight': { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
    'Space': { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 },
  };

  const mapped = keyMap[key] || { key, code: key, windowsVirtualKeyCode: 0 };

  await Input.dispatchKeyEvent({
    type: 'keyDown',
    ...mapped,
    nativeVirtualKeyCode: mapped.windowsVirtualKeyCode,
  });
  await Input.dispatchKeyEvent({
    type: 'keyUp',
    ...mapped,
    nativeVirtualKeyCode: mapped.windowsVirtualKeyCode,
  });

  return { pressed: key };
}

/**
 * Scroll the page.
 * @param {string} direction - up, down, left, right
 * @param {number} amount - pixels (default 400)
 */
export async function scroll(client, direction, amount = 400) {
  const { Input } = client;
  let deltaX = 0, deltaY = 0;
  switch (direction) {
    case 'up': deltaY = -amount; break;
    case 'down': deltaY = amount; break;
    case 'left': deltaX = -amount; break;
    case 'right': deltaX = amount; break;
    default: throw new Error(`Invalid scroll direction: ${direction}. Use up/down/left/right.`);
  }

  await Input.dispatchMouseEvent({
    type: 'mouseWheel',
    x: 400, y: 300, // center-ish of viewport
    deltaX,
    deltaY,
  });

  return { scrolled: direction, amount };
}

/**
 * Navigate to a URL.
 */
export async function navigate(client, url) {
  const { Page } = client;
  // Add protocol if missing
  if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('about:')) {
    url = 'https://' + url;
  }
  const result = await Page.navigate({ url });
  if (result.errorText) {
    throw new Error(`Navigation failed: ${result.errorText}`);
  }
  // Wait for load with timeout
  await waitForLoad(Page, 10000);
  return { navigated: url };
}

/**
 * Wait for page to be reasonably loaded (with timeout).
 */
async function waitForLoad(Page, timeoutMs = 3000) {
  await Promise.race([
    Page.loadEventFired(),
    new Promise(r => setTimeout(r, timeoutMs)),
  ]);
}

/**
 * Go back.
 */
export async function goBack(client) {
  const { Page } = client;
  const { currentIndex, entries } = await Page.getNavigationHistory();
  if (currentIndex > 0) {
    await Page.navigateToHistoryEntry({ entryId: entries[currentIndex - 1].id });
    await waitForLoad(Page);
  }
  return { back: true };
}

/**
 * Go forward.
 */
export async function goForward(client) {
  const { Page } = client;
  const { currentIndex, entries } = await Page.getNavigationHistory();
  if (currentIndex < entries.length - 1) {
    await Page.navigateToHistoryEntry({ entryId: entries[currentIndex + 1].id });
    await waitForLoad(Page);
  }
  return { forward: true };
}

/**
 * Reload.
 */
export async function reload(client) {
  const { Page } = client;
  await Page.reload();
  await waitForLoad(Page);
  return { reloaded: true };
}

/**
 * Evaluate JavaScript in the page.
 */
export async function evaluate(client, expression) {
  const { Runtime } = client;
  const { result, exceptionDetails } = await Runtime.evaluate({
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) {
    throw new Error(`JS error: ${exceptionDetails.text || exceptionDetails.exception?.description || 'unknown'}`);
  }
  return result.value;
}

/**
 * Get the current URL.
 */
export async function getUrl(client) {
  const result = await evaluate(client, 'location.href');
  return result;
}

/**
 * Get the page title.
 */
export async function getTitle(client) {
  const result = await evaluate(client, 'document.title');
  return result;
}

/**
 * Upload files to a file input element by ref.
 * Uses CDP's DOM.setFileInputFiles to set files directly on the input.
 * @param {CDP.Client} client
 * @param {number} port
 * @param {string} targetId
 * @param {string} refArg - ref like "@e5"
 * @param {string[]} filePaths - absolute paths to files
 */
export async function upload(client, port, targetId, refArg, filePaths, agentId) {
  const ref = resolveRef(port, targetId, refArg, agentId);
  const { DOM } = client;

  // Resolve absolute paths
  const path = await import('path');
  const fs = await import('fs');
  const resolvedPaths = filePaths.map(f => path.resolve(f));

  // Verify files exist
  for (const p of resolvedPaths) {
    if (!fs.existsSync(p)) {
      throw new Error(`File not found: ${p}`);
    }
  }

  // Set files on the input element
  await DOM.setFileInputFiles({
    files: resolvedPaths,
    backendNodeId: ref.backendDOMNodeId,
  });

  // Dispatch change event so frameworks pick it up
  await callOnNode(client, ref.backendDOMNodeId, `function() {
    this.dispatchEvent(new Event('change', { bubbles: true }));
    this.dispatchEvent(new Event('input', { bubbles: true }));
  }`);

  return { uploaded: resolvedPaths, ref: refArg };
}

/**
 * Wait for a specified number of milliseconds.
 */
export async function wait(ms) {
  await new Promise(r => setTimeout(r, ms));
  return { waited: ms };
}

/**
 * Scroll an element into view by ref.
 */
export async function scrollIntoView(client, port, targetId, refArg, agentId) {
  const ref = resolveRef(port, targetId, refArg, agentId);
  await callOnNode(client, ref.backendDOMNodeId, `function() {
    this.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }`);
  return { scrolled: true, ref: refArg };
}
