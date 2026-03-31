import { solveLayout, solveLayoutCompact, materializeResult, LayoutParams, LayoutResult, CompactLayoutResult } from "./layout.js";
import { PerfectHashTable, createGlyphTable, getWidth, GlyphEntry, warmAsciiCache } from "./hash.js";
import { resolveLevels, reorderLine } from "./bidi.js";
import { LigatureTable, buildLigatureTable, applyLigatures, DEFAULT_LATIN_LIGATURES } from "./shaping.js";
import { TextAlign, alignLine } from "./align.js";
import { SOFT_HYPHEN, insertSoftHyphens } from "./hyphenation.js";
import { TruncateMode, truncateLine, ELLIPSIS } from "./truncation.js";
import { DecorationSpec, setDecoration, clearDecorations } from "./decoration.js";
import { WritingMode, rotateLayout } from "./vertical.js";
import { hitTest as htHitTest, getSelectionRects as htGetSelectionRects, CaretPosition, SelectionRange, SelectionRect } from "./hittest.js";
import { FontEntry, buildFallbackChain, resolveFontIds, _fontIds } from "./fontfallback.js";
import { toCodePoints, layoutText as compatLayoutText, TextOptions, LayoutMetrics } from "./compat.js";

export interface EngineConfig {
  config?: Record<string, unknown>;
  wasm?: boolean;
  gpu?: boolean;
  cacheSize?: number;
  textAlign?: number;       // TextAlign enum value
  writingMode?: number;     // WritingMode enum value
  truncate?: number;        // TruncateMode enum value
  maxLines?: number;
  enableBidi?: boolean;
  enableLigatures?: boolean;
  enableHyphenation?: boolean;
}

export interface PreparedText {
  codepoints: Uint32Array;
  glyphTable: PerfectHashTable;
  cacheKey: number;
}

interface CacheEntry {
  keyHash: number;
  result: LayoutResult;
  prev: CacheEntry | null;
  next: CacheEntry | null;
}

/** FNV-1a numeric hash for cache keys — avoids string allocation on every lookup */
function hashCacheKey(numericKey: number, width: number): number {
  let h = 0x811c9dc5;
  h ^= (numericKey & 0xff); h = Math.imul(h, 0x01000193);
  h ^= ((numericKey >>> 8) & 0xff); h = Math.imul(h, 0x01000193);
  h ^= ((numericKey >>> 16) & 0xff); h = Math.imul(h, 0x01000193);
  h ^= ((numericKey >>> 24) & 0xff); h = Math.imul(h, 0x01000193);
  // Mix in width as integer bits
  const wb = (width * 100) | 0;
  h ^= (wb & 0xff); h = Math.imul(h, 0x01000193);
  h ^= ((wb >>> 8) & 0xff); h = Math.imul(h, 0x01000193);
  h ^= ((wb >>> 16) & 0xff); h = Math.imul(h, 0x01000193);
  return h >>> 0;
}

class LRUCache {
  private map: Map<number, CacheEntry>;
  private head: CacheEntry | null;
  private tail: CacheEntry | null;
  private capacity: number;
  private _size: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this._size = 0;
    this.map = new Map();
    this.head = null;
    this.tail = null;
  }

  get size(): number {
    return this._size;
  }

  get(keyHash: number): LayoutResult | null {
    const entry = this.map.get(keyHash);
    if (!entry) return null;
    if (entry !== this.head) this.moveToHead(entry);
    return entry.result;
  }

  set(keyHash: number, result: LayoutResult): void {
    const existing = this.map.get(keyHash);
    if (existing) {
      existing.result = result;
      if (existing !== this.head) this.moveToHead(existing);
      return;
    }

    const entry: CacheEntry = {
      keyHash,
      result,
      prev: null,
      next: this.head
    };

    if (this.head) this.head.prev = entry;
    this.head = entry;
    if (!this.tail) this.tail = entry;

    this.map.set(keyHash, entry);
    this._size++;

    if (this._size > this.capacity) this.evict();
  }

  private moveToHead(entry: CacheEntry): void {
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
    this.map.delete(this.tail.keyHash);
    if (this.tail.prev) this.tail.prev.next = null;
    this.tail = this.tail.prev;
    this._size--;
  }

  clear(): void {
    this.map.clear();
    this.head = null;
    this.tail = null;
    this._size = 0;
  }
}

export class ZeroEngine {
  private config: EngineConfig;
  private cache: LRUCache;
  private useWasm: boolean;
  private ligatureTable: LigatureTable | null;
  private fallbackEntries: FontEntry[] | null;
  private spanDecorations: Map<number, DecorationSpec>;

  constructor(config: EngineConfig) {
    this.config = config;
    this.cache = new LRUCache(config.cacheSize ?? 128);
    this.useWasm = config.wasm ?? false;
    this.ligatureTable = config.enableLigatures
      ? buildLigatureTable(DEFAULT_LATIN_LIGATURES)
      : null;
    this.fallbackEntries = null;
    this.spanDecorations = new Map();
  }

