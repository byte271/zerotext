import { ArenaPool, MAX_LINES, MAX_PREFIX_LEN } from "./memory.js";
import { PerfectHashTable, getWidth, EmojiMap } from "./hash.js";
import { getBreakClass, findBreakPoint, BreakClass } from "./dfa.js";

export interface Span {
  x: number;
  width: number;
  textStart: number;
  textEnd: number;
  fontId: number;
}

export interface Line {
  x: number;
  y: number;
  width: number;
  height: number;
  spans: Span[];
}

export interface Constraint {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditOp {
  type: "insert" | "delete" | "replace";
  index: number;
  length: number;
  text?: Uint32Array;
}

export interface LayoutParams {
  glyphTable: PerfectHashTable;
  text: Uint32Array;
  width: number;
  lineHeight?: number;
  constraints?: Constraint[];
}

export interface LayoutResult {
  lines: Line[];
  height: number;
  width: number;
  spanCount: number;
}

/**
 * Compact layout result backed entirely by the arena.
 * Consumers who need zero-GC access should use solveLayoutCompact().
 * The arena owns all data; results are invalidated on the next call.
 */
export interface CompactLayoutResult {
  /** Number of lines produced */
  lineCount: number;
  /** Total layout height in px */
  height: number;
  /** Maximum line width in px */
  width: number;
  /** Total span count */
  spanCount: number;
  /** Reference to the arena – read line/span SoA arrays directly */
  arena: ArenaPool;
}

// Bitfield packing for per-character metadata (used by renderers)
const COORD_MASK = 0xfff;
const WIDTH_SHIFT = 12;
const WIDTH_MASK = 0xfff;
const FONT_SHIFT = 24;
const FONT_MASK = 0xf;
const FLAG_SHIFT = 28;
const FLAG_MASK = 0xf;

export function packChar(x: number, w: number, fontId: number, flags: number): number {
  return (
    ((x & COORD_MASK)) |
    (((w & WIDTH_MASK)) << WIDTH_SHIFT) |
    (((fontId & FONT_MASK)) << FONT_SHIFT) |
    (((flags & FLAG_MASK)) << FLAG_SHIFT)
  );
}

export function unpackX(packed: number): number {
  return packed & COORD_MASK;
}

export function unpackWidth(packed: number): number {
  return (packed >>> WIDTH_SHIFT) & WIDTH_MASK;
}

export function unpackFontId(packed: number): number {
  return (packed >>> FONT_SHIFT) & FONT_MASK;
}

const sharedArena = new ArenaPool();
const sharedEmoji = new EmojiMap();

// Overflow prefix-sum buffer for texts longer than MAX_PREFIX_LEN.
// Allocated lazily and reused across calls, so only one allocation
// ever occurs for the lifetime of the module.
let overflowPrefixSum: Float64Array | null = null;

function getPrefixSum(len: number): Float64Array {
  if (len <= MAX_PREFIX_LEN) {
    // Use the arena-backed pool – zero allocation
    return sharedArena.prefixSumPool;
  }
  // Rare path: very long text. Reuse a lazily-allocated overflow buffer.
  if (!overflowPrefixSum || overflowPrefixSum.length < len) {
    overflowPrefixSum = new Float64Array(len);
  }
  return overflowPrefixSum;
}

/**
 * Zero-allocation layout solver (compact path).
 * All results live in the shared arena's SoA arrays.
 * The returned CompactLayoutResult is valid until the next solveLayout call.
 */
export function solveLayoutCompact(params: LayoutParams): CompactLayoutResult {
  const { glyphTable, text, width, lineHeight: lh, constraints } = params;
  const lineHeight = lh ?? 20;
  const len = text.length;

  sharedArena.reset();

  if (len === 0) {
    return { lineCount: 0, height: 0, width: 0, spanCount: 0, arena: sharedArena };
  }

  // Build prefix sums using arena-backed buffer (no allocation for typical texts)
  const prefixSum = getPrefixSum(len);
  let cumWidth = 0;
  for (let i = 0; i < len; i++) {
    const cp = text[i];
    // Fast path: ASCII/Latin codepoints can't start emoji clusters
    if (cp < 0x200D) {
      cumWidth += getWidth(glyphTable, cp, 0);
      prefixSum[i] = cumWidth;
    } else {
      const clusterLen = sharedEmoji.isZWJCluster(text, i, len - i);
      if (clusterLen > 1) {
        const clusterWidth = sharedEmoji.getClusterWidth(text, i, clusterLen);
        const w = clusterWidth >= 0 ? clusterWidth : getWidth(glyphTable, cp, 0);
        cumWidth += w;
        prefixSum[i] = cumWidth;
        for (let j = 1; j < clusterLen && i + j < len; j++) {
          prefixSum[i + j] = cumWidth;
        }
        i += clusterLen - 1;
      } else {
        cumWidth += getWidth(glyphTable, cp, 0);
        prefixSum[i] = cumWidth;
      }
    }
  }

  let lineCount = 0;
  let cursorY = 0;
  let start = 0;
  let totalWidth = 0;
  let spanCount = 0;

  while (start < len) {
    let availWidth = width;

    if (constraints) {
      for (let c = 0; c < constraints.length; c++) {
        const con = constraints[c];
        if (cursorY + lineHeight > con.y && cursorY < con.y + con.height) {
          availWidth = Math.min(availWidth, width - con.width);
        }
      }
    }

    let end = findBreakPoint(prefixSum, start, availWidth);

    if (end < start) {
      end = start;
    }

    if (end < len - 1) {
      let breakPos = end;
      let brokeAtSoftHyphen = false;
      while (breakPos > start) {
        const cp = text[breakPos];
        if (cp === 0x00AD) { // SOFT_HYPHEN
          end = breakPos;
          brokeAtSoftHyphen = true;
          break;
        }
        const cls = getBreakClass(cp);
        if (
          cls === BreakClass.SP ||
          cls === BreakClass.BA ||
          cls === BreakClass.HY ||
          cls === BreakClass.ZW ||
          cls === BreakClass.BK ||
          cls === BreakClass.LF ||
          cls === BreakClass.CR
        ) {
          end = breakPos;
          break;
        }
        breakPos--;
      }
    }

    end = Math.min(end + 1, len);

    // Write line data into arena SoA arrays (zero allocation)
    const lineIdx = sharedArena.allocLine();
    const lineStartWidth = start > 0 ? prefixSum[start - 1] : 0;
    // When breaking at a soft hyphen, account for the visible hyphen width
    const softHyphenExtra = (end < len && end > 0 && text[end - 1] === 0x00AD)
      ? getWidth(glyphTable, 0x002D /* HYPHEN-MINUS */, 0)
      : 0;
    const lineW = prefixSum[end - 1] - lineStartWidth + softHyphenExtra;

    sharedArena.lineX[lineIdx] = 0;
    sharedArena.lineY[lineIdx] = cursorY;
    sharedArena.lineWidth[lineIdx] = lineW;
    sharedArena.lineHeight[lineIdx] = lineHeight;

    // Write span data into arena SoA arrays (zero allocation)
    const spanIdx = sharedArena.allocSpan();
    sharedArena.spanX[spanIdx] = 0;
    sharedArena.spanWidth[spanIdx] = lineW;
    sharedArena.spanTextStart[spanIdx] = start;
    sharedArena.spanTextEnd[spanIdx] = end;
    sharedArena.spanFontId[spanIdx] = 0;

    sharedArena.lineSpanStart[lineIdx] = spanIdx;
    sharedArena.lineSpanCount[lineIdx] = 1;

    lineCount++;
    spanCount++;
    totalWidth = Math.max(totalWidth, lineW);
    cursorY += lineHeight;
    start = end;

    while (start < len && text[start] === 0x0020) {
      start++;
    }

    if (lineCount >= MAX_LINES) break;
  }

  return {
    lineCount,
    height: cursorY,
    width: totalWidth,
    spanCount,
    arena: sharedArena,
  };
}

/**
 * Materialise a CompactLayoutResult into Line/Span JS objects.
 * This is the only place where JS objects are allocated for the result.
 * Call this only when you actually need the object-form result (e.g.
 * for the compat layer or framework bindings). Hot-path consumers
 * should use solveLayoutCompact() + arena SoA directly.
 */
export function materializeResult(compact: CompactLayoutResult): LayoutResult {
  const { lineCount, height, width: totalWidth, spanCount, arena } = compact;
  const lines: Line[] = [];

  for (let i = 0; i < lineCount; i++) {
    const sStart = arena.lineSpanStart[i];
    const sCount = arena.lineSpanCount[i];
    const spans: Span[] = [];
    for (let s = 0; s < sCount; s++) {
      const si = sStart + s;
      spans[s] = {
        x: arena.spanX[si],
        width: arena.spanWidth[si],
        textStart: arena.spanTextStart[si],
        textEnd: arena.spanTextEnd[si],
        fontId: arena.spanFontId[si],
      };
    }
    lines[i] = {
      x: arena.lineX[i],
      y: arena.lineY[i],
      width: arena.lineWidth[i],
      height: arena.lineHeight[i],
      spans,
    };
  }

  return { lines, height, width: totalWidth, spanCount };
}

/**
 * Public API: solve layout and return JS objects.
 * Uses the zero-alloc compact path internally, then materialises once.
 */
export function solveLayout(params: LayoutParams, _output?: ArrayBuffer): LayoutResult {
  const compact = solveLayoutCompact(params);
  return materializeResult(compact);
}
