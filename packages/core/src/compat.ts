import { solveLayout, LayoutResult, Line } from "./layout.js";
import { createGlyphTable, GlyphEntry, getWidth, PerfectHashTable } from "./hash.js";
import { PreparedText } from "./engine.js";

function toCodePoints(text: string): Uint32Array {
  const points: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i)!;
    points.push(code);
    if (code > 0xffff) i++; // skip surrogate pair
  }
  return new Uint32Array(points);
}

export interface LayoutMetrics {
  width: number;
  height: number;
  lines: { width: number; height: number; text: string }[];
}

export function prepare(
  text: string,
  options: { font: string; lineHeight?: number }
): PreparedText {
  const codepoints = toCodePoints(text);
  const entries: GlyphEntry[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < codepoints.length; i++) {
    if (!seen.has(codepoints[i])) {
      seen.add(codepoints[i]);
      entries.push({ codepoint: codepoints[i], fontId: 0, width: 8 });
    }
  }
  const glyphTable = createGlyphTable(entries);
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

export function layout(prepared: PreparedText, width: number): LayoutMetrics {
  const result = solveLayout({
    glyphTable: prepared.glyphTable,
    text: prepared.codepoints,
    width
  });

  const lines = result.lines.map((line: Line) => {
    let text = "";
    for (let i = line.spans[0].textStart; i < line.spans[0].textEnd; i++) {
      text += String.fromCodePoint(prepared.codepoints[i]);
    }
    return {
      width: line.width,
      height: line.height,
      text
    };
  });

  return {
    width: result.width,
    height: result.height,
    lines
  };
}

export function measure(
  text: string,
  options: { font: string }
): number {
  const prepared = prepare(text, { font: options.font });
  let totalWidth = 0;
  for (let i = 0; i < prepared.codepoints.length; i++) {
    totalWidth += getWidth(prepared.glyphTable, prepared.codepoints[i], 0);
  }
  return totalWidth;
}
