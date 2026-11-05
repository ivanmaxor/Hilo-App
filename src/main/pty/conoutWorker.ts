/**
 * Un solo Worker drena el conout de todas las terminales. node-pty crea uno por
 * terminal (unos 6 MB de V8 cada uno); ver docs/DECISIONES.md, D1.
 * El drenado tiene que ser en otro hilo para no bloquearse con ClosePseudoConsole.
 */
import { parentPort } from 'node:worker_threads';
import { createServer, Socket, type Server } from 'node:net';

interface Conn {
  socket: Socket;
  server: Server | null;
  client: Socket | null;
}

export type WorkerRequest = { t: 'open'; pipe: string } | { t: 'close'; pipe: string };
export type WorkerReply = { t: 'ready'; pipe: string };

const conns = new Map<string, Conn>();

function closeConn(pipe: string): void {
  const conn = conns.get(pipe);
  if (!conn) return;
  conns.delete(pipe);
  conn.socket.destroy();
  // Sin esto el proceso principal nunca vería el cierre. end, no destroy: lo último de la salida aún se está escribiendo.
  conn.client?.end();
  conn.server?.close();
}

parentPort!.on('message', (msg: WorkerRequest) => {
  if (msg.t === 'close') {
    closeConn(msg.pipe);
    return;
  }
  const socket = new Socket();
  socket.setEncoding('utf8');
  const conn: Conn = { socket, server: null, client: null };
  conns.set(msg.pipe, conn);
  socket.on('error', () => closeConn(msg.pipe));
  // Con useConptyDll node-pty no siempre avisa del cierre: lo marca el propio conout.
  socket.on('close', () => closeConn(msg.pipe));
  socket.connect(msg.pipe, () => {
    conn.server = createServer((client) => {
      // Esta tubería la puede abrir cualquier cuenta de la máquina: entra el proceso principal y se cierra.
      conn.server?.close();
      conn.server = null;
      conn.client = client;
      client.on('error', () => undefined);
      socket.pipe(client);
    });
    conn.server.on('error', () => closeConn(msg.pipe));
    conn.server.listen(`${msg.pipe}-worker`);
    parentPort!.postMessage({ t: 'ready', pipe: msg.pipe } satisfies WorkerReply);
  });
});
