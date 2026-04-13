#!/usr/bin/env node

import CDP from 'chrome-remote-interface';
import { appendFileSync } from 'node:fs';

const port = parseInt(process.argv[2], 10);
const targetId = process.argv[3];
const dataFile = process.argv[4];

if (!port || !targetId || !dataFile) {
  process.exit(1);
}

let msgCounter = 0;

function append(obj) {
  appendFileSync(dataFile, JSON.stringify(obj) + '\n');
}

let client;

async function main() {
  client = await CDP({ port, target: targetId });
  await client.Runtime.enable();

  client.Runtime.consoleAPICalled(({ type, args, timestamp, stackTrace }) => {
    msgCounter++;
    const text = args.map(a => {
      if (a.type === 'string') return a.value;
      if (a.type === 'number' || a.type === 'boolean') return String(a.value);
      if (a.description) return a.description;
      if (a.value !== undefined) return JSON.stringify(a.value);
      return a.type;
    }).join(' ');

    const frame = stackTrace?.callFrames?.[0];
    append({
      msgId: `m${msgCounter}`,
      level: type,
      text,
      url: frame?.url || '',
      lineNumber: frame?.lineNumber ?? 0,
      columnNumber: frame?.columnNumber ?? 0,
      timestamp,
    });
  });

  client.Runtime.exceptionThrown(({ timestamp, exceptionDetails }) => {
    msgCounter++;
    const text = exceptionDetails.text +
      (exceptionDetails.exception?.description ? ': ' + exceptionDetails.exception.description : '');
    const frame = exceptionDetails.stackTrace?.callFrames?.[0];
    append({
      msgId: `m${msgCounter}`,
      level: 'error',
      text,
      url: frame?.url || exceptionDetails.url || '',
      lineNumber: frame?.lineNumber ?? exceptionDetails.lineNumber ?? 0,
      columnNumber: frame?.columnNumber ?? exceptionDetails.columnNumber ?? 0,
      timestamp,
      stackTrace: exceptionDetails.stackTrace?.callFrames?.map(
        f => `  at ${f.functionName || '(anonymous)'} (${f.url}:${f.lineNumber}:${f.columnNumber})`
      ).join('\n') || undefined,
    });
  });

  client.on('disconnect', () => cleanup());
}

function cleanup() {
  try { client?.close(); } catch {}
  process.exit(0);
}

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

main().catch(() => process.exit(1));
