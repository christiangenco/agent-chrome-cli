#!/usr/bin/env node

/**
 * agent-chrome — CLI for AI agents to interact with a running Chrome via CDP.
 *
 * Usage:
 *   agent-chrome tabs                         List all tabs
 *   agent-chrome [--tab t1] snapshot [-ic]    Accessibility snapshot
 *   agent-chrome [--tab t1] click @e5         Click element
 *   agent-chrome [--tab t1] fill @e3 "text"   Clear and fill
 *   agent-chrome [--tab t1] screenshot        Take screenshot
 *   agent-chrome --help                       Show help
 */

import { getTabs, resolveTab } from '../src/tabs.js';
import { connectToTarget } from '../src/connection.js';
import { getSnapshot } from '../src/snapshot.js';
import { saveRefs } from '../src/refs.js';
import { screenshot } from '../src/screenshot.js';
import * as actions from '../src/actions.js';

// ── Parse arguments ──────────────────────────────────────────────────

const args = process.argv.slice(2);
let port = parseInt(process.env.AGENT_CHROME_PORT || '9222', 10);
let tabArg = undefined;

// Extract --port and --tab flags
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' || args[i] === '-p') {
    port = parseInt(args[++i], 10);
  } else if (args[i] === '--tab' || args[i] === '-t') {
    tabArg = args[++i];
  } else if (args[i].startsWith('--port=')) {
    port = parseInt(args[i].split('=')[1], 10);
  } else if (args[i].startsWith('--tab=')) {
    tabArg = args[i].split('=')[1];
  } else {
    positional.push(args[i]);
  }
}

const command = positional[0];
const restArgs = positional.slice(1);

// ── Help ─────────────────────────────────────────────────────────────

if (!command || command === '--help' || command === '-h' || command === 'help') {
  console.log(`agent-chrome — interact with your running Chrome via CDP

Usage: agent-chrome [--port <port>] [--tab <id>] <command> [args]

Tab Management:
  tabs                          List all Chrome tabs with short IDs

Snapshots:
  snapshot                      Accessibility tree with refs
  snapshot -i, --interactive    Only interactive elements
  snapshot -c, --compact        Remove empty structural elements
  snapshot -ic                  Both interactive and compact

Interactions:
  click @eN                     Click element by ref
  fill @eN "text"               Clear field and type text
  type @eN "text"               Append text to field
  select @eN "value"            Select dropdown option
  check @eN                     Check checkbox/radio
  uncheck @eN                   Uncheck checkbox
  focus @eN                     Focus element
  hover @eN                     Hover element
  press <key>                   Press key (Enter, Tab, Escape, ArrowDown, ...)
  scroll <dir> [px]             Scroll page (up/down/left/right, default 400px)
  scrollintoview @eN            Scroll element into view

Navigation:
  open <url>                    Navigate to URL
  back                          Go back
  forward                       Go forward
  reload                        Reload page

Info:
  screenshot [path]             Take screenshot (PNG)
  eval <js>                     Run JavaScript
  get url                       Get current URL
  get title                     Get page title
  wait <ms>                     Wait milliseconds

Options:
  --port, -p <port>             Chrome debug port (default: 9222, or AGENT_CHROME_PORT)
  --tab, -t <id>                Target tab (e.g., t1). Omit to use last-used tab.
  --help, -h                    Show this help

Prerequisites:
  Start Chrome with: google-chrome --remote-debugging-port=9222
`);
  process.exit(0);
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  try {
    // Commands that don't need a tab connection
    if (command === 'tabs') {
      return await cmdTabs();
    }

    // All other commands need a tab
    const { targetId, shortId } = await resolveTab(port, tabArg);
    const client = await connectToTarget(port, targetId);

    try {
      switch (command) {
        case 'snapshot': return await cmdSnapshot(client, targetId, shortId);
        case 'screenshot': return await cmdScreenshot(client);
        case 'click': return await cmdClick(client, targetId);
        case 'fill': return await cmdFill(client, targetId);
        case 'type': return await cmdType(client, targetId);
        case 'select': return await cmdSelect(client, targetId);
        case 'check': return await cmdCheck(client, targetId);
        case 'uncheck': return await cmdUncheck(client, targetId);
        case 'focus': return await cmdFocus(client, targetId);
        case 'hover': return await cmdHover(client, targetId);
        case 'press': return await cmdPress(client);
        case 'scroll': return await cmdScroll(client);
        case 'scrollintoview': return await cmdScrollIntoView(client, targetId);
        case 'open': return await cmdOpen(client);
        case 'back': return await cmdBack(client);
        case 'forward': return await cmdForward(client);
        case 'reload': return await cmdReload(client);
        case 'eval': return await cmdEval(client);
        case 'get': return await cmdGet(client);
        case 'wait': return await cmdWait();
        default:
          error(`Unknown command: ${command}. Run 'agent-chrome --help' for usage.`);
      }
    } finally {
      await client.close();
    }
  } catch (err) {
    error(err.message || String(err));
  }
}

