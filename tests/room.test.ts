// Room lifecycle tests - run with: npx tsx tests/room.test.ts

import { WebSocket } from 'ws';
import { Room } from '../server/src/room';
import type { Identity } from '../server/src/identity';
import type { ServerJsonMsg } from '../shared/protocol';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ok    ${name}${detail ? ` (${detail})` : ''}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` (${detail})` : ''}`);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

class FakeSocket {
  readyState = WebSocket.OPEN;
  sent: Array<string | Buffer> = [];
  closeCode: number | undefined;
  closeReason = '';

  send(data: string | Buffer): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCode = code;
    this.closeReason = reason ?? '';
    this.readyState = WebSocket.CLOSED;
  }
}

function asWs(ws: FakeSocket): WebSocket {
  return ws as unknown as WebSocket;
}

function jsonMessages(ws: FakeSocket): ServerJsonMsg[] {
  return ws.sent
    .filter((msg): msg is string => typeof msg === 'string')
    .map((msg) => JSON.parse(msg) as ServerJsonMsg);
}

function welcome(ws: FakeSocket): Extract<ServerJsonMsg, { type: 'welcome' }> | null {
  return jsonMessages(ws).find((msg): msg is Extract<ServerJsonMsg, { type: 'welcome' }> => msg.type === 'welcome') ?? null;
}

const alice: Identity = { userId: 'discord:alice', name: 'Alice', avatar: null };

console.log('room lifecycle');

{
  const room = new Room('room-test-rejoin', { disconnectGraceMs: 20 });
  const ws1 = new FakeSocket();
  const joined = room.addPlayer(asWs(ws1), alice);
  check('initial join succeeds', joined?.id === 0 && room.players.size === 1);

  ws1.readyState = WebSocket.CLOSED;
  room.removePlayer(joined!, { socket: asWs(ws1) });
  check('disconnect keeps player as AFK', room.players.size === 1 && joined?.disconnectedAt !== null);

  const ws2 = new FakeSocket();
  const rejoined = room.addPlayer(asWs(ws2), alice);
  const msg = welcome(ws2);
  const respawn = jsonMessages(ws2).find((m) => m.type === 'respawn' && m.id === 0);
  check('same user reclaims existing player id', rejoined === joined && rejoined?.id === 0 && msg?.id === 0);
  check('rejoin clears AFK state', rejoined?.disconnectedAt === null && msg?.players.find((p) => p.id === 0)?.afk === false);
  check('rejoin syncs live player position', respawn?.type === 'respawn');

  await sleep(35);
  check('cancelled AFK timer does not remove rejoined player', room.players.has(0));
  room.removePlayer(rejoined!, { socket: asWs(ws2), immediate: true });
}

{
  const room = new Room('room-test-expiry', { disconnectGraceMs: 10 });
  const ws = new FakeSocket();
  const joined = room.addPlayer(asWs(ws), alice);
  ws.readyState = WebSocket.CLOSED;
  room.removePlayer(joined!, { socket: asWs(ws) });
  await sleep(30);
  check('AFK player is removed after grace window', room.players.size === 0);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall room lifecycle tests passed');
if (failures) process.exit(1);
