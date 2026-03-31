export interface CompilationData {
  glyphTable: Map<number, Uint8Array>;
  prefixSums: Float64Array;
  emojiMap: Map<string, number[]>;
  constraints: Uint32Array;
}

const MAGIC = new Uint8Array([0x5a, 0x45, 0x52, 0x4f]);
const VERSION = 1;

export function computeChecksum(buffer: ArrayBuffer): number {
  const view = new Uint8Array(buffer);
  let sum = 0;
  for (let i = 0; i < view.length; i++) {
    sum = (sum + view[i] * (i + 1)) >>> 0;
  }
  return sum;
}

function encodeGlyphTable(table: Map<number, Uint8Array>): Uint8Array {
  const entries = Array.from(table.entries());
  let totalSize = 4;
  for (const [, data] of entries) {
    totalSize += 4 + 4 + data.byteLength;
  }
  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  view.setUint32(0, entries.length);
  let offset = 4;
  for (const [key, data] of entries) {
    view.setUint32(offset, key);
    view.setUint32(offset + 4, data.byteLength);
    bytes.set(data, offset + 8);
    offset += 8 + data.byteLength;
  }
  return bytes;
}

function decodeGlyphTable(data: Uint8Array, offset: number): { table: Map<number, Uint8Array>; bytesRead: number } {
  const view = new DataView(data.buffer, data.byteOffset + offset);
  const count = view.getUint32(0);
  const table = new Map<number, Uint8Array>();
  let pos = 4;
  for (let i = 0; i < count; i++) {
    const key = new DataView(data.buffer, data.byteOffset + offset + pos).getUint32(0);
    const len = new DataView(data.buffer, data.byteOffset + offset + pos + 4).getUint32(0);
    const value = data.slice(offset + pos + 8, offset + pos + 8 + len);
    table.set(key, value);
    pos += 8 + len;
  }
  return { table, bytesRead: pos };
}

function encodePrefixSums(sums: Float64Array): Uint8Array {
  const buf = new ArrayBuffer(4 + sums.byteLength);
  const view = new DataView(buf);
  view.setUint32(0, sums.length);
  const bytes = new Uint8Array(buf);
  bytes.set(new Uint8Array(sums.buffer, sums.byteOffset, sums.byteLength), 4);
  return bytes;
}

function decodePrefixSums(data: Uint8Array, offset: number): { sums: Float64Array; bytesRead: number } {
  const view = new DataView(data.buffer, data.byteOffset + offset);
  const count = view.getUint32(0);
  const sums = new Float64Array(count);
  const raw = new Uint8Array(data.buffer, data.byteOffset + offset + 4, count * 8);
  new Uint8Array(sums.buffer).set(raw);
  return { sums, bytesRead: 4 + count * 8 };
}

function encodeEmojiMap(map: Map<string, number[]>): Uint8Array {
  const entries = Array.from(map.entries());
  let totalSize = 4;
  for (const [key, vals] of entries) {
    const encoded = new TextEncoder().encode(key);
    totalSize += 4 + encoded.byteLength + 4 + vals.length * 4;
  }
  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  view.setUint32(0, entries.length);
  let pos = 4;
  for (const [key, vals] of entries) {
    const encoded = new TextEncoder().encode(key);
    new DataView(buf, pos).setUint32(0, encoded.byteLength);
    bytes.set(encoded, pos + 4);
    pos += 4 + encoded.byteLength;
    new DataView(buf, pos).setUint32(0, vals.length);
    pos += 4;
    for (const v of vals) {
      new DataView(buf, pos).setUint32(0, v);
      pos += 4;
    }
  }
  return bytes;
}

