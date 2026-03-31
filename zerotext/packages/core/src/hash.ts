const TABLE_SIZE = 6144;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(key: number): number {
  let hash = FNV_OFFSET;
  hash ^= (key & 0xff);
  hash = Math.imul(hash, FNV_PRIME);
  hash ^= ((key >> 8) & 0xff);
  hash = Math.imul(hash, FNV_PRIME);
  hash ^= ((key >> 16) & 0xff);
  hash = Math.imul(hash, FNV_PRIME);
  hash ^= ((key >> 24) & 0xff);
  hash = Math.imul(hash, FNV_PRIME);
  return hash >>> 0;
}

function mixHash(codepoint: number, fontId: number): number {
  return fnv1a((fontId << 21) | (codepoint & 0x1fffff));
}

export class PerfectHashTable {
  private keys: Uint32Array;
  private values: Float32Array;
  private size: number;
  private seed: number;

  constructor(size: number, seed: number) {
    this.size = size;
    this.seed = seed;
    this.keys = new Uint32Array(size);
    this.values = new Float32Array(size);
    this.keys.fill(0xffffffff);
  }

  set(key: number, value: number): void {
    let idx = (fnv1a(key ^ this.seed)) % this.size;
    let attempts = 0;
    while (this.keys[idx] !== 0xffffffff && this.keys[idx] !== key) {
      idx = (idx + 1) % this.size;
      attempts++;
      if (attempts >= this.size) return;
    }
    this.keys[idx] = key;
    this.values[idx] = value;
  }

  get(key: number): number {
    let idx = (fnv1a(key ^ this.seed)) % this.size;
    let attempts = 0;
    while (this.keys[idx] !== key) {
      if (this.keys[idx] === 0xffffffff) return -1;
      idx = (idx + 1) % this.size;
      attempts++;
      if (attempts >= this.size) return -1;
    }
    return this.values[idx];
  }
}

export interface GlyphEntry {
  codepoint: number;
  fontId: number;
  width: number;
}

export function createGlyphTable(entries: GlyphEntry[]): PerfectHashTable {
  const size = Math.max(TABLE_SIZE, entries.length * 2);

  for (let seed = 0; seed < 256; seed++) {
    const table = new PerfectHashTable(size, seed);
    let valid = true;
    for (let i = 0; i < entries.length; i++) {
      const key = mixHash(entries[i].codepoint, entries[i].fontId);
      table.set(key, entries[i].width);
    }

    for (let i = 0; i < entries.length; i++) {
      const key = mixHash(entries[i].codepoint, entries[i].fontId);
      if (table.get(key) !== entries[i].width) {
        valid = false;
        break;
      }
    }
    if (valid) return table;
  }

  // Fallback: use last seed regardless
  const table = new PerfectHashTable(size, 0);
  for (let i = 0; i < entries.length; i++) {
    const key = mixHash(entries[i].codepoint, entries[i].fontId);
    table.set(key, entries[i].width);
  }
  return table;
}

// Fast ASCII width cache — avoids hash lookup for codepoints 0-127
const _asciiWidths = new Float32Array(128);
let _asciiReady = false;

export function getWidth(table: PerfectHashTable, codepoint: number, fontId: number): number {
  // Fast path: ASCII with default font (fontId 0) — direct array lookup, no hashing
  if (codepoint < 128 && fontId === 0 && _asciiReady) {
    return _asciiWidths[codepoint];
  }
  const key = mixHash(codepoint, fontId);
  const w = table.get(key);
  return w < 0 ? 0 : w;
}

/** Warm the ASCII cache from a glyph table. Call once after createGlyphTable. */
export function warmAsciiCache(table: PerfectHashTable): void {
  for (let cp = 0; cp < 128; cp++) {
    const key = mixHash(cp, 0);
    const w = table.get(key);
    _asciiWidths[cp] = w < 0 ? 0 : w;
  }
  _asciiReady = true;
}

const ZWJ = 0x200d;
const VS16 = 0xfe0f;

export class EmojiMap {
  private sequences: Map<string, number>;

  constructor() {
    this.sequences = new Map();
  }

  addSequence(codepoints: number[], clusterWidth: number): void {
    const key = this.encodeKey(codepoints);
    this.sequences.set(key, clusterWidth);
  }

  private encodeKey(codepoints: number[]): string {
    let key = "";
    for (let i = 0; i < codepoints.length; i++) {
      if (i > 0) key += ":";
      key += codepoints[i].toString(36);
    }
    return key;
  }

  isZWJCluster(codepoints: Uint32Array, offset: number, length: number): number {
    let end = offset + 1;
    while (end < offset + length && end < codepoints.length) {
      if (codepoints[end] === ZWJ && end + 1 < codepoints.length) {
        end += 2;
        if (end < codepoints.length && codepoints[end] === VS16) {
          end++;
        }
      } else if (codepoints[end] === VS16) {
        end++;
      } else {
        break;
      }
    }
    return end - offset;
  }

  getClusterWidth(codepoints: Uint32Array, offset: number, length: number): number {
    const slice: number[] = [];
    for (let i = offset; i < offset + length && i < codepoints.length; i++) {
      slice.push(codepoints[i]);
    }
    const key = this.encodeKey(slice);
    const w = this.sequences.get(key);
    return w !== undefined ? w : -1;
  }
}
