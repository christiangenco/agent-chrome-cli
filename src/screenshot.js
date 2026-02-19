/**
 * Screenshot — captures the visible viewport or full page as PNG.
 * Supports --annotate to overlay numbered labels on interactive elements.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { getSnapshot } from './snapshot.js';

const ANNOTATION_OVERLAY_ID = '__agent_chrome_annotations__';

/**
 * For each ref, resolve its backendDOMNodeId to a bounding box via CDP.
 * Returns array of {ref, number, role, name, box: {x, y, width, height}} or null.
 */
async function getRefBoundingBoxes(client, refs) {
  const { DOM, Runtime } = client;
  const entries = Object.entries(refs);

  const results = await Promise.all(entries.map(async ([ref, data]) => {
    try {
      const { object } = await DOM.resolveNode({ backendNodeId: data.backendDOMNodeId });
      if (!object || !object.objectId) return null;

      const { result } = await Runtime.callFunctionOn({
        objectId: object.objectId,
        functionDeclaration: `function() {
          const r = this.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }`,
        returnByValue: true,
      });
      await Runtime.releaseObject({ objectId: object.objectId }).catch(() => {});

      const box = result.value;
      if (!box || box.width === 0 || box.height === 0) return null;

      const num = parseInt(ref.replace('e', ''), 10);
      return {
        ref,
        number: num,
        role: data.role,
        name: data.name || undefined,
        box: {
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
        },
      };
    } catch {
      return null;
    }
  }));

  return results.filter(a => a !== null).sort((a, b) => a.number - b.number);
}

/**
 * Inject the annotation overlay into the page.
 * Draws red bordered boxes with numbered labels on each interactive element.
 */
async function injectAnnotationOverlay(client, items) {
  const overlayData = items.map(a => ({
    number: a.number,
    x: a.box.x,
    y: a.box.y,
    width: a.box.width,
    height: a.box.height,
  }));

  await client.Runtime.evaluate({
    expression: `(() => {
      var items = ${JSON.stringify(overlayData)};
      var id = ${JSON.stringify(ANNOTATION_OVERLAY_ID)};
      var sx = window.scrollX || 0;
      var sy = window.scrollY || 0;
      var c = document.createElement('div');
      c.id = id;
      c.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483647;';
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var dx = it.x + sx;
        var dy = it.y + sy;
        var b = document.createElement('div');
        b.style.cssText = 'position:absolute;left:' + dx + 'px;top:' + dy + 'px;width:' + it.width + 'px;height:' + it.height + 'px;border:2px solid rgba(255,0,0,0.8);box-sizing:border-box;pointer-events:none;';
        var l = document.createElement('div');
        l.textContent = String(it.number);
        var labelTop = dy < 14 ? '2px' : '-14px';
        l.style.cssText = 'position:absolute;top:' + labelTop + ';left:-2px;background:rgba(255,0,0,0.9);color:#fff;font:bold 11px/14px monospace;padding:0 4px;border-radius:2px;white-space:nowrap;';
        b.appendChild(l);
        c.appendChild(b);
      }
      document.documentElement.appendChild(c);
    })()`,
    returnByValue: true,
  });
}

/**
 * Remove the annotation overlay from the page.
 */
async function removeAnnotationOverlay(client) {
  await client.Runtime.evaluate({
    expression: `(() => { const el = document.getElementById(${JSON.stringify(ANNOTATION_OVERLAY_ID)}); if (el) el.remove(); })()`,
    returnByValue: true,
  }).catch(() => {});
}

/**
 * Take a screenshot and save to disk.
 * @param {CDP.Client} client
 * @param {string} [savePath] - Where to save. If omitted, auto-generates in ~/.agent-chrome/screenshots/
 * @param {object} [opts] - {fullPage?: boolean, annotate?: boolean, format?: 'png'|'jpeg', quality?: number}
 * @returns {Promise<{path: string, annotations?: Array}>}
 */
export async function screenshot(client, savePath, opts = {}) {
  const { Page } = client;

  const format = opts.format || 'png';
  const params = { format };
  if (format === 'jpeg' && opts.quality) {
    params.quality = opts.quality;
  }

  let overlayInjected = false;
  let annotations;

  try {
    // Annotation: get interactive snapshot, compute bounding boxes, inject overlay
    if (opts.annotate) {
      const { refs } = await getSnapshot(client, { interactive: true });
      const items = await getRefBoundingBoxes(client, refs);

      if (items.length > 0) {
        await injectAnnotationOverlay(client, items);
        overlayInjected = true;
      }

      // Build returned annotation metadata with image-relative coordinates.
      // fullPage: convert to document-relative (matching fullPage image origin).
      // Default (viewport): unchanged.
      if (opts.fullPage) {
        const { result: scrollResult } = await client.Runtime.evaluate({
          expression: `JSON.stringify({ x: window.scrollX || 0, y: window.scrollY || 0 })`,
          returnByValue: true,
        });
        const scroll = JSON.parse(scrollResult.value);
        annotations = items.map(a => ({
          ...a,
          box: {
            x: a.box.x + scroll.x,
            y: a.box.y + scroll.y,
            width: a.box.width,
            height: a.box.height,
          },
        }));
      } else {
        annotations = items;
      }
    }

    if (opts.fullPage) {
      const { result } = await client.Runtime.evaluate({
        expression: `JSON.stringify({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })`,
        returnByValue: true,
      });
      const dims = JSON.parse(result.value);
      params.clip = { x: 0, y: 0, width: dims.width, height: dims.height, scale: 1 };
      params.captureBeyondViewport = true;
    }

    const { data } = await Page.captureScreenshot(params);
    const buffer = Buffer.from(data, 'base64');

    if (!savePath) {
      const ext = format === 'jpeg' ? 'jpg' : 'png';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const random = Math.random().toString(36).substring(2, 8);
      const dir = join(homedir(), '.agent-chrome', 'screenshots');
      mkdirSync(dir, { recursive: true });
      savePath = join(dir, `screenshot-${timestamp}-${random}.${ext}`);
    }

    mkdirSync(dirname(savePath), { recursive: true });
    writeFileSync(savePath, buffer);

    if (overlayInjected) {
      await removeAnnotationOverlay(client);
    }

    return {
      path: savePath,
      ...(annotations && annotations.length > 0 ? { annotations } : {}),
    };
  } catch (error) {
    if (overlayInjected) {
      await removeAnnotationOverlay(client);
    }
    throw error;
  }
}