// ── Command handlers ─────────────────────────────────────────────────

async function cmdTabs() {
  const { tabs } = await getTabs(port);
  if (tabs.length === 0) {
    console.log('No Chrome page tabs found.');
    return;
  }
  console.log(`${tabs.length} tab${tabs.length > 1 ? 's' : ''}:`);
  for (const tab of tabs) {
    console.log(`  ${tab.shortId}  ${tab.title.slice(0, 60).padEnd(60)}  ${tab.url}`);
  }
}

async function cmdSnapshot(client, targetId, shortId) {
  // Parse snapshot flags
  let interactive = false;
  let compact = false;
  let maxDepth = undefined;

  for (const arg of restArgs) {
    if (arg === '-i' || arg === '--interactive') interactive = true;
    else if (arg === '-c' || arg === '--compact') compact = true;
    else if (arg === '-ic' || arg === '-ci') { interactive = true; compact = true; }
    else if (arg === '-d' || arg === '--depth') { /* next arg is depth */ }
    else if (/^\d+$/.test(arg) && restArgs[restArgs.indexOf(arg) - 1]?.match(/^(-d|--depth)$/)) {
      maxDepth = parseInt(arg, 10);
    }
  }

  // Handle -d N
  const dIdx = restArgs.findIndex(a => a === '-d' || a === '--depth');
  if (dIdx !== -1 && restArgs[dIdx + 1]) {
    maxDepth = parseInt(restArgs[dIdx + 1], 10);
  }

  const { tree, refs } = await getSnapshot(client, { interactive, compact, maxDepth });

  // Save refs for subsequent commands
  saveRefs(port, targetId, refs);

  // Get current URL for context
  const url = await actions.getUrl(client);

  console.log(`[${shortId}] ${url}`);
  console.log(tree);

  // Stats
  const refCount = Object.keys(refs).length;
  const interactiveCount = Object.values(refs).filter(r =>
    ['button','link','textbox','checkbox','radio','combobox','listbox',
     'menuitem','searchbox','slider','spinbutton','switch','tab','treeitem'
    ].includes(r.role)
  ).length;
  const tokens = Math.ceil(tree.length / 4);
  console.log(`\n${refCount} refs (${interactiveCount} interactive), ~${tokens} tokens`);
}

async function cmdScreenshot(client) {
  const savePath = restArgs[0] || undefined;
  const fullPage = restArgs.includes('--full');
  const { path } = await screenshot(client, savePath, { fullPage });
  console.log(path);
}

async function cmdClick(client, targetId) {
  requireArg(restArgs[0], 'click', '@eN');
  const result = await actions.click(client, port, targetId, restArgs[0]);
  console.log(`✓ Clicked ${result.role} "${result.name || ''}"`);
}

async function cmdFill(client, targetId) {
  requireArg(restArgs[0], 'fill', '@eN "text"');
  requireArg(restArgs[1], 'fill', '@eN "text"');
  const result = await actions.fill(client, port, targetId, restArgs[0], restArgs.slice(1).join(' '));
  console.log(`✓ Filled ${restArgs[0]} with "${result.text}"`);
}

