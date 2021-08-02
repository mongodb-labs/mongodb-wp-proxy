import net from 'net';
import { WireProtocolParser } from './parse-stream';
import { EventEmitter, once } from 'events';

export class ConnectionPair extends EventEmitter {
  id: number;
  incoming: string;

  constructor(info: Pick<ConnectionPair, 'id' | 'incoming'>) {
    super();
    this.id = info.id;
    this.incoming = info.incoming;
  }

  toJSON(): Pick<ConnectionPair, 'id' | 'incoming'> {
    return { id: this.id, incoming: this.incoming };
  }
}

export class Proxy extends EventEmitter {
  srv: net.Server;
  connId: number;

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  constructor(target: any) {
    super();
    this.connId = 0;
    this.srv = net.createServer();
    this.srv.on('connection', (conn1) => {
      const conn2 = net.createConnection(target);

      const conn1reader = new WireProtocolParser();
      const conn2reader = new WireProtocolParser();
      const cp = new ConnectionPair({
        id: this.connId++,
        incoming: `${conn1.remoteAddress}:${conn1.remotePort}`
      });

      conn1.pipe(conn2);
      conn2.pipe(conn1);
      conn1.pipe(conn1reader);
      conn2.pipe(conn2reader);

      conn1.on('close', () => {
        cp.emit('connectionEnded', 'outgoing');
        conn2.destroy();
        conn1reader.destroy();
      });
      conn2.on('close', () => {
        cp.emit('connectionEnded', 'incoming');
        conn1.destroy();
        conn2reader.destroy();
      });

      conn1.on('error', (err) => {
        cp.emit('connectionError', 'outgoing', err);
      });
      conn2.on('error', (err) => {
        cp.emit('connectionError', 'incoming', err);
      });
      conn1reader.on('message', (msg) => {
        cp.emit('message', 'outgoing', msg);
      });
      conn2reader.on('message', (msg) => {
        cp.emit('message', 'incoming', msg);
      });
      conn1reader.on('error', (err) => {
        cp.emit('parseError', 'outgoing', err);
      });
      conn2reader.on('error', (err) => {
        cp.emit('parseError', 'incoming', err);
      });

      this.emit('newConnection', cp);
    });
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  async listen(args: any): Promise<void> {
    this.srv.listen(args);
    await once(this.srv, 'listening');
  }

  address(): any {
    return this.srv.address();
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => this.srv.close((err) => err ? reject(err) : resolve));
  }
}
