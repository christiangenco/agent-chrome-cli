#!/usr/bin/env node

import CDP from 'chrome-remote-interface';
import { appendFileSync, unlinkSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';

const port = parseInt(process.argv[2], 10);
const targetId = process.argv[3];
const dataFile = process.argv[4];
const sockPath = process.argv[5];

if (!port || !targetId || !dataFile || !sockPath) {
  process.exit(1);
}

function append(obj) {
  appendFileSync(dataFile, JSON.stringify(obj) + '\n');
}

let client;
let socketServer;

async function main() {
  client = await CDP({ port, target: targetId });
  await client.Network.enable();

  client.Network.requestWillBeSent(({ requestId, request, timestamp, type }) => {
    append({
      event: 'request',
      requestId,
      timestamp,
      url: request.url,
      method: request.method,
      resourceType: type,
      requestHeaders: request.headers,
      postData: request.postData || undefined,
    });
  });

  client.Network.responseReceived(({ requestId, timestamp, response, type }) => {
    append({
      event: 'response',
      requestId,
      timestamp,
      status: response.status,
      statusText: response.statusText,
      mimeType: response.mimeType,
      responseHeaders: response.headers,
      encodedDataLength: response.encodedDataLength,
    });
  });

  client.Network.loadingFinished(({ requestId, timestamp, encodedDataLength }) => {
    append({ event: 'finished', requestId, timestamp, encodedDataLength });
  });

  client.Network.loadingFailed(({ requestId, timestamp, errorText, canceled }) => {
    append({ event: 'failed', requestId, timestamp, errorText, canceled });
  });

  // IPC socket server for body fetching
  if (existsSync(sockPath)) unlinkSync(sockPath);
  socketServer = createServer(conn => {
    let buf = '';
    conn.on('data', chunk => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      handleIpc(conn, line);
    });
  });
  socketServer.listen(sockPath);

  client.on('disconnect', () => cleanup());
}

async function handleIpc(conn, line) {
  try {
    const cmd = JSON.parse(line);
    if (cmd.cmd === 'ping') {
      conn.end(JSON.stringify({ ok: true }));
    } else if (cmd.cmd === 'getBody') {
      try {
        const { body, base64Encoded } = await client.Network.getResponseBody({ requestId: cmd.requestId });
        conn.end(JSON.stringify({ ok: true, body, base64Encoded }));
      } catch (err) {
        conn.end(JSON.stringify({ ok: false, error: err.message }));
      }
    } else {
      conn.end(JSON.stringify({ ok: false, error: 'unknown command' }));
    }
  } catch {
    conn.end(JSON.stringify({ ok: false, error: 'invalid json' }));
  }
}

function cleanup() {
  try { socketServer?.close(); } catch {}
  try { if (existsSync(sockPath)) unlinkSync(sockPath); } catch {}
  try { client?.close(); } catch {}
  process.exit(0);
}

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

main().catch(() => process.exit(1));