async function cmdType(client, targetId) {
  requireArg(restArgs[0], 'type', '@eN "text"');
  requireArg(restArgs[1], 'type', '@eN "text"');
  const result = await actions.type(client, port, targetId, restArgs[0], restArgs.slice(1).join(' '));
  console.log(`✓ Typed "${result.text}" into ${restArgs[0]}`);
}

async function cmdSelect(client, targetId) {
  requireArg(restArgs[0], 'select', '@eN "value"');
  requireArg(restArgs[1], 'select', '@eN "value"');
  const result = await actions.select(client, port, targetId, restArgs[0], restArgs.slice(1).join(' '));
  if (result.note) console.log(`ℹ ${result.note}`);
  else console.log(`✓ Selected "${result.selected}" (value: ${result.value})`);
}

async function cmdCheck(client, targetId) {
  requireArg(restArgs[0], 'check', '@eN');
  await actions.check(client, port, targetId, restArgs[0]);
  console.log(`✓ Checked ${restArgs[0]}`);
}

async function cmdUncheck(client, targetId) {
  requireArg(restArgs[0], 'uncheck', '@eN');
  await actions.uncheck(client, port, targetId, restArgs[0]);
  console.log(`✓ Unchecked ${restArgs[0]}`);
}

async function cmdFocus(client, targetId) {
  requireArg(restArgs[0], 'focus', '@eN');
  await actions.focus(client, port, targetId, restArgs[0]);
  console.log(`✓ Focused ${restArgs[0]}`);
}

async function cmdHover(client, targetId) {
  requireArg(restArgs[0], 'hover', '@eN');
  await actions.hover(client, port, targetId, restArgs[0]);
  console.log(`✓ Hovered ${restArgs[0]}`);
}

async function cmdPress(client) {
  requireArg(restArgs[0], 'press', '<key>');
  const result = await actions.press(client, restArgs[0]);
  console.log(`✓ Pressed ${result.pressed}`);
}

async function cmdScroll(client) {
  const dir = restArgs[0] || 'down';
  const amount = restArgs[1] ? parseInt(restArgs[1], 10) : 400;
  const result = await actions.scroll(client, dir, amount);
  console.log(`✓ Scrolled ${result.scrolled} ${result.amount}px`);
}

async function cmdScrollIntoView(client, targetId) {
  requireArg(restArgs[0], 'scrollintoview', '@eN');
  await actions.scrollIntoView(client, port, targetId, restArgs[0]);
  console.log(`✓ Scrolled ${restArgs[0]} into view`);
}

async function cmdOpen(client) {
  requireArg(restArgs[0], 'open', '<url>');
  const result = await actions.navigate(client, restArgs[0]);
  console.log(`✓ Navigated to ${result.navigated}`);
}

async function cmdBack(client) {
  await actions.goBack(client);
  const url = await actions.getUrl(client);
  console.log(`✓ Back → ${url}`);
}

async function cmdForward(client) {
  await actions.goForward(client);
  const url = await actions.getUrl(client);
  console.log(`✓ Forward → ${url}`);
}

async function cmdReload(client) {
  await actions.reload(client);
  console.log(`✓ Reloaded`);
}

async function cmdEval(client) {
  requireArg(restArgs[0], 'eval', '<javascript>');
  const expr = restArgs.join(' ');
  const result = await actions.evaluate(client, expr);
  if (result !== undefined) {
    console.log(typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result));
  }
}

async function cmdGet(client) {
  const what = restArgs[0];
  if (what === 'url') {
    console.log(await actions.getUrl(client));
  } else if (what === 'title') {
    console.log(await actions.getTitle(client));
  } else {
    error(`Unknown get target: ${what}. Use 'url' or 'title'.`);
  }
}

async function cmdWait() {
  const ms = parseInt(restArgs[0] || '1000', 10);
  await actions.wait(ms);
  console.log(`✓ Waited ${ms}ms`);
}

// ── Helpers ──────────────────────────────────────────────────────────

function requireArg(arg, cmd, usage) {
  if (!arg) {
    error(`Missing argument. Usage: agent-chrome ${cmd} ${usage}`);
  }
}

function error(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

main();