  /**
   * Primary layout API. Returns materialized JS objects.
   */
  layout(params: LayoutParams): LayoutResult {
    return solveLayout(params);
  }

  /**
   * Zero-allocation layout returning a CompactLayoutResult backed by
   * the shared arena. Valid until the next layout/layoutCompact call.
   */
  layoutCompact(params: LayoutParams): CompactLayoutResult {
    return solveLayoutCompact(params);
  }

  layoutBatch(paramsList: LayoutParams[]): LayoutResult[] {
    return paramsList.map(p => this.layout(p));
  }

  prepare(text: string, glyphEntries: GlyphEntry[]): PreparedText {
    const points: number[] = [];
    for (let i = 0; i < text.length; i++) {
      const code = text.codePointAt(i) ?? 0;
      points.push(code);
      if (code > 0xffff) i++;
    }
    const codepoints = new Uint32Array(points);
    const glyphTable = createGlyphTable(glyphEntries);
    warmAsciiCache(glyphTable);
    // Numeric FNV-1a hash of first 64 codepoints — no string allocation
    let h = 0x811c9dc5;
    const end = Math.min(codepoints.length, 64);
    for (let i = 0; i < end; i++) {
      const cp = codepoints[i];
      h ^= (cp & 0xff); h = Math.imul(h, 0x01000193);
      h ^= ((cp >>> 8) & 0xff); h = Math.imul(h, 0x01000193);
      h ^= ((cp >>> 16) & 0xff); h = Math.imul(h, 0x01000193);
    }
    // Mix in total length for disambiguation
    h ^= (codepoints.length & 0xff); h = Math.imul(h, 0x01000193);
    h ^= ((codepoints.length >>> 8) & 0xff); h = Math.imul(h, 0x01000193);
    return { codepoints, glyphTable, cacheKey: h >>> 0 };
  }

  /**
   * Layout a PreparedText at a given width with LRU caching.
   * Cache hit returns in O(1) with zero computation.
   */
  update(prepared: PreparedText, width: number): LayoutResult {
    const h = hashCacheKey(prepared.cacheKey, width);
    const cached = this.cache.get(h);
    if (cached) return cached;

    const result = solveLayout({
      glyphTable: prepared.glyphTable,
      text: prepared.codepoints,
      width
    });

    this.cache.set(h, result);
    return result;
  }

  gc(): void {
    this.cache.clear();
  }

  /**
   * High-level API: lay out a plain string with proportional width estimation.
   * No glyph table setup required — just pass text, width, and optional config.
   *
   *   engine.layoutText("Hello world", 200)
   *   engine.layoutText("Hello world", 200, { fontSize: 14 })
   */
  layoutText(text: string, width: number, opts?: TextOptions): LayoutMetrics {
    return compatLayoutText(text, width, opts);
  }

  /**
   * Advanced layout pipeline applying all configured features in correct order.
   * Returns a fully processed LayoutResult.
   */
  layoutFull(params: LayoutParams, options?: Partial<EngineConfig>): LayoutResult {
    const opts = { ...this.config, ...options };
    let text = params.text;
    let len = text.length;

    // 1. Font fallback resolution
    if (this.fallbackEntries && this.fallbackEntries.length > 0) {
      resolveFontIds(text, len, _fontIds);
    }

    // 2. Bidi reordering
    if (opts.enableBidi) {
      const levels = resolveLevels(text, len);
      const indices = new Uint32Array(len);
      for (let i = 0; i < len; i++) indices[i] = i;
      reorderLine(levels, 0, len, indices);
      const reordered = new Uint32Array(len);
      for (let i = 0; i < len; i++) reordered[i] = text[indices[i]];
      text = reordered;
    }

    // 3. Ligature substitution
    if (opts.enableLigatures && this.ligatureTable) {
      len = applyLigatures(text, len, this.ligatureTable);
      if (len < text.length) {
        text = text.subarray(0, len);
      }
    }

    // 4. Hyphenation — insert soft hyphens
    if (opts.enableHyphenation) {
      const result = insertSoftHyphens(text, len, 2, 2);
      text = result.codepoints;
      len = result.len;
    }

    // 5. Core layout
    const layoutResult = solveLayout({
      glyphTable: params.glyphTable,
      text: text.subarray(0, len),
      width: params.width,
      lineHeight: params.lineHeight,
      constraints: params.constraints,
    });

    // 6. Truncation
    const maxLines = opts.maxLines ?? 0;
    const truncMode = (opts.truncate ?? 0) as number;
    if (maxLines > 0 && layoutResult.lines.length > maxLines && truncMode !== 0) {
      layoutResult.lines.length = maxLines;
      const lastLine = layoutResult.lines[maxLines - 1];
      // Recalculate height
      layoutResult.height = lastLine.y + lastLine.height;
    }

    // 7. Alignment
    const textAlign = (opts.textAlign ?? 0) as number;
    if (textAlign !== 0) {
      const lines = layoutResult.lines;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const extra = params.width - line.width;
        if (extra <= 0) continue;
        const shift = textAlign === 1 /* Center */ ? extra * 0.5
                    : textAlign === 2 /* Right */ ? extra
                    : 0;
        if (shift > 0) {
          for (const span of line.spans) {
            span.x += shift;
          }
          line.x += shift;
        }
      }
    }

