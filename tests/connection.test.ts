// WebSocket connection boundary tests - run with: npx tsx tests/connection.test.ts

import { EventEmitter } from 'node:events';
import { WebSocket, type RawData } from 'ws';
import { createConnectionHandler, type ConnectedRoom } from '../server/src/connection';
import type { Identity } from '../server/src/identity';
import type { Player } from '../server/src/room';
import type { ClientJsonMsg, ServerJsonMsg } from '../shared/protocol';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ok    ${name}${detail ? ` (${detail})` : ''}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` (${detail})` : ''}`);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

class FakeSocket extends EventEmitter {
  readyState = WebSocket.OPEN;
  sent: string[] = [];
  closeCode: number | undefined;
  closeReason = '';
  terminated = false;

  send(data: string | Buffer): void {
    this.sent.push(typeof data === 'string' ? data : data.toString('utf8'));
  }

  close(code?: number, reason?: string): void {
    this.closeCode = code;
    this.closeReason = reason ?? '';
    this.readyState = WebSocket.CLOSED;
    this.emit('close', code, Buffer.from(this.closeReason));
  }

  terminate(): void {
    this.terminated = true;
    this.readyState = WebSocket.CLOSED;
  }
}

function asWs(ws: FakeSocket): WebSocket {
  return ws as unknown as WebSocket;
}

function emitJson(ws: FakeSocket, msg: ClientJsonMsg | Record<string, unknown>): void {
  ws.emit('message', Buffer.from(JSON.stringify(msg)), false);
}

function lastSent(ws: FakeSocket): ServerJsonMsg | null {
  const raw = ws.sent[ws.sent.length - 1];
  return raw ? (JSON.parse(raw) as ServerJsonMsg) : null;
}

function createFakeRoom(): {
  addCalls: Identity[];
  handled: { player: Player; data: RawData; isBinary: boolean }[];
  removed: Player[];
  room: ConnectedRoom;
} {
  const player = { id: 42 } as Player;
  const addCalls: Identity[] = [];
  const handled: { player: Player; data: RawData; isBinary: boolean }[] = [];
  const removed: Player[] = [];
  const room: ConnectedRoom = {
    addPlayer: (_ws, identity) => {
      addCalls.push(identity);
      return player;
    },
    handleMessage: (p, data, isBinary) => handled.push({ player: p, data, isBinary }),
    removePlayer: (p) => removed.push(p),
  };
  return { addCalls, handled, removed, room };
}

const identity: Identity = { userId: 'discord:1', name: 'Alice', avatar: null };

console.log('connection handler');

{
  const fake = createFakeRoom();
  const rooms: string[] = [];
  const ws = new FakeSocket();
  const handle = createConnectionHandler({
    getRoom: (instanceId) => {
      rooms.push(instanceId);
      return fake.room;
    },
    joinTimeoutMs: 100,
    logger: { warn: () => undefined },
    resolveIdentity: async () => identity,
  });

  handle(asWs(ws));
  emitJson(ws, { type: 'join', instanceId: 'activity-123', user: { id: '1', username: 'Alice', avatar: null } });
  await sleep(0);

  check('valid join resolves identity and creates room', fake.addCalls.length === 1 && rooms[0] === 'activity-123');
  check('valid join leaves socket open', ws.closeCode === undefined);

  emitJson(ws, { type: 'ping', t: 1, rtt: 2 });
  check('post-join messages route to the room', fake.handled.length === 1 && fake.handled[0]!.player.id === 42);

  ws.emit('close');
  check('close removes joined player from room', fake.removed.length === 1 && fake.removed[0]!.id === 42);
}

{
  const ws = new FakeSocket();
  let resolved = false;
  const handle = createConnectionHandler({
    getRoom: () => createFakeRoom().room,
    joinTimeoutMs: 100,
    logger: { warn: () => undefined },
    resolveIdentity: async () => {
      resolved = true;
      return identity;
    },
  });

  handle(asWs(ws));
  emitJson(ws, { type: 'join', instanceId: '', user: { id: '1', username: 'Alice', avatar: null } });
  await sleep(0);

  const sent = lastSent(ws);
  check('missing instanceId sends bad_join', sent?.type === 'error' && sent.code === 'bad_join');
  check('missing instanceId closes with protocol code', ws.closeCode === 4002, String(ws.closeCode));
  check('missing instanceId does not resolve identity', !resolved);
}

{
  const ws = new FakeSocket();
  const handle = createConnectionHandler({
    getRoom: () => createFakeRoom().room,
    joinTimeoutMs: 100,
    logger: { warn: () => undefined },
    resolveIdentity: async () => null,
  });

  handle(asWs(ws));
  emitJson(ws, { type: 'join', instanceId: 'activity-123', user: { id: '1', username: 'Alice', avatar: null } });
  await sleep(0);

  const sent = lastSent(ws);
  check('auth failure sends auth_failed', sent?.type === 'error' && sent.code === 'auth_failed');
  check('auth failure closes with auth code', ws.closeCode === 4003, String(ws.closeCode));
}

{
  const ws = new FakeSocket();
  const handle = createConnectionHandler({
    getRoom: () => createFakeRoom().room,
    joinTimeoutMs: 100,
    logger: { warn: () => undefined },
    resolveIdentity: async () => identity,
  });

  handle(asWs(ws));
  ws.emit('message', Buffer.from('{'), false);
  await sleep(0);

  check('malformed pre-join JSON closes as bad message', ws.closeCode === 4002, String(ws.closeCode));
}

{
  const ws = new FakeSocket();
  const handle = createConnectionHandler({
    getRoom: () => createFakeRoom().room,
    joinTimeoutMs: 5,
    logger: { warn: () => undefined },
    resolveIdentity: async () => identity,
  });

  handle(asWs(ws));
  await sleep(20);

  check('join timeout closes idle sockets', ws.closeCode === 4000, String(ws.closeCode));
  check('join timeout reason is explicit', ws.closeReason === 'join timeout', ws.closeReason);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall connection tests passed');
if (failures) process.exit(1);
