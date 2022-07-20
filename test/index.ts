import assert from 'assert';
import { Proxy } from '../';
import { MongoClient } from 'mongodb';
import childProcess from 'child_process';
import { EJSON } from 'bson';
import path from 'path';
import { once } from 'events';

describe('Proxy', function() {
  this.timeout(10_000);

  let proxy: Proxy;
  let port: number;
  let events: any[];
  let client: MongoClient;

  beforeEach(async() => {
    events = [];
    proxy = new Proxy({ host: 'localhost', port: 27018 });
    proxy.on('newConnection', (conn: any) => {
      conn.on('connectionEnded', (source: string) => events.push({ ev: 'connecionEnded', source }));
      conn.on('connectionError', (source: string, err: Error) => events.push({ ev: 'connectionError', source, err }));
      conn.on('message', (source: string, msg: any) => events.push({ ev: 'message', source, msg }));
      conn.on('parseError', (source: string, err: Error) => events.push({ ev: 'parseError', source, err }));
    });
    await proxy.listen(0);
    port = proxy.address().port;
    client = await MongoClient.connect(`mongodb://localhost:${port}`);
  });

  afterEach(async() => {
    await client.close();
    await proxy.close();
  });

  it('records ismaster events', async() => {
    assert(events.some(ev => ev.source === 'outgoing' && ev.msg?.contents.query?.data?.ismaster),
      EJSON.stringify(events) + ' is missing ismaster query');
    assert(events.some(ev => ev.source === 'incoming' && ev.msg?.contents.documents?.[0]?.data?.ismaster),
      EJSON.stringify(events) + ' is missing ismaster reply');
  });

  it('records find queries', async() => {
    await client.db('test').collection('test').findOne();
    assert(events.some(ev => ev.source === 'outgoing' && ev.msg?.contents.sections?.[0]?.body?.data?.find === 'test'),
      EJSON.stringify(events) + ' is missing findOne query');
    assert(events.some(ev => ev.source === 'incoming' && ev.msg?.contents.sections?.[0]?.body?.data?.cursor),
      EJSON.stringify(events) + ' is missing findOne reply');
  });
});

describe('bin', function() {
  this.timeout(10_000);

  let proc: childProcess.ChildProcess;
  let port: number;
  let stdout: string;
  let client: MongoClient;

  describe('human-readable', () => {
    beforeEach(async() => {
      proc = childProcess.spawn('ts-node', [
        '-P', path.join(__dirname, '..', 'tsconfig.json'),
        path.join(__dirname, '..', 'src', 'cli.ts'),
        'localhost:27018', 'localhost:0'
      ], { stdio: 'pipe' });
      port = 0;
      await new Promise<void>((resolve) => {
        stdout = '';
        (proc.stdout as any).setEncoding('utf8');
        (proc.stdout as any).on('data', (chunk: string) => {
          stdout += chunk;
          if (!port) {
            const match = stdout.match(/Listening on(.+)forwarding/);
            if (match) {
              // eslint-disable-next-line no-eval
              port = eval(`(${match[1]}).port`);
              resolve();
            }
          }
        });
      });
      client = await MongoClient.connect(`mongodb://localhost:${port}`);
    });

    afterEach(async() => {
      await client.close();
      proc.kill();
      await once(proc, 'exit');
    });

    it('records ismaster events', async() => {
      await client.db('test').collection('test').findOne();
      assert.match(stdout, /ismaster: true/);
      assert.match(stdout, /ok: 1/);
    });

    it('records find queries', async() => {
      await client.db('test').collection('test').findOne();
      assert.match(stdout, /find: 'test'/);
    });
  });

  describe('ndjson', () => {
    beforeEach(async() => {
      proc = childProcess.spawn('ts-node', [
        '-P', path.join(__dirname, '..', 'tsconfig.json'),
        path.join(__dirname, '..', 'src', 'cli.ts'),
        '--ndjson',
        'localhost:27018', 'localhost:0'
      ], { stdio: 'pipe' });
      port = 0;
      await new Promise<void>((resolve) => {
        stdout = '';
        (proc.stdout as any).setEncoding('utf8');
        (proc.stdout as any).on('data', (chunk: string) => {
          stdout += chunk;
          if (!port) {
            const listening =
              stdout.split('\n').map(line => {
                try {
                  return JSON.parse(line);
                } catch {
                  return {};
                }
              }).find(line => line.ev === 'listening');
            if (listening) {
              port = listening.addr.port;
              resolve();
            }
          }
        });
      });
      client = await MongoClient.connect(`mongodb://localhost:${port}`);
    });

    afterEach(async() => {
      await client.close();
      proc.kill();
      await once(proc, 'exit');
    });

    it('records ismaster events', async() => {
      await client.db('test').collection('test').findOne();
      assert.match(stdout, /"ismaster":true/);
      assert.match(stdout, /"ok":1/);
    });

    it('records find queries', async() => {
      await client.db('test').collection('test').findOne();
      assert.match(stdout, /"find":"test"/);
    });
  });
});