    // 8. Vertical rotation (coordinate transform)
    if (opts.writingMode && opts.writingMode !== 0) {
      const lines = layoutResult.lines;
      const cw = params.width;
      const mode = opts.writingMode as number;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const ox = line.x, oy = line.y, ow = line.width, oh = line.height;
        if (mode === 1 /* VerticalRL */) {
          line.x = cw - oy - oh;
          line.y = ox;
        } else {
          line.x = oy;
          line.y = ox;
        }
        line.width = oh;
        line.height = ow;
      }
    }

    return layoutResult;
  }

  /**
   * Hit test a point against a layout result. Delegates to hittest module.
   */
  hitTest(x: number, y: number, layoutResult: LayoutResult): CaretPosition {
    const lines = layoutResult.lines;
    const lineCount = lines.length;
    // Build temporary SoA arrays from the materialized result
    const lineY = new Float64Array(lineCount);
    const lineHeight = new Float32Array(lineCount);
    let totalSpans = 0;
    for (let i = 0; i < lineCount; i++) totalSpans += lines[i].spans.length;
    const spanX = new Float32Array(totalSpans);
    const spanWidth = new Float32Array(totalSpans);
    const lineSpanStart = new Uint32Array(lineCount);
    const lineSpanCount = new Uint16Array(lineCount);
    const spanTextStart = new Uint32Array(totalSpans);
    const spanTextEnd = new Uint32Array(totalSpans);
    let si = 0;
    for (let i = 0; i < lineCount; i++) {
      const line = lines[i];
      lineY[i] = line.y;
      lineHeight[i] = line.height;
      lineSpanStart[i] = si;
      lineSpanCount[i] = line.spans.length;
      for (const span of line.spans) {
        spanX[si] = span.x;
        spanWidth[si] = span.width;
        spanTextStart[si] = span.textStart;
        spanTextEnd[si] = span.textEnd;
        si++;
      }
    }
    return htHitTest(x, y, lineY, lineHeight, lineCount,
      spanX, spanWidth, lineSpanStart, lineSpanCount, spanTextStart, spanTextEnd);
  }

  /**
   * Get selection rectangles for a range within a layout result.
   */
  getSelectionRects(range: SelectionRange, layoutResult: LayoutResult): SelectionRect[] {
    const lines = layoutResult.lines;
    const lineCount = lines.length;
    const lineY = new Float64Array(lineCount);
    const lineHeight = new Float32Array(lineCount);
    const lineWidth = new Float32Array(lineCount);
    let totalSpans = 0;
    for (let i = 0; i < lineCount; i++) totalSpans += lines[i].spans.length;
    const spanX = new Float32Array(totalSpans);
    const spanWidth = new Float32Array(totalSpans);
    const lineSpanStart = new Uint32Array(lineCount);
    const lineSpanCount = new Uint16Array(lineCount);
    let si = 0;
    for (let i = 0; i < lineCount; i++) {
      const line = lines[i];
      lineY[i] = line.y;
      lineHeight[i] = line.height;
      lineWidth[i] = line.width;
      lineSpanStart[i] = si;
      lineSpanCount[i] = line.spans.length;
      for (const span of line.spans) {
        spanX[si] = span.x;
        spanWidth[si] = span.width;
        si++;
      }
    }
    const out = new Float32Array(lineCount * 4);
    const count = htGetSelectionRects(range, lineY, lineHeight, lineWidth,
      spanX, spanWidth, lineSpanStart, lineSpanCount, out);
    const rects: SelectionRect[] = [];
    for (let i = 0; i < count; i++) {
      const o = i << 2;
      rects.push({ x: out[o], y: out[o + 1], width: out[o + 2], height: out[o + 3] });
    }
    return rects;
  }

  /**
   * Configure font fallback chain for codepoint-to-font resolution.
   */
  setFallbackChain(entries: FontEntry[]): void {
    this.fallbackEntries = entries;
    buildFallbackChain(entries);
  }

  /**
   * Apply decorations to spans by index.
   */
  setDecorations(spanDecos: Array<{ spanIndex: number; spec: DecorationSpec }>): void {
    clearDecorations();
    this.spanDecorations.clear();
    for (const d of spanDecos) {
      setDecoration(d.spanIndex, d.spec);
      this.spanDecorations.set(d.spanIndex, d.spec);
    }
  }
}

export function createEngine(config: EngineConfig): ZeroEngine {
  return new ZeroEngine(config);
}
