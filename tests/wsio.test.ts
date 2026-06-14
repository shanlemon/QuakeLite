// WebSocket data helper tests - run with: npx tsx tests/wsio.test.ts

import { WebSocket } from 'ws';
import { rawToString, sendJson, toDataView } from '../server/src/wsio';
import type { ServerJsonMsg } from '../shared/protocol';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ok    ${name}${detail ? ` (${detail})` : ''}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` (${detail})` : ''}`);
  }
}

class FakeSocket {
  readyState = WebSocket.OPEN;
  sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }
}

function asWs(ws: FakeSocket): WebSocket {
  return ws as unknown as WebSocket;
}

console.log('ws io');

{
  check('rawToString handles strings', rawToString('hello') === 'hello');
  check('rawToString handles Buffer', rawToString(Buffer.from('buffer')) === 'buffer');
  const ab = new TextEncoder().encode('arraybuffer').buffer;
  check('rawToString handles ArrayBuffer', rawToString(ab) === 'arraybuffer');
  check('rawToString handles Buffer arrays', rawToString([Buffer.from('a'), Buffer.from('b')]) === 'ab');
}

{
  const ab = new Uint8Array([1, 2, 3]).buffer;
  const abView = toDataView(ab);
  check('toDataView handles ArrayBuffer', abView?.byteLength === 3 && abView.getUint8(1) === 2);

  const buf = Buffer.from([4, 5, 6]);
  const bufView = toDataView(buf);
  check('toDataView handles Buffer', bufView?.byteLength === 3 && bufView.getUint8(2) === 6);

  const listView = toDataView([Buffer.from([7]), Buffer.from([8])]);
  check('toDataView handles Buffer arrays', listView?.byteLength === 2 && listView.getUint8(1) === 8);

  check('toDataView rejects text frames', toDataView('not binary') === null);
}

{
  const msg: ServerJsonMsg = { type: 'error', code: 'bad_join', message: 'bad' };
  const open = new FakeSocket();
  sendJson(asWs(open), msg);
  check('sendJson writes JSON to open sockets', open.sent.length === 1 && JSON.parse(open.sent[0]!).code === 'bad_join');

  const closed = new FakeSocket();
  closed.readyState = WebSocket.CLOSED;
  sendJson(asWs(closed), msg);
  check('sendJson ignores closed sockets', closed.sent.length === 0);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ws io tests passed');
if (failures) process.exit(1);
