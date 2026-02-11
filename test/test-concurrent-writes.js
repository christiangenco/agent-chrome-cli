#!/usr/bin/env node

/**
 * Test true concurrent writes from multiple processes.
 * Spawns N child processes that all write to the same refs file simultaneously,
 * then verifies the file is valid JSON (not corrupted by partial writes).
 */

import { execFile } from 'node:child_process';
import { readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 29222;
const TARGET_ID = 'CONCURRENT_TEST_1234';
const AGENT_ID = 'concurrent-test';
const CACHE_DIR = join(homedir(), '.agent-chrome', AGENT_ID);
const NUM_WRITERS = 20;
const WRITES_PER_PROCESS = 50;
const WORKER_SCRIPT = join(__dirname, '_concurrent-worker.mjs');

function cleanup() {
  if (existsSync(CACHE_DIR)) rmSync(CACHE_DIR, { recursive: true });
}

async function main() {
  console.log(`\nConcurrent write test: ${NUM_WRITERS} processes × ${WRITES_PER_PROCESS} writes each\n`);
  cleanup();

  // Spawn all workers simultaneously
  const workers = [];
  for (let i = 0; i < NUM_WRITERS; i++) {
    workers.push(new Promise((resolve, reject) => {
      execFile('node', [
        WORKER_SCRIPT,
        String(PORT), TARGET_ID, AGENT_ID, String(i), String(WRITES_PER_PROCESS),
      ], (err, stdout, stderr) => {
        if (err) reject(new Error(`Worker ${i} failed: ${stderr || err.message}`));
        else resolve();
      });
    }));
  }

  // Wait for all workers to finish
  await Promise.all(workers);
  console.log(`  ✓ All ${NUM_WRITERS} workers completed`);

  // Check the refs file is valid JSON
  const short = TARGET_ID.slice(0, 8);
  const refsFile = join(CACHE_DIR, `${PORT}-${short}.refs.json`);

  let passed = 0;
  let failed = 0;

  function assert(condition, msg) {
    if (condition) { passed++; console.log(`  ✓ ${msg}`); }
    else { failed++; console.error(`  ✗ ${msg}`); }
  }

  assert(existsSync(refsFile), 'refs file exists');

  try {
    const content = readFileSync(refsFile, 'utf8');
    const parsed = JSON.parse(content);
    assert(true, 'refs file is valid JSON (not corrupted by concurrent writes)');
    assert(parsed.e1 !== undefined, 'refs contain e1');
    assert(parsed.e2 !== undefined, 'refs contain e2');
    assert(typeof parsed.e1.backendDOMNodeId === 'number', 'e1 has valid backendDOMNodeId');
    assert(typeof parsed.e1.name === 'string' && parsed.e1.name.length > 0, 'e1 has valid name');
  } catch (e) {
    assert(false, `refs file is valid JSON: ${e.message}`);
  }

  // Check no .tmp files left
  const files = readdirSync(CACHE_DIR);
  const tmpFiles = files.filter(f => f.endsWith('.tmp'));
  assert(tmpFiles.length === 0, `no .tmp files left behind (found ${tmpFiles.length})`);

  cleanup();

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  cleanup();
  process.exit(1);
});
