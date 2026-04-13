import { createConnection } from 'node:net';

export function sendCommand(sockPath, cmd) {
  return new Promise((resolve, reject) => {
    const client = createConnection(sockPath, () => {
      client.write(JSON.stringify(cmd) + '\n');
    });
    let data = '';
    client.on('data', chunk => { data += chunk; });
    client.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error(`Invalid response from collector: ${data}`));
      }
    });
    client.on('error', err => {
      reject(new Error(`Cannot connect to collector: ${err.message}. Is it running?`));
    });
    client.setTimeout(10000, () => {
      client.destroy();
      reject(new Error('Collector IPC timeout'));
    });
  });
}
