/** Text decoration metadata — bitflag-composable, SoA layout parallel to spans. */

/** @internal Decoration flags (bitflags). */
export const enum Decoration { None = 0, Underline = 1, Strikethrough = 2, Overline = 4 }

/** @internal Decoration line style. */
export const enum DecorationStyle { Solid = 0, Dashed = 1, Dotted = 2, Wavy = 3, Double = 4 }

/** Packed decoration spec for a span. */
export interface DecorationSpec { decoration: Decoration; style: DecorationStyle; thickness: number; color: number }

// SoA buffers parallel to span indices
const _decoFlags = new Uint8Array(4096);
const _decoStyle = new Uint8Array(4096);
const _decoThickness = new Float32Array(4096);
const _decoColor = new Uint32Array(4096);

/** Set decoration for span at `spanIndex`. */
export function setDecoration(spanIndex: number, spec: DecorationSpec): void {
  _decoFlags[spanIndex] = spec.decoration;
  _decoStyle[spanIndex] = spec.style;
  _decoThickness[spanIndex] = spec.thickness;
  _decoColor[spanIndex] = spec.color;
}

/** Read decoration for span at `spanIndex`. */
export function getDecoration(spanIndex: number): DecorationSpec {
  return { decoration: _decoFlags[spanIndex], style: _decoStyle[spanIndex], thickness: _decoThickness[spanIndex], color: _decoColor[spanIndex] };
}

/** Zero all decoration arrays. */
export function clearDecorations(): void {
  _decoFlags.fill(0); _decoStyle.fill(0); _decoThickness.fill(0); _decoColor.fill(0);
}

/** Bitwise test for a decoration flag on a span. */
export function hasDecoration(spanIndex: number, flag: Decoration): boolean {
  return (_decoFlags[spanIndex] & flag) !== 0;
}

/**
 * Compute decoration geometry rects. Writes [x, y, width, thickness] quads into `out`.
 * @returns Number of decoration rects written.
 */
export function computeDecorationRects(
  spanX: Float32Array, spanWidth: Float32Array,
  lineY: Float64Array, lineHeight: Float32Array,
  lineSpanStart: Uint32Array, lineSpanCount: Uint16Array,
  lineCount: number, out: Float32Array
): number {
  let n = 0;
  for (let li = 0; li < lineCount; li++) {
    const start = lineSpanStart[li], count = lineSpanCount[li];
    const ly = lineY[li], lh = lineHeight[li];
    for (let si = start, end = start + count; si < end; si++) {
      const flags = _decoFlags[si];
      if (flags === 0) continue;
      const sx = spanX[si], sw = spanWidth[si], th = _decoThickness[si];
      if (flags & Decoration.Underline) {
        const o = n << 2; out[o] = sx; out[o + 1] = ly + lh * 0.85; out[o + 2] = sw; out[o + 3] = th; n++;
      }
      if (flags & Decoration.Strikethrough) {
        const o = n << 2; out[o] = sx; out[o + 1] = ly + lh * 0.5; out[o + 2] = sw; out[o + 3] = th; n++;
      }
      if (flags & Decoration.Overline) {
        const o = n << 2; out[o] = sx; out[o + 1] = ly + lh * 0.1; out[o + 2] = sw; out[o + 3] = th; n++;
      }
    }
  }
  return n;
}
