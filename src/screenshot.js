/**
 * Screenshot — captures the visible viewport or full page as PNG.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

/**
 * Take a screenshot and save to disk.
 * @param {CDP.Client} client
 * @param {string} [savePath] - Where to save. If omitted, auto-generates in ~/.agent-chrome/screenshots/
 * @param {object} [opts] - {fullPage?: boolean, format?: 'png'|'jpeg', quality?: number}
 * @returns {Promise<{path: string}>}
 */
export async function screenshot(client, savePath, opts = {}) {
  const { Page } = client;

  const format = opts.format || 'png';
  const params = { format };
  if (format === 'jpeg' && opts.quality) {
    params.quality = opts.quality;
  }

  if (opts.fullPage) {
    // Get full page metrics
    const { Layout } = client;
    // Get the full page dimensions via JS
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

  return { path: savePath };
}
