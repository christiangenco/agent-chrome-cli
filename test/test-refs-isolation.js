#!/usr/bin/env node

/**
 * Test that --agent-id namespacing and atomic writes work correctly.
 * This doesn't need a running Chrome — it tests the ref/tab cache layer directly.
 */

import { saveRefs, loadRefs, saveTabMap, loadTabMap } from '../src/refs.js';
import { mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PORT = 19222; // fake port for testing
const TARGET_ID = 'ABCDEF1234567890';
const CACHE_DIR = join(homedir(), '.agent-chrome');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

function cleanup() {
  // Clean up test files
  const patterns = [`${PORT}-ABCDEF12.refs.json`, `${PORT}-tabs.json`];
  for (const p of patterns) {
    const full = join(CACHE_DIR, p);
    if (existsSync(full)) rmSync(full);
  }
  for (const agentDir of ['test-agent-1', 'test-agent-2']) {
    const dir = join(CACHE_DIR, agentDir);
    if (existsSync(dir)) rmSync(dir, { recursive: true });
  }
}

// ── Test 1: Basic save/load without agent-id ─────────────────────

console.log('\nTest 1: Basic save/load (no agent-id)');
cleanup();

const refs1 = { e1: { backendDOMNodeId: 100, role: 'button', name: 'Submit' } };
saveRefs(PORT, TARGET_ID, refs1);
const loaded1 = loadRefs(PORT, TARGET_ID);
assert(loaded1 !== null, 'loadRefs returns saved data');
assert(loaded1.e1.backendDOMNodeId === 100, 'ref data matches');
assert(loaded1.e1.name === 'Submit', 'ref name matches');

// ── Test 2: Agent-id namespacing isolates refs ───────────────────

console.log('\nTest 2: Agent-id namespacing');
cleanup();

const refsA = { e1: { backendDOMNodeId: 200, role: 'link', name: 'Home' } };
const refsB = { e1: { backendDOMNodeId: 999, role: 'button', name: 'Cancel' } };

saveRefs(PORT, TARGET_ID, refsA, 'test-agent-1');
saveRefs(PORT, TARGET_ID, refsB, 'test-agent-2');

const loadedA = loadRefs(PORT, TARGET_ID, 'test-agent-1');
const loadedB = loadRefs(PORT, TARGET_ID, 'test-agent-2');

assert(loadedA.e1.backendDOMNodeId === 200, 'agent-1 refs are isolated (backendDOMNodeId=200)');
assert(loadedB.e1.backendDOMNodeId === 999, 'agent-2 refs are isolated (backendDOMNodeId=999)');
assert(loadedA.e1.name === 'Home', 'agent-1 ref name preserved');
assert(loadedB.e1.name === 'Cancel', 'agent-2 ref name preserved');

// Agent-1's refs should NOT be visible to agent-2
const crossLoad = loadRefs(PORT, TARGET_ID, 'test-agent-1');
assert(crossLoad.e1.backendDOMNodeId === 200, 'cross-agent load returns correct agent data');

// No agent-id should NOT see agent-id'd data
const noAgentLoad = loadRefs(PORT, TARGET_ID);
assert(noAgentLoad === null, 'no-agent-id does not see agent-namespaced data');

// ── Test 3: Tab map namespacing ──────────────────────────────────

console.log('\nTest 3: Tab map namespacing');
cleanup();

const mapA = { t1: 'target-aaa', __last: 't1' };
const mapB = { t1: 'target-bbb', t2: 'target-ccc', __last: 't2' };

saveTabMap(PORT, mapA, 'test-agent-1');
saveTabMap(PORT, mapB, 'test-agent-2');

const loadedMapA = loadTabMap(PORT, 'test-agent-1');
const loadedMapB = loadTabMap(PORT, 'test-agent-2');

assert(loadedMapA.t1 === 'target-aaa', 'agent-1 tab map isolated');
assert(loadedMapA.__last === 't1', 'agent-1 __last preserved');
assert(loadedMapB.t1 === 'target-bbb', 'agent-2 tab map isolated');
assert(loadedMapB.__last === 't2', 'agent-2 __last preserved');
assert(loadedMapB.t2 === 'target-ccc', 'agent-2 has its own tabs');

// ── Test 4: Atomic writes don't leave temp files ─────────────────

console.log('\nTest 4: Atomic writes leave no temp files');
cleanup();

saveRefs(PORT, TARGET_ID, refs1, 'test-agent-1');
const dir = join(CACHE_DIR, 'test-agent-1');
const files = readdirSync(dir);
const tmpFiles = files.filter(f => f.endsWith('.tmp'));
assert(tmpFiles.length === 0, 'no .tmp files left behind');
assert(files.some(f => f.endsWith('.refs.json')), 'refs file exists');

// ── Test 5: Concurrent writes don't corrupt ──────────────────────

console.log('\nTest 5: Rapid sequential writes (simulate concurrency)');
cleanup();

// Write many times rapidly — verify last write wins and file is valid
for (let i = 0; i < 100; i++) {
  saveRefs(PORT, TARGET_ID, {
    e1: { backendDOMNodeId: i, role: 'button', name: `Button ${i}` }
  }, 'test-agent-1');
}

const finalLoad = loadRefs(PORT, TARGET_ID, 'test-agent-1');
assert(finalLoad !== null, 'file is valid JSON after 100 rapid writes');
assert(finalLoad.e1.backendDOMNodeId === 99, 'last write wins (backendDOMNodeId=99)');

// Check no temp files left
const files2 = readdirSync(join(CACHE_DIR, 'test-agent-1'));
const tmpFiles2 = files2.filter(f => f.endsWith('.tmp'));
assert(tmpFiles2.length === 0, 'no .tmp files after rapid writes');

// ── Cleanup & summary ────────────────────────────────────────────

cleanup();

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
