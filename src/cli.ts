import { Proxy, ConnectionPair } from './proxy';
import type { FullMessage } from './parse';
import { EJSON } from 'bson';

const ndjson = process.argv[2] === '--ndjson';
if (ndjson) process.argv.splice(2, 1);
const targetStr = process.argv[2];
const localStr = process.argv[3];

if (!targetStr || !localStr) {
  console.log('usage: mongodb-wp-proxy [--ndjson] <remotehost:remoteport> <[localhost:]localport>');
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  return;
}

let target: any;
if (targetStr.startsWith('/') || targetStr.includes('\\')) {
  target = { path: targetStr };
} else {
  const [host, port] = targetStr.split(':');
  target = { host, port: +port };
}

let local: any;
if (localStr.startsWith('/') || localStr.includes('\\')) {
  local = { path: localStr };
} else {
  const [host, port] = localStr.split(':');
  if (port === undefined) {
    local = { port: +host };
  } else {
    local = { host, port: +port };
  }
}

(async() => {
  const proxy = new Proxy(target);

  proxy.on('newConnection', (conn: ConnectionPair) => {
    if (ndjson) {
      console.log(JSON.stringify({ ev: 'newConnection', conn }));
    } else {
      console.log(`[${conn.id} outgoing] New connection from ${conn.incoming}`);
    }

    conn.on('connectionEnded', (source: string) => {
      if (ndjson) {
        console.log(JSON.stringify({ ev: 'connectionEnded', conn, source }));
      } else {
        console.log(`[${conn.id} ${source}] Connection closed`);
      }
    });

    conn.on('connectionError', (source: string, err: Error) => {
      if (ndjson) {
        console.log(JSON.stringify({ ev: 'connectionError', conn, source, err: err.message }));
      } else {
        console.log(`[${conn.id} ${source}] Connection error: ${err.message}`);
      }
    });

    conn.on('message', (source: string, msg: FullMessage) => {
      if (ndjson) {
        console.log(EJSON.stringify({ ev: 'message', conn: conn.toJSON(), source, msg }));
      } else {
        console.log(`[${conn.id} ${source}] Message received`);
        console.dir(msg.contents, { depth: Infinity, customInspect: true });
      }
    });

    conn.on('parseError', (source: string, err: Error) => {
      if (ndjson) {
        console.log(JSON.stringify({ ev: 'parseError', conn, source, err: err.message }));
      } else {
        console.log(`[${conn.id} ${source}] Failed to parse message: ${err.message}`);
      }
    });
  });

  await proxy.listen(local);
  if (ndjson) {
    console.log(JSON.stringify({ ev: 'listening', addr: proxy.address(), local, target }));
  } else {
    console.log('Listening on', proxy.address(), 'forwarding', local, 'to', target);
  }
})().catch((err: any) => process.nextTick(() => { throw err; }));
