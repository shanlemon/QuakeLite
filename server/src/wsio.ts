import { WebSocket, type RawData } from 'ws';
import type { ServerJsonMsg } from '../../shared/protocol';

export function sendJson(ws: WebSocket, msg: ServerJsonMsg): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

export function rawToString(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

export function toDataView(data: RawData): DataView | null {
  if (data instanceof ArrayBuffer) return new DataView(data);
  if (Array.isArray(data)) {
    const buf = Buffer.concat(data);
    return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  if (Buffer.isBuffer(data)) return new DataView(data.buffer, data.byteOffset, data.byteLength);
  return null;
}
