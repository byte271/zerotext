import type { ScanResult } from "./scanner.js";
export type CharFrequencyMap = Map<number, number>;
export interface FontConfig { family: string; weights: number[]; display?: string; preload?: boolean }

/** Parse BE uint16/uint32/int16 from buffer. */
function parseUint16BE(buf: Uint8Array, o: number): number { return (buf[o] << 8) | buf[o + 1]; }
function parseUint32BE(buf: Uint8Array, o: number): number { return ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0; }
function parseInt16BE(buf: Uint8Array, o: number): number { const v = (buf[o] << 8) | buf[o + 1]; return v >= 0x8000 ? v - 0x10000 : v; }

/** Find table in OTF/TTF directory. */
function findTable(buf: Uint8Array, tag: string): { offset: number; length: number } | null {
  if (buf.length < 12) return null;
  const n = parseUint16BE(buf, 4);
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    if (r + 16 > buf.length) return null;
    if (buf[r] === tag.charCodeAt(0) && buf[r+1] === tag.charCodeAt(1) && buf[r+2] === tag.charCodeAt(2) && buf[r+3] === tag.charCodeAt(3))
      return { offset: parseUint32BE(buf, r + 8), length: parseUint32BE(buf, r + 12) };
  }
  return null;
}

/** Parse cmap format 4 subtable. */
function parseCmapFmt4(buf: Uint8Array, off: number, cps: Set<number>): Map<number, number> {
  const m = new Map<number, number>(), segCount = parseUint16BE(buf, off + 6) >> 1;
  const endOff = off + 14, startOff = endOff + segCount * 2 + 2;
  const deltaOff = startOff + segCount * 2, rangeOff = deltaOff + segCount * 2;
  for (const cp of cps) {
    if (cp > 0xFFFF) continue;
    for (let s = 0; s < segCount; s++) {
      if (cp < parseUint16BE(buf, startOff + s * 2) || cp > parseUint16BE(buf, endOff + s * 2)) continue;
      const delta = parseInt16BE(buf, deltaOff + s * 2), roff = parseUint16BE(buf, rangeOff + s * 2);
      let gid: number;
      if (roff === 0) gid = (cp + delta) & 0xFFFF;
      else { const addr = rangeOff + s * 2 + roff + (cp - parseUint16BE(buf, startOff + s * 2)) * 2; gid = parseUint16BE(buf, addr); if (gid) gid = (gid + delta) & 0xFFFF; }
      if (gid) m.set(cp, gid);
      break;
    }
  }
  return m;
}

/** Parse cmap format 12 subtable. */
function parseCmapFmt12(buf: Uint8Array, off: number, cps: Set<number>): Map<number, number> {
  const m = new Map<number, number>(), nG = parseUint32BE(buf, off + 12), base = off + 16;
  for (const cp of cps) {
    for (let g = 0; g < nG; g++) {
      const o = base + g * 12, s = parseUint32BE(buf, o), e = parseUint32BE(buf, o + 4);
      if (cp >= s && cp <= e) { m.set(cp, parseUint32BE(buf, o + 8) + cp - s); break; }
    }
  }
  return m;
}

const synth = (cp: number, s: number) => Math.round(((cp % 256) * 4 + 200) * s * 100) / 100;

/** Compute glyph widths from real TrueType/OpenType tables, synthetic fallback. */
export function computeGlyphWidths(fontBuffer: Uint8Array, codepoints: Set<number>, fontSize: number): Map<number, number> {
  const widths = new Map<number, number>();
  const head = findTable(fontBuffer, "head"), cmap = findTable(fontBuffer, "cmap");
  const hmtx = findTable(fontBuffer, "hmtx"), hhea = findTable(fontBuffer, "hhea");
  if (!head || !cmap || !hmtx || !hhea) { for (const cp of codepoints) widths.set(cp, synth(cp, fontSize / 1000)); return widths; }
  const scale = fontSize / (parseUint16BE(fontBuffer, head.offset + 18) || 1000);
  const numH = parseUint16BE(fontBuffer, hhea.offset + 34);
  const cmapOff = cmap.offset, numSub = parseUint16BE(fontBuffer, cmapOff + 2);
  let gm: Map<number, number> | null = null;
  for (let i = 0; i < numSub && !gm; i++) {
    const r = cmapOff + 4 + i * 8, subOff = cmapOff + parseUint32BE(fontBuffer, r + 4);
    const fmt = parseUint16BE(fontBuffer, subOff);
    if (fmt === 12) gm = parseCmapFmt12(fontBuffer, subOff, codepoints);
    else if (fmt === 4) gm = parseCmapFmt4(fontBuffer, subOff, codepoints);
  }
  if (!gm) gm = new Map();
  for (const cp of codepoints) {
    const gid = gm.get(cp);
    if (gid == null) { widths.set(cp, synth(cp, scale)); continue; }
    widths.set(cp, Math.round(parseUint16BE(fontBuffer, hmtx.offset + (gid < numH ? gid : numH - 1) * 4) * scale * 100) / 100);
  }
  return widths;
}

export class FontSubsetter {
  private config: FontConfig;
  constructor(config: FontConfig) { this.config = config; }
  getConfig(): FontConfig { return this.config; }
  analyzeFontUsage(scanResults: ScanResult[]): CharFrequencyMap {
    const freq: CharFrequencyMap = new Map();
    for (const result of scanResults) {
      for (const lit of result.strings) for (const ch of lit.value) { const cp = ch.codePointAt(0)!; freq.set(cp, (freq.get(cp) || 0) + 1); }
      for (const tpl of result.templates) for (const part of tpl.parts) for (const ch of part) { const cp = ch.codePointAt(0)!; freq.set(cp, (freq.get(cp) || 0) + 1); }
    }
    return freq;
  }
  subsetFont(fontBuffer: ArrayBuffer, chars: Set<number>): ArrayBuffer {
    const src = new Uint8Array(fontBuffer), arr = Array.from(chars).sort((a, b) => a - b);
    const hdrSz = 12, entrySz = 6, out = new ArrayBuffer(hdrSz + arr.length * entrySz);
    const dv = new DataView(out), bytes = new Uint8Array(out);
    bytes[0] = 0x5a; bytes[1] = 0x54; bytes[2] = 0x46; bytes[3] = 0x53;
    dv.setUint16(4, 1); dv.setUint16(6, arr.length); dv.setUint32(8, src.byteLength);
    let off = hdrSz;
    for (const cp of arr) { dv.setUint32(off, cp); dv.setUint16(off + 4, cp < src.byteLength ? src[cp] : 0); off += entrySz; }
    return out;
  }
}
