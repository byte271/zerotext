import { solveLayout, LayoutResult, Line } from "./layout.js";
import { createGlyphTable, GlyphEntry, getWidth, PerfectHashTable, warmAsciiCache } from "./hash.js";
import { PreparedText } from "./engine.js";

/**
 * Convert a JS string to a Uint32Array of codepoints.
 * Handles surrogate pairs correctly.
 */
export function toCodePoints(text: string): Uint32Array {
  const points: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i)!;
    points.push(code);
    if (code > 0xffff) i++; // skip surrogate pair
  }
  return new Uint32Array(points);
}

// ── Proportional width tables ──
// Based on measured Inter/Helvetica/Arial averages at 1em = 16px.
// Scaled by fontSize/16. Much more accurate than flat-width for real text.

const CHAR_CLASS_NARROW   = 4.5;  // i l | ! : ; , . ' 1
const CHAR_CLASS_MEDIUM   = 7.5;  // a-z most lowercase
const CHAR_CLASS_WIDE     = 9.0;  // A-Z most uppercase, m w
const CHAR_CLASS_XWIDE    = 10.5; // M W @
const CHAR_CLASS_SPACE    = 4.0;  // space
const CHAR_CLASS_DIGIT    = 7.5;  // 0-9 (tabular-width)
const CHAR_CLASS_PUNCT    = 4.5;  // common punctuation
const CHAR_CLASS_CJK      = 16.0; // fullwidth CJK characters
const CHAR_CLASS_EMOJI    = 16.0; // emoji
const CHAR_CLASS_DEFAULT  = 7.5;  // fallback

// Narrow Latin lowercase
const NARROW_CHARS = new Set<number>([
  0x69, 0x6C, 0x7C, 0x21, 0x3A, 0x3B, 0x2C, 0x2E, 0x27, 0x60, // i l | ! : ; , . ' `
  0x31, // 1
]);

// Wide Latin uppercase
const XWIDE_CHARS = new Set<number>([
  0x4D, 0x57, 0x40, // M W @
]);

const WIDE_LOWER = new Set<number>([
  0x6D, 0x77, // m w
]);

function classifyWidth(cp: number): number {
  // Space
  if (cp === 0x0020) return CHAR_CLASS_SPACE;
  // Tab — handled separately in layout, but give it a default
  if (cp === 0x0009) return CHAR_CLASS_SPACE * 8;
  // Newlines — zero width
  if (cp === 0x000A || cp === 0x000D) return 0;
  // Narrow characters
  if (NARROW_CHARS.has(cp)) return CHAR_CLASS_NARROW;
  // Extra-wide characters
  if (XWIDE_CHARS.has(cp)) return CHAR_CLASS_XWIDE;
  // Wide lowercase
  if (WIDE_LOWER.has(cp)) return CHAR_CLASS_WIDE;
  // Digits
  if (cp >= 0x0030 && cp <= 0x0039) return CHAR_CLASS_DIGIT;
  // Uppercase Latin
  if (cp >= 0x0041 && cp <= 0x005A) return CHAR_CLASS_WIDE;
  // Lowercase Latin
  if (cp >= 0x0061 && cp <= 0x007A) return CHAR_CLASS_MEDIUM;
  // Extended Latin
  if (cp >= 0x00C0 && cp <= 0x024F) return CHAR_CLASS_MEDIUM;
  // CJK Unified Ideographs
  if (cp >= 0x4E00 && cp <= 0x9FFF) return CHAR_CLASS_CJK;
  // CJK Ext A
  if (cp >= 0x3400 && cp <= 0x4DBF) return CHAR_CLASS_CJK;
  // Hiragana + Katakana
  if (cp >= 0x3040 && cp <= 0x30FF) return CHAR_CLASS_CJK;
  // Fullwidth forms
  if (cp >= 0xFF01 && cp <= 0xFF60) return CHAR_CLASS_CJK;
  // Hangul
  if (cp >= 0xAC00 && cp <= 0xD7A3) return CHAR_CLASS_CJK;
  // Emoji (SMP)
  if (cp >= 0x1F000 && cp <= 0x1FAFF) return CHAR_CLASS_EMOJI;
  // Common punctuation
  if ((cp >= 0x0021 && cp <= 0x002F) || (cp >= 0x003A && cp <= 0x0040) ||
      (cp >= 0x005B && cp <= 0x0060) || (cp >= 0x007B && cp <= 0x007E)) {
    return CHAR_CLASS_PUNCT;
  }
  return CHAR_CLASS_DEFAULT;
}

export interface TextOptions {
  /** Font size in pixels (default: 16) */
  fontSize?: number;
  /** Line height in pixels (default: fontSize * 1.5) */
  lineHeight?: number;
  /** Tab size in pixels (default: fontSize * 2) */
  tabSize?: number;
  /** Collapse consecutive whitespace (default: true) */
  collapseWhitespace?: boolean;
}