function decodeEmojiMap(data: Uint8Array, offset: number): { map: Map<string, number[]>; bytesRead: number } {
  const view = new DataView(data.buffer, data.byteOffset + offset);
  const count = view.getUint32(0);
  const map = new Map<string, number[]>();
  let pos = 4;
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    const keyLen = new DataView(data.buffer, data.byteOffset + offset + pos).getUint32(0);
    const keyBytes = data.slice(offset + pos + 4, offset + pos + 4 + keyLen);
    const key = decoder.decode(keyBytes);
    pos += 4 + keyLen;
    const valCount = new DataView(data.buffer, data.byteOffset + offset + pos).getUint32(0);
    pos += 4;
    const vals: number[] = [];
    for (let j = 0; j < valCount; j++) {
      vals.push(new DataView(data.buffer, data.byteOffset + offset + pos).getUint32(0));
      pos += 4;
    }
    map.set(key, vals);
  }
  return { map, bytesRead: pos };
}

function encodeConstraints(constraints: Uint32Array): Uint8Array {
  const buf = new ArrayBuffer(4 + constraints.byteLength);
  const view = new DataView(buf);
  view.setUint32(0, constraints.length);
  new Uint8Array(buf).set(new Uint8Array(constraints.buffer, constraints.byteOffset, constraints.byteLength), 4);
  return new Uint8Array(buf);
}

function decodeConstraints(data: Uint8Array, offset: number): { constraints: Uint32Array; bytesRead: number } {
  const view = new DataView(data.buffer, data.byteOffset + offset);
  const count = view.getUint32(0);
  const constraints = new Uint32Array(count);
  new Uint8Array(constraints.buffer).set(
    new Uint8Array(data.buffer, data.byteOffset + offset + 4, count * 4)
  );
  return { constraints, bytesRead: 4 + count * 4 };
}

export function generateZTB(data: CompilationData): ArrayBuffer {
  const glyphBytes = encodeGlyphTable(data.glyphTable);
  const prefixBytes = encodePrefixSums(data.prefixSums);
  const emojiBytes = encodeEmojiMap(data.emojiMap);
  const constraintBytes = encodeConstraints(data.constraints);

  const headerSize = 16;
  const totalSize = headerSize + glyphBytes.byteLength + prefixBytes.byteLength + emojiBytes.byteLength + constraintBytes.byteLength;
  const output = new ArrayBuffer(totalSize);
  const view = new DataView(output);
  const bytes = new Uint8Array(output);

  bytes.set(MAGIC, 0);
  view.setUint16(4, VERSION);
  view.setUint16(6, 4);

  let offset = headerSize;
  bytes.set(glyphBytes, offset);
  offset += glyphBytes.byteLength;
  bytes.set(prefixBytes, offset);
  offset += prefixBytes.byteLength;
  bytes.set(emojiBytes, offset);
  offset += emojiBytes.byteLength;
  bytes.set(constraintBytes, offset);

  const bodyForChecksum = new Uint8Array(output, headerSize);
  const checksum = computeChecksum(bodyForChecksum.buffer.slice(headerSize));
  view.setUint32(8, checksum);

  return output;
}

export function parseZTB(buffer: ArrayBuffer): CompilationData {
  const data = new Uint8Array(buffer);
  const view = new DataView(buffer);

  for (let i = 0; i < 4; i++) {
    if (data[i] !== MAGIC[i]) {
      throw new Error("Invalid ZTB magic bytes");
    }
  }

  const version = view.getUint16(4);
  if (version !== VERSION) {
    throw new Error(`Unsupported ZTB version: ${version}`);
  }

  const storedChecksum = view.getUint32(8);
  const bodyBuffer = buffer.slice(16);
  const computedChecksum = computeChecksum(bodyBuffer);
  if (storedChecksum !== computedChecksum) {
    throw new Error(`ZTB checksum mismatch: expected ${storedChecksum}, got ${computedChecksum}`);
  }

  let offset = 16;

  const glyphResult = decodeGlyphTable(data, offset);
  offset += glyphResult.bytesRead;

  const prefixResult = decodePrefixSums(data, offset);
  offset += prefixResult.bytesRead;

  const emojiResult = decodeEmojiMap(data, offset);
  offset += emojiResult.bytesRead;

  const constraintResult = decodeConstraints(data, offset);

  return {
    glyphTable: glyphResult.table,
    prefixSums: prefixResult.sums,
    emojiMap: emojiResult.map,
    constraints: constraintResult.constraints,
  };
}
