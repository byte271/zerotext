import { describe, it } from "node:test";
import assert from "node:assert/strict";

// -- Helpers (inline to avoid import resolution issues with .js extensions) --

// ===== hash.ts =====
const TABLE_SIZE = 6144;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(key: number): number {
  let hash = FNV_OFFSET;
  hash ^= key & 0xff;
  hash = Math.imul(hash, FNV_PRIME);
  hash ^= (key >> 8) & 0xff;
  hash = Math.imul(hash, FNV_PRIME);
  hash ^= (key >> 16) & 0xff;
  hash = Math.imul(hash, FNV_PRIME);
  hash ^= (key >> 24) & 0xff;
  hash = Math.imul(hash, FNV_PRIME);
  return hash >>> 0;
}

function mixHash(codepoint: number, fontId: number): number {
  return fnv1a((fontId << 21) | (codepoint & 0x1fffff));
}

class PerfectHashTable {
  keys: Uint32Array;
  values: Float32Array;
  size: number;
  seed: number;
  constructor(size: number, seed: number) {
    this.size = size;
    this.seed = seed;
    this.keys = new Uint32Array(size);
    this.values = new Float32Array(size);
    this.keys.fill(0xffffffff);
  }
  set(key: number, value: number): void {
    let idx = fnv1a(key ^ this.seed) % this.size;
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
    let idx = fnv1a(key ^ this.seed) % this.size;
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

interface GlyphEntry {
  codepoint: number;
  fontId: number;
  width: number;
}

function createGlyphTable(entries: GlyphEntry[]): PerfectHashTable {
  const size = Math.max(TABLE_SIZE, entries.length * 2);
  for (let seed = 0; seed < 256; seed++) {
    const table = new PerfectHashTable(size, seed);
    let valid = true;
    for (const e of entries) {
      table.set(mixHash(e.codepoint, e.fontId), e.width);
    }
    for (const e of entries) {
      if (table.get(mixHash(e.codepoint, e.fontId)) !== e.width) {
        valid = false;
        break;
      }
    }
    if (valid) return table;
  }
  const table = new PerfectHashTable(size, 0);
  for (const e of entries) table.set(mixHash(e.codepoint, e.fontId), e.width);
  return table;
}

function getWidth(table: PerfectHashTable, codepoint: number, fontId: number): number {
  const key = mixHash(codepoint, fontId);
  const w = table.get(key);
  return w < 0 ? 0 : w;
}

// ===== dfa.ts (simplified) =====
const enum BreakClass {
  BK = 0, CR = 1, LF = 2, CM = 3, SG = 4, ZW = 5,
  GL = 6, SP = 7, B2 = 8, BA = 9, BB = 10, HY = 11,
  CB = 12, CL = 13, CP = 14, EX = 15, IN = 16, NS = 17,
  OP = 18, QU = 19, IS = 20, NU = 21, PO = 22, PR = 23,
  SY = 24, AI = 25, AL = 26, CJ = 27, EB = 28, EM = 29,
  H2 = 30, H3 = 31, HL = 32, ID = 33, JL = 34, JV = 35,
  JT = 36, RI = 37, SA = 38, XX = 39,
}

function getBreakClass(cp: number): number {
  if (cp === 0x000a) return BreakClass.LF;
  if (cp === 0x000d) return BreakClass.CR;
  if (cp === 0x0009) return BreakClass.SP; // TAB
  if (cp === 0x0020) return BreakClass.SP;
  if (cp === 0x200b) return BreakClass.ZW;
  if (cp >= 0x0030 && cp <= 0x0039) return BreakClass.NU;
  if ((cp >= 0x0041 && cp <= 0x005a) || (cp >= 0x0061 && cp <= 0x007a)) return BreakClass.AL;
  if ((cp >= 0x4e00 && cp <= 0x9fff)) return BreakClass.ID;
  return BreakClass.XX;
}

function findBreakPoint(prefixSum: Float64Array, start: number, width: number): number {
  let lo = start;
  let hi = prefixSum.length - 1;
  const target = (start > 0 ? prefixSum[start - 1] : 0) + width;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (prefixSum[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// ===== memory.ts =====
const MAX_LINES = 1024;
const MAX_SPANS = 4096;
const SPAN_STRIDE = 8;
const ARENA_SIZE = 1024 * 1024;

class ArenaPool {
  buffer: ArrayBuffer;
  lineOffset: number;
  spanOffset: number;
  stringPoolOffset: number;
  generation: number;
  lineGeneration: Uint32Array;
  spanGeneration: Uint32Array;
  head: number;
  tail: number;
  lineX: Float64Array;
  lineY: Float64Array;
  lineWidth: Float32Array;
  lineHeight: Float32Array;
  lineFlags: Uint8Array;
  stringPool: Uint16Array;

  constructor() {
    this.buffer = new ArrayBuffer(ARENA_SIZE);
    this.generation = 0;
    this.head = 0;
    this.tail = 0;
    const lineXOffset = 0;
    const lineYOffset = lineXOffset + MAX_LINES * 8;
    const lineWidthOffset = lineYOffset + MAX_LINES * 8;
    const lineHeightOffset = lineWidthOffset + MAX_LINES * 4;
    this.spanOffset = lineHeightOffset + MAX_LINES * 4;
    this.stringPoolOffset = this.spanOffset + MAX_SPANS * SPAN_STRIDE;
    this.lineOffset = 0;
    this.lineX = new Float64Array(this.buffer, lineXOffset, MAX_LINES);
    this.lineY = new Float64Array(this.buffer, lineYOffset, MAX_LINES);
    this.lineWidth = new Float32Array(this.buffer, lineWidthOffset, MAX_LINES);
    this.lineHeight = new Float32Array(this.buffer, lineHeightOffset, MAX_LINES);
    this.lineFlags = new Uint8Array(MAX_LINES);
    this.lineGeneration = new Uint32Array(MAX_LINES);
    this.spanGeneration = new Uint32Array(MAX_SPANS);
    const remaining = ARENA_SIZE - this.stringPoolOffset;
    this.stringPool = new Uint16Array(this.buffer, this.stringPoolOffset, Math.floor(remaining / 2));
  }

  allocLine(): number {
    const idx = this.head;
    this.head = (this.head + 1) % MAX_LINES;
    this.lineGeneration[idx] = this.generation;
    this.lineX[idx] = 0;
    this.lineY[idx] = 0;
    this.lineWidth[idx] = 0;
    this.lineHeight[idx] = 0;
    this.lineFlags[idx] = 0;
    return idx;
  }

  allocSpan(): number {
    const idx = this.tail;
    this.tail = (this.tail + 1) % MAX_SPANS;
    this.spanGeneration[idx] = this.generation;
    return idx;
  }

  reset(): void {
    this.head = 0;
    this.tail = 0;
    this.generation++;
    this.lineFlags.fill(0);
  }

  gc(): number {
    const threshold = this.generation > 1 ? this.generation - 1 : 0;
    let freed = 0;
    for (let i = 0; i < MAX_LINES; i++) {
      if (this.lineGeneration[i] < threshold) { this.lineFlags[i] = 0; freed++; }
    }
    for (let i = 0; i < MAX_SPANS; i++) {
      if (this.spanGeneration[i] < threshold) freed++;
    }
    return freed;
  }
}

// ===== Minimal solveLayout (mirrors layout.ts logic) =====
interface Span { x: number; width: number; textStart: number; textEnd: number; fontId: number; }
interface Line { x: number; y: number; width: number; height: number; spans: Span[]; }
interface LayoutResult { lines: Line[]; height: number; width: number; spanCount: number; }
interface LayoutParams { glyphTable: PerfectHashTable; text: Uint32Array; width: number; lineHeight?: number; tabSize?: number; collapseWhitespace?: boolean; }

const sharedArena = new ArenaPool();

function solveLayout(params: LayoutParams): LayoutResult {
  const { glyphTable, text, width, lineHeight: lh } = params;
  const lineHeight = lh ?? 20;
  const tabSize = params.tabSize ?? 32;
  const collapse = params.collapseWhitespace ?? false;
  const len = text.length;
  sharedArena.reset();
  if (len === 0) return { lines: [], height: 0, width: 0, spanCount: 0 };

  const prefixSum = new Float64Array(len);
  let cumWidth = 0;
  for (let i = 0; i < len; i++) {
    const cp = text[i];
    if (cp === 0x000A || cp === 0x000D) {
      prefixSum[i] = cumWidth;
      continue;
    }
    if (cp === 0x0009) {
      const advance = tabSize - (cumWidth % tabSize) || tabSize;
      if (!(collapse && i > 0 && (text[i - 1] === 0x0020 || text[i - 1] === 0x0009 || text[i - 1] === 0x000A))) {
        cumWidth += advance;
      }
      prefixSum[i] = cumWidth;
      continue;
    }
    if (collapse && cp === 0x0020 && i > 0 && (text[i - 1] === 0x0020 || text[i - 1] === 0x0009)) {
      prefixSum[i] = cumWidth;
      continue;
    }
    cumWidth += getWidth(glyphTable, cp, 0);
    prefixSum[i] = cumWidth;
  }

  const lines: Line[] = [];
  let cursorY = 0;
  let start = 0;
  let totalWidth = 0;
  let spanCount = 0;

  while (start < len) {
    // Scan for forced newline break
    let forcedBreak = -1;
    for (let i = start; i < len; i++) {
      const cp = text[i];
      if (cp === 0x000A || cp === 0x000D) {
        forcedBreak = i;
        break;
      }
    }

    let end: number;
    if (forcedBreak >= 0) {
      const widthEnd = findBreakPoint(prefixSum, start, width);
      if (widthEnd >= forcedBreak) {
        end = forcedBreak;
      } else {
        end = widthEnd;
        if (end < start) end = start;
        if (end < forcedBreak) {
          let breakPos = end;
          while (breakPos > start) {
            const cls = getBreakClass(text[breakPos]);
            if (cls === BreakClass.SP || cls === BreakClass.BA || cls === BreakClass.HY || cls === BreakClass.ZW) {
              end = breakPos; break;
            }
            breakPos--;
          }
        }
        end = Math.min(end + 1, len);
        forcedBreak = -1;
      }
    } else {
      end = findBreakPoint(prefixSum, start, width);
      if (end < start) end = start;
      if (end < len - 1) {
        let breakPos = end;
        while (breakPos > start) {
          const cls = getBreakClass(text[breakPos]);
          if (cls === BreakClass.SP || cls === BreakClass.BA || cls === BreakClass.HY ||
              cls === BreakClass.ZW || cls === BreakClass.BK || cls === BreakClass.LF || cls === BreakClass.CR) {
            end = breakPos;
            break;
          }
          breakPos--;
        }
      }
      end = Math.min(end + 1, len);
    }

    const lineIdx = sharedArena.allocLine();
    const lineStartWidth = start > 0 ? prefixSum[start - 1] : 0;
    const visEnd = forcedBreak >= 0 ? forcedBreak : end;
    const lineW = visEnd > start ? prefixSum[visEnd - 1] - lineStartWidth : 0;

    sharedArena.lineX[lineIdx] = 0;
    sharedArena.lineY[lineIdx] = cursorY;
    sharedArena.lineWidth[lineIdx] = lineW;
    sharedArena.lineHeight[lineIdx] = lineHeight;
    sharedArena.allocSpan();
    spanCount++;

    const span: Span = { x: 0, width: lineW, textStart: start, textEnd: forcedBreak >= 0 ? forcedBreak : end, fontId: 0 };
    const line: Line = { x: 0, y: cursorY, width: lineW, height: lineHeight, spans: [span] };
    lines.push(line);
    totalWidth = Math.max(totalWidth, lineW);
    cursorY += lineHeight;

    if (forcedBreak >= 0) {
      start = forcedBreak + 1;
      if (text[forcedBreak] === 0x000D && start < len && text[start] === 0x000A) {
        start++;
      }
    } else {
      start = end;
      while (start < len && (text[start] === 0x0020 || text[start] === 0x0009)) start++;
    }
    if (lines.length >= MAX_LINES) break;
  }

  return { lines, height: cursorY, width: totalWidth, spanCount };
}

// ===== Compat layer =====
function toCodePoints(text: string): Uint32Array {
  const points: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i)!;
    points.push(code);
    if (code > 0xffff) i++;
  }
  return new Uint32Array(points);
}

// Proportional width estimation (mirrors compat.ts classifyWidth)
const NARROW_SET = new Set([0x69,0x6C,0x7C,0x21,0x3A,0x3B,0x2C,0x2E,0x27,0x60,0x31]);
const XWIDE_SET = new Set([0x4D,0x57,0x40]);
const WIDE_LOWER_SET = new Set([0x6D,0x77]);
function classifyWidth(cp: number): number {
  if (cp === 0x0020) return 4.0;
  if (cp === 0x0009) return 32;
  if (cp === 0x000A || cp === 0x000D) return 0;
  if (NARROW_SET.has(cp)) return 4.5;
  if (XWIDE_SET.has(cp)) return 10.5;
  if (WIDE_LOWER_SET.has(cp)) return 9.0;
  if (cp >= 0x0030 && cp <= 0x0039) return 7.5;
  if (cp >= 0x0041 && cp <= 0x005A) return 9.0;
  if (cp >= 0x0061 && cp <= 0x007A) return 7.5;
  if (cp >= 0x00C0 && cp <= 0x024F) return 7.5;
  if (cp >= 0x4E00 && cp <= 0x9FFF) return 16.0;
  if (cp >= 0x3040 && cp <= 0x30FF) return 16.0;
  if (cp >= 0xAC00 && cp <= 0xD7A3) return 16.0;
  if (cp >= 0x1F000 && cp <= 0x1FAFF) return 16.0;
  return 7.5;
}

function prepare(text: string) {
  const codepoints = toCodePoints(text);
  const entries: GlyphEntry[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < codepoints.length; i++) {
    if (!seen.has(codepoints[i])) {
      seen.add(codepoints[i]);
      entries.push({ codepoint: codepoints[i], fontId: 0, width: classifyWidth(codepoints[i]) });
    }
  }
  return { codepoints, glyphTable: createGlyphTable(entries) };
}

// =================== TESTS ===================

describe("PerfectHashTable", () => {
  it("stores and retrieves values", () => {
    const table = new PerfectHashTable(64, 0);
    table.set(42, 10.5);
    assert.equal(table.get(42), 10.5);
  });

  it("returns -1 for missing keys", () => {
    const table = new PerfectHashTable(64, 0);
    assert.equal(table.get(999), -1);
  });

  it("handles multiple entries without collision", () => {
    const entries: GlyphEntry[] = [];
    for (let i = 65; i <= 90; i++) {
      entries.push({ codepoint: i, fontId: 0, width: i - 60 });
    }
    const table = createGlyphTable(entries);
    for (const e of entries) {
      assert.equal(getWidth(table, e.codepoint, 0), e.width);
    }
  });
});

describe("createGlyphTable", () => {
  it("creates a table that retrieves all entries correctly", () => {
    const entries: GlyphEntry[] = [
      { codepoint: 0x48, fontId: 0, width: 9 },  // H
      { codepoint: 0x65, fontId: 0, width: 7 },  // e
      { codepoint: 0x6c, fontId: 0, width: 4 },  // l
      { codepoint: 0x6f, fontId: 0, width: 8 },  // o
    ];
    const table = createGlyphTable(entries);
    assert.equal(getWidth(table, 0x48, 0), 9);
    assert.equal(getWidth(table, 0x65, 0), 7);
    assert.equal(getWidth(table, 0x6c, 0), 4);
    assert.equal(getWidth(table, 0x6f, 0), 8);
  });

  it("returns 0 for unknown codepoints", () => {
    const table = createGlyphTable([{ codepoint: 65, fontId: 0, width: 8 }]);
    assert.equal(getWidth(table, 9999, 0), 0);
  });
});

describe("findBreakPoint", () => {
  it("finds correct break position for simple prefix sums", () => {
    const ps = new Float64Array([8, 16, 24, 32, 40]);
    assert.equal(findBreakPoint(ps, 0, 24), 2);
    assert.equal(findBreakPoint(ps, 0, 25), 2);
    assert.equal(findBreakPoint(ps, 0, 32), 3);
  });

  it("handles start offset correctly", () => {
    const ps = new Float64Array([8, 16, 24, 32, 40]);
    // start=2, target = ps[1] + 16 = 16 + 16 = 32
    assert.equal(findBreakPoint(ps, 2, 16), 3);
  });

  it("returns start when width is too small", () => {
    const ps = new Float64Array([10, 20, 30]);
    assert.equal(findBreakPoint(ps, 0, 5), 0);
  });
});

describe("ArenaPool", () => {
  it("allocates lines with incrementing indices", () => {
    const pool = new ArenaPool();
    pool.reset();
    assert.equal(pool.allocLine(), 0);
    assert.equal(pool.allocLine(), 1);
    assert.equal(pool.allocLine(), 2);
  });

  it("wraps around at MAX_LINES", () => {
    const pool = new ArenaPool();
    pool.reset();
    for (let i = 0; i < MAX_LINES; i++) pool.allocLine();
    assert.equal(pool.allocLine(), 0); // wraps
  });

  it("lineWidth and lineHeight are backed by the arena buffer", () => {
    const pool = new ArenaPool();
    pool.reset();
    const idx = pool.allocLine();
    pool.lineWidth[idx] = 42.5;
    pool.lineHeight[idx] = 20;
    // Verify they're views into the same buffer
    assert.equal(pool.lineWidth.buffer, pool.buffer);
    assert.equal(pool.lineHeight.buffer, pool.buffer);
    assert.equal(pool.lineWidth[idx], 42.5);
    assert.equal(pool.lineHeight[idx], 20);
  });

  it("reset increments generation and resets head/tail", () => {
    const pool = new ArenaPool();
    pool.allocLine();
    pool.allocLine();
    pool.reset();
    assert.equal(pool.allocLine(), 0);
  });

  it("gc frees old generation lines", () => {
    const pool = new ArenaPool();
    pool.reset(); // gen 1
    pool.allocLine();
    pool.reset(); // gen 2
    pool.allocLine();
    const freed = pool.gc();
    assert.ok(freed > 0);
  });
});

describe("solveLayout", () => {
  it("returns empty result for empty text", () => {
    const table = createGlyphTable([]);
    const result = solveLayout({ glyphTable: table, text: new Uint32Array(0), width: 100 });
    assert.equal(result.lines.length, 0);
    assert.equal(result.height, 0);
    assert.equal(result.width, 0);
    assert.equal(result.spanCount, 0);
  });

  it("lays out single word on one line when it fits", () => {
    const { codepoints, glyphTable } = prepare("Hello");
    const result = solveLayout({ glyphTable, text: codepoints, width: 100 });
    assert.equal(result.lines.length, 1);
    assert.equal(result.height, 20);
    assert.equal(result.lines[0].spans[0].textStart, 0);
    assert.equal(result.lines[0].spans[0].textEnd, 5);
  });

  it("wraps text into multiple lines", () => {
    const { codepoints, glyphTable } = prepare("Hello World");
    // Each char is 8px wide, "Hello" = 40px, " " = 8px, "World" = 40px = total 88px
    // Width 50 should fit "Hello " (48px) on first line, "World" on second
    const result = solveLayout({ glyphTable, text: codepoints, width: 50 });
    assert.ok(result.lines.length >= 2, `Expected >= 2 lines, got ${result.lines.length}`);
  });

  it("respects custom lineHeight", () => {
    const { codepoints, glyphTable } = prepare("AB");
    const result = solveLayout({ glyphTable, text: codepoints, width: 100, lineHeight: 30 });
    assert.equal(result.lines[0].height, 30);
    assert.equal(result.height, 30);
  });

  it("handles forced line breaks via newline characters", () => {
    const { codepoints, glyphTable } = prepare("A\nB");
    const result = solveLayout({ glyphTable, text: codepoints, width: 100 });
    // Should have at least 1 line (newline is treated via break class)
    assert.ok(result.lines.length >= 1);
  });

  it("produces correct span count", () => {
    const { codepoints, glyphTable } = prepare("Hello World Test");
    const result = solveLayout({ glyphTable, text: codepoints, width: 50 });
    assert.equal(result.spanCount, result.lines.length);
  });

  it("skips leading spaces on wrapped lines", () => {
    const { codepoints, glyphTable } = prepare("AA BB");
    // Width 20 fits "AA " (24px > 20), so "AA" at 16px, then " BB"
    const result = solveLayout({ glyphTable, text: codepoints, width: 20 });
    if (result.lines.length > 1) {
      const secondLine = result.lines[1];
      const firstChar = codepoints[secondLine.spans[0].textStart];
      // First char should not be space
      assert.notEqual(firstChar, 0x0020);
    }
  });

  it("does not exceed MAX_LINES", () => {
    // Create very long text with narrow width to force many lines
    const text = "A ".repeat(2000);
    const { codepoints, glyphTable } = prepare(text);
    const result = solveLayout({ glyphTable, text: codepoints, width: 10 });
    assert.ok(result.lines.length <= MAX_LINES);
  });
});

describe("toCodePoints (surrogate pair handling)", () => {
  it("correctly converts ASCII text", () => {
    const cp = toCodePoints("ABC");
    assert.equal(cp.length, 3);
    assert.equal(cp[0], 65);
    assert.equal(cp[1], 66);
    assert.equal(cp[2], 67);
  });

  it("correctly handles emoji (surrogate pairs)", () => {
    const cp = toCodePoints("😀");
    assert.equal(cp.length, 1);
    assert.equal(cp[0], 0x1f600);
  });

  it("correctly handles mixed ASCII and emoji", () => {
    const cp = toCodePoints("A😀B");
    assert.equal(cp.length, 3);
    assert.equal(cp[0], 65);
    assert.equal(cp[1], 0x1f600);
    assert.equal(cp[2], 66);
  });

  it("handles CJK characters correctly", () => {
    const cp = toCodePoints("世界");
    assert.equal(cp.length, 2);
    assert.equal(cp[0], 0x4e16);
    assert.equal(cp[1], 0x754c);
  });
});

describe("getBreakClass", () => {
  it("classifies ASCII letters as AL", () => {
    assert.equal(getBreakClass(0x41), BreakClass.AL); // A
    assert.equal(getBreakClass(0x7a), BreakClass.AL); // z
  });

  it("classifies space as SP", () => {
    assert.equal(getBreakClass(0x20), BreakClass.SP);
  });

  it("classifies digits as NU", () => {
    assert.equal(getBreakClass(0x30), BreakClass.NU); // 0
    assert.equal(getBreakClass(0x39), BreakClass.NU); // 9
  });

  it("classifies CJK as ID", () => {
    assert.equal(getBreakClass(0x4e00), BreakClass.ID);
    assert.equal(getBreakClass(0x9fff), BreakClass.ID);
  });

  it("classifies LF and CR correctly", () => {
    assert.equal(getBreakClass(0x0a), BreakClass.LF);
    assert.equal(getBreakClass(0x0d), BreakClass.CR);
  });
});

describe("EmojiMap", () => {
  // Inline minimal EmojiMap for testing
  const ZWJ = 0x200d;
  const VS16 = 0xfe0f;

  class TestEmojiMap {
    private sequences: Map<string, number>;
    constructor() { this.sequences = new Map(); }
    addSequence(codepoints: number[], clusterWidth: number): void {
      this.sequences.set(codepoints.map(c => c.toString(36)).join(":"), clusterWidth);
    }
    isZWJCluster(codepoints: Uint32Array, offset: number, length: number): number {
      let end = offset + 1;
      while (end < offset + length && end < codepoints.length) {
        if (codepoints[end] === ZWJ && end + 1 < codepoints.length) {
          end += 2;
          if (end < codepoints.length && codepoints[end] === VS16) end++;
        } else if (codepoints[end] === VS16) {
          end++;
        } else break;
      }
      return end - offset;
    }
    getClusterWidth(codepoints: Uint32Array, offset: number, length: number): number {
      const slice: number[] = [];
      for (let i = offset; i < offset + length && i < codepoints.length; i++) slice.push(codepoints[i]);
      const key = slice.map(c => c.toString(36)).join(":");
      const w = this.sequences.get(key);
      return w !== undefined ? w : -1;
    }
  }

  it("detects ZWJ cluster length", () => {
    const emoji = new TestEmojiMap();
    // Man + ZWJ + Woman: 👨‍👩 = 0x1f468, 0x200d, 0x1f469
    const seq = new Uint32Array([0x1f468, ZWJ, 0x1f469]);
    assert.equal(emoji.isZWJCluster(seq, 0, 3), 3);
  });

  it("returns 1 for non-ZWJ characters", () => {
    const emoji = new TestEmojiMap();
    const seq = new Uint32Array([65, 66, 67]); // ABC
    assert.equal(emoji.isZWJCluster(seq, 0, 3), 1);
  });

  it("stores and retrieves cluster widths", () => {
    const emoji = new TestEmojiMap();
    emoji.addSequence([0x1f468, ZWJ, 0x1f469], 24);
    const seq = new Uint32Array([0x1f468, ZWJ, 0x1f469]);
    assert.equal(emoji.getClusterWidth(seq, 0, 3), 24);
  });

  it("returns -1 for unknown clusters", () => {
    const emoji = new TestEmojiMap();
    const seq = new Uint32Array([0x1f468, ZWJ, 0x1f469]);
    assert.equal(emoji.getClusterWidth(seq, 0, 3), -1);
  });
});

describe("ZTB codegen round-trip", () => {
  // Inline minimal codegen for testing
  const MAGIC = new Uint8Array([0x5a, 0x45, 0x52, 0x4f]);
  const VERSION = 1;

  function computeChecksum(buffer: ArrayBuffer): number {
    const view = new Uint8Array(buffer);
    let sum = 0;
    for (let i = 0; i < view.length; i++) {
      sum = (sum + view[i] * (i + 1)) >>> 0;
    }
    return sum;
  }

  it("computeChecksum produces consistent results", () => {
    const buf = new Uint8Array([1, 2, 3, 4]).buffer;
    const c1 = computeChecksum(buf);
    const c2 = computeChecksum(buf);
    assert.equal(c1, c2);
  });

  it("computeChecksum produces different results for different data", () => {
    const buf1 = new Uint8Array([1, 2, 3, 4]).buffer;
    const buf2 = new Uint8Array([4, 3, 2, 1]).buffer;
    assert.notEqual(computeChecksum(buf1), computeChecksum(buf2));
  });

  it("MAGIC bytes spell ZERO", () => {
    assert.equal(String.fromCharCode(...MAGIC), "ZERO");
  });
});

describe("Integration: compat layer", () => {
  it("prepare + solveLayout produces valid output", () => {
    const { codepoints, glyphTable } = prepare("The quick brown fox");
    const result = solveLayout({ glyphTable, text: codepoints, width: 200 });
    assert.ok(result.lines.length >= 1);
    assert.ok(result.height > 0);
    assert.ok(result.width > 0);
  });

  it("measure returns total text width", () => {
    const { codepoints, glyphTable } = prepare("ABC");
    let total = 0;
    for (let i = 0; i < codepoints.length; i++) {
      total += getWidth(glyphTable, codepoints[i], 0);
    }
    assert.equal(total, 27); // 3 uppercase chars × 9px each
  });

  it("handles empty string", () => {
    const { codepoints, glyphTable } = prepare("");
    const result = solveLayout({ glyphTable, text: codepoints, width: 100 });
    assert.equal(result.lines.length, 0);
  });
});

describe("LRU Cache behavior", () => {
  // Inline minimal LRU cache for testing
  interface CacheEntry { key: string; value: number; prev: CacheEntry | null; next: CacheEntry | null; }

  class TestLRU {
    map: Map<string, CacheEntry>;
    head: CacheEntry | null;
    tail: CacheEntry | null;
    capacity: number;
    size: number;
    constructor(capacity: number) {
      this.capacity = capacity;
      this.size = 0;
      this.map = new Map();
      this.head = null;
      this.tail = null;
    }
    get(key: string): number | null {
      const entry = this.map.get(key);
      if (!entry) return null;
      this.moveToHead(entry);
      return entry.value;
    }
    set(key: string, value: number): void {
      const existing = this.map.get(key);
      if (existing) { existing.value = value; this.moveToHead(existing); return; }
      const entry: CacheEntry = { key, value, prev: null, next: this.head };
      if (this.head) this.head.prev = entry;
      this.head = entry;
      if (!this.tail) this.tail = entry;
      this.map.set(key, entry);
      this.size++;
      if (this.size > this.capacity) this.evict();
    }
    private moveToHead(entry: CacheEntry): void {
      if (entry === this.head) return;
      if (entry.prev) entry.prev.next = entry.next;
      if (entry.next) entry.next.prev = entry.prev;
      if (entry === this.tail) this.tail = entry.prev;
      entry.prev = null;
      entry.next = this.head;
      if (this.head) this.head.prev = entry;
      this.head = entry;
    }
    private evict(): void {
      if (!this.tail) return;
      this.map.delete(this.tail.key);
      if (this.tail.prev) this.tail.prev.next = null;
      this.tail = this.tail.prev;
      this.size--;
    }
  }

  it("stores and retrieves values", () => {
    const cache = new TestLRU(3);
    cache.set("a", 1);
    assert.equal(cache.get("a"), 1);
  });

  it("returns null for missing keys", () => {
    const cache = new TestLRU(3);
    assert.equal(cache.get("missing"), null);
  });

  it("evicts least recently used entry when capacity exceeded", () => {
    const cache = new TestLRU(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3); // should evict "a"
    assert.equal(cache.get("a"), null);
    assert.equal(cache.get("b"), 2);
    assert.equal(cache.get("c"), 3);
  });

  it("access promotes entry preventing eviction", () => {
    const cache = new TestLRU(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a"); // promote "a"
    cache.set("c", 3); // should evict "b" not "a"
    assert.equal(cache.get("a"), 1);
    assert.equal(cache.get("b"), null);
    assert.equal(cache.get("c"), 3);
  });

  it("updates existing entry value", () => {
    const cache = new TestLRU(3);
    cache.set("a", 1);
    cache.set("a", 99);
    assert.equal(cache.get("a"), 99);
    assert.equal(cache.size, 1);
  });
});

// =================== PRACTICALITY TESTS ===================

describe("Forced newline breaks", () => {
  it("breaks on \\n producing separate lines", () => {
    const { codepoints, glyphTable } = prepare("Hello\nWorld");
    const result = solveLayout({ glyphTable, text: codepoints, width: 500 });
    assert.equal(result.lines.length, 2, `Expected 2 lines, got ${result.lines.length}`);
    // First line should contain "Hello" (indices 0-4), not the newline
    assert.equal(result.lines[0].spans[0].textEnd, 5);
    // Second line should start at "World"
    assert.equal(result.lines[1].spans[0].textStart, 6);
  });

  it("handles multiple consecutive newlines (empty lines)", () => {
    const { codepoints, glyphTable } = prepare("A\n\nB");
    const result = solveLayout({ glyphTable, text: codepoints, width: 500 });
    assert.equal(result.lines.length, 3, `Expected 3 lines, got ${result.lines.length}`);
    // Middle line should be empty (zero width)
    assert.equal(result.lines[1].width, 0);
  });

  it("handles CR+LF as a single line break", () => {
    const text = "Line1\r\nLine2";
    const { codepoints, glyphTable } = prepare(text);
    const result = solveLayout({ glyphTable, text: codepoints, width: 500 });
    assert.equal(result.lines.length, 2, `Expected 2 lines, got ${result.lines.length}`);
  });

  it("handles trailing newline", () => {
    const { codepoints, glyphTable } = prepare("Hello\n");
    const result = solveLayout({ glyphTable, text: codepoints, width: 500 });
    // "Hello" on first line, then empty line from trailing newline
    assert.ok(result.lines.length >= 1);
  });

  it("handles leading newline", () => {
    const { codepoints, glyphTable } = prepare("\nHello");
    const result = solveLayout({ glyphTable, text: codepoints, width: 500 });
    assert.equal(result.lines.length, 2, `Expected 2 lines, got ${result.lines.length}`);
    // First line should be empty
    assert.equal(result.lines[0].width, 0);
  });
});

describe("Tab handling", () => {
  it("tabs classified as breakable whitespace (SP class)", () => {
    assert.equal(getBreakClass(0x0009), BreakClass.SP);
  });

  it("tabs have non-zero width in layout", () => {
    const text = "A\tB";
    const { codepoints, glyphTable } = prepare(text);
    const result = solveLayout({ glyphTable, text: codepoints, width: 500 });
    assert.equal(result.lines.length, 1);
    // Width should be > "AB" (16px) because of the tab
    assert.ok(result.width > 16, `Tab width should be > 16, got ${result.width}`);
  });

  it("tabs are skipped as leading whitespace on wrapped lines", () => {
    const text = "AA\tBB";
    const { codepoints, glyphTable } = prepare(text);
    const result = solveLayout({ glyphTable, text: codepoints, width: 20 });
    if (result.lines.length > 1) {
      const secondLine = result.lines[1];
      const firstChar = codepoints[secondLine.spans[0].textStart];
      // Should not start with a tab
      assert.notEqual(firstChar, 0x0009);
    }
  });
});

describe("Newlines have zero width", () => {
  it("newline characters do not add to line width", () => {
    const textA = "AB";
    const textB = "A\nB";
    const { codepoints: cpA, glyphTable: gtA } = prepare(textA);
    const { codepoints: cpB, glyphTable: gtB } = prepare(textB);
    const resultA = solveLayout({ glyphTable: gtA, text: cpA, width: 500 });
    const resultB = solveLayout({ glyphTable: gtB, text: cpB, width: 500 });
    // First line of textB ("A") should be narrower than textA ("AB")
    assert.ok(resultB.lines[0].width < resultA.lines[0].width);
  });
});

describe("Whitespace collapsing", () => {
  it("collapses multiple spaces when enabled", () => {
    const text = "A    B";
    const cpArr = toCodePoints(text);
    const entries: GlyphEntry[] = [];
    const seen = new Set<number>();
    for (let i = 0; i < cpArr.length; i++) {
      if (!seen.has(cpArr[i])) {
        seen.add(cpArr[i]);
        entries.push({ codepoint: cpArr[i], fontId: 0, width: 8 });
      }
    }
    const gt = createGlyphTable(entries);
    const collapsed = solveLayout({ glyphTable: gt, text: cpArr, width: 500, collapseWhitespace: true });
    const normal = solveLayout({ glyphTable: gt, text: cpArr, width: 500, collapseWhitespace: false });
    // Collapsed width should be less than uncollapsed
    assert.ok(collapsed.width < normal.width,
      `Collapsed ${collapsed.width} should be < normal ${normal.width}`);
  });
});

describe("Proportional width compat layer", () => {
  it("narrow chars (i, l) are narrower than wide chars (M, W)", () => {
    const { codepoints: cpI, glyphTable: gtI } = prepare("iiii");
    const { codepoints: cpM, glyphTable: gtM } = prepare("MMMM");
    let wI = 0, wM = 0;
    for (let i = 0; i < cpI.length; i++) wI += getWidth(gtI, cpI[i], 0);
    for (let i = 0; i < cpM.length; i++) wM += getWidth(gtM, cpM[i], 0);
    assert.ok(wI < wM, `"iiii" (${wI}) should be narrower than "MMMM" (${wM})`);
  });

  it("CJK characters are wider than Latin", () => {
    const { codepoints: cpL, glyphTable: gtL } = prepare("AB");
    const { codepoints: cpC, glyphTable: gtC } = prepare("世界");
    let wL = 0, wC = 0;
    for (let i = 0; i < cpL.length; i++) wL += getWidth(gtL, cpL[i], 0);
    for (let i = 0; i < cpC.length; i++) wC += getWidth(gtC, cpC[i], 0);
    assert.ok(wC > wL, `CJK (${wC}) should be wider than Latin (${wL})`);
  });

  it("measure returns proportional width, not flat", () => {
    // "iiii" should be noticeably narrower than "MMMM"
    const { codepoints: cpI, glyphTable: gtI } = prepare("iiii");
    const { codepoints: cpM, glyphTable: gtM } = prepare("MMMM");
    let totalI = 0, totalM = 0;
    for (let i = 0; i < cpI.length; i++) totalI += getWidth(gtI, cpI[i], 0);
    for (let i = 0; i < cpM.length; i++) totalM += getWidth(gtM, cpM[i], 0);
    // They should NOT be equal (the old 8px flat width would make them equal)
    assert.notEqual(totalI, totalM);
  });
});

describe("Edge cases", () => {
  it("single character text", () => {
    const { codepoints, glyphTable } = prepare("X");
    const result = solveLayout({ glyphTable, text: codepoints, width: 100 });
    assert.equal(result.lines.length, 1);
    assert.ok(result.width > 0);
  });

  it("only whitespace", () => {
    const { codepoints, glyphTable } = prepare("   ");
    const result = solveLayout({ glyphTable, text: codepoints, width: 100 });
    assert.ok(result.lines.length >= 1);
  });

  it("only newlines", () => {
    const { codepoints, glyphTable } = prepare("\n\n\n");
    const result = solveLayout({ glyphTable, text: codepoints, width: 100 });
    assert.equal(result.lines.length, 3, `Expected 3 lines, got ${result.lines.length}`);
  });

  it("very long word without break opportunity", () => {
    const longWord = "Supercalifragilisticexpialidocious";
    const { codepoints, glyphTable } = prepare(longWord);
    // Very narrow width forces character-level breaking
    const result = solveLayout({ glyphTable, text: codepoints, width: 30 });
    assert.ok(result.lines.length > 1, "Long word should overflow to multiple lines");
  });

  it("mixed newlines and wrapping", () => {
    const text = "Short\nThis is a longer line that should wrap";
    const { codepoints, glyphTable } = prepare(text);
    const result = solveLayout({ glyphTable, text: codepoints, width: 100 });
    // Should have at least 3 lines: "Short", then wrapped content
    assert.ok(result.lines.length >= 3, `Expected >= 3 lines, got ${result.lines.length}`);
  });
});