export interface LayoutMetrics {
  width: number;
  height: number;
  lines: { width: number; height: number; text: string; y: number }[];
  lineCount: number;
}

/**
 * One-call layout: pass a string and options, get laid-out lines back.
 * Uses proportional character width estimation — no font file or glyph
 * table setup required.
 *
 * @param text  The text to lay out
 * @param width Container width in pixels
 * @param opts  Optional text options (fontSize, lineHeight, etc.)
 */
export function layoutText(
  text: string,
  width: number,
  opts?: TextOptions,
): LayoutMetrics {
  const fontSize = opts?.fontSize ?? 16;
  const scale = fontSize / 16;
  const lineHeight = opts?.lineHeight ?? Math.round(fontSize * 1.5);
  const tabSize = opts?.tabSize ?? Math.round(fontSize * 2);
  const collapse = opts?.collapseWhitespace ?? true;

  const codepoints = toCodePoints(text);
  const entries: GlyphEntry[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < codepoints.length; i++) {
    const cp = codepoints[i];
    if (!seen.has(cp)) {
      seen.add(cp);
      entries.push({ codepoint: cp, fontId: 0, width: classifyWidth(cp) * scale });
    }
  }
  const glyphTable = createGlyphTable(entries);
  warmAsciiCache(glyphTable);

  const result = solveLayout({
    glyphTable,
    text: codepoints,
    width,
    lineHeight,
    tabSize,
    collapseWhitespace: collapse,
  });

  const lines = result.lines.map((line: Line) => {
    let lineText = "";
    for (const span of line.spans) {
      for (let i = span.textStart; i < span.textEnd; i++) {
        lineText += String.fromCodePoint(codepoints[i]);
      }
    }
    return {
      width: line.width,
      height: line.height,
      y: line.y,
      text: lineText,
    };
  });

  return {
    width: result.width,
    height: result.height,
    lines,
    lineCount: lines.length,
  };
}

/**
 * Measure the natural (unwrapped) width of a text string.
 *
 * @param text     The text to measure
 * @param opts     Optional text options (fontSize)
 * @returns Width in pixels
 */
export function measure(
  text: string,
  opts?: TextOptions | { font: string },
): number {
  const fontSize = (opts && 'fontSize' in opts ? opts.fontSize : undefined) ?? 16;
  const scale = fontSize / 16;
  const codepoints = toCodePoints(text);
  let totalWidth = 0;
  for (let i = 0; i < codepoints.length; i++) {
    totalWidth += classifyWidth(codepoints[i]) * scale;
  }
  return totalWidth;
}

/**
 * Prepare text with proportional widths for use with the engine's
 * low-level API. Returns a PreparedText compatible with ZeroEngine.update().
 */
export function prepare(
  text: string,
  options?: { font?: string; fontSize?: number; lineHeight?: number },
): PreparedText {
  const fontSize = options?.fontSize ?? 16;
  const scale = fontSize / 16;
  const codepoints = toCodePoints(text);
  const entries: GlyphEntry[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < codepoints.length; i++) {
    const cp = codepoints[i];
    if (!seen.has(cp)) {
      seen.add(cp);
      entries.push({ codepoint: cp, fontId: 0, width: classifyWidth(cp) * scale });
    }
  }
  const glyphTable = createGlyphTable(entries);
  warmAsciiCache(glyphTable);

  // Numeric FNV-1a hash of first 64 codepoints
  let h = 0x811c9dc5;
  const end = Math.min(codepoints.length, 64);
  for (let i = 0; i < end; i++) {
    const cp = codepoints[i];
    h ^= (cp & 0xff); h = Math.imul(h, 0x01000193);
    h ^= ((cp >>> 8) & 0xff); h = Math.imul(h, 0x01000193);
  }
  h ^= (codepoints.length & 0xff); h = Math.imul(h, 0x01000193);
  return { codepoints, glyphTable, cacheKey: h >>> 0 };
}

/**
 * Legacy compat: layout a PreparedText at a given width.
 */
export function layout(prepared: PreparedText, width: number): LayoutMetrics {
  const result = solveLayout({
    glyphTable: prepared.glyphTable,
    text: prepared.codepoints,
    width,
  });

  const lines = result.lines.map((line: Line) => {
    let lineText = "";
    for (const span of line.spans) {
      for (let i = span.textStart; i < span.textEnd; i++) {
        lineText += String.fromCodePoint(prepared.codepoints[i]);
      }
    }
    return {
      width: line.width,
      height: line.height,
      y: line.y,
      text: lineText,
    };
  });

  return {
    width: result.width,
    height: result.height,
    lines,
    lineCount: lines.length,
  };
}
