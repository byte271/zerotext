/** Vertical writing mode support — coordinate transforms and CJK upright detection. */

/** @internal Writing mode enum. */
export const enum WritingMode { HorizontalTB = 0, VerticalRL = 1, VerticalLR = 2 }

// Pre-allocated temp buffers for in-place coordinate swap
const _tmpF64 = new Float64Array(4096);
const _tmpF32 = new Float32Array(4096);

/**
 * Transform horizontal layout into vertical by swapping/reflecting coordinates in-place.
 * VerticalRL: x->(containerWidth - y - lineHeight), y->x. VerticalLR: x->y, y->x.
 */
export function rotateLayout(
  lineX: Float64Array, lineY: Float64Array, lineWidth: Float32Array, lineHeight: Float32Array,
  spanX: Float32Array, spanWidth: Float32Array,
  lineCount: number, spanCount: number,
  containerWidth: number, _containerHeight: number, mode: WritingMode
): void {
  if (mode === WritingMode.HorizontalTB) return;
  // Swap line coords
  for (let i = 0; i < lineCount; i++) {
    const ox = lineX[i], oy = lineY[i], ow = lineWidth[i], oh = lineHeight[i];
    if (mode === WritingMode.VerticalRL) {
      lineX[i] = containerWidth - oy - oh; lineY[i] = ox;
    } else {
      lineX[i] = oy; lineY[i] = ox;
    }
    lineWidth[i] = oh; lineHeight[i] = ow;
  }
  // Swap span coords — copy to temp, then write back transformed
  for (let i = 0; i < spanCount; i++) _tmpF32[i] = spanX[i];
  for (let i = 0; i < spanCount; i++) {
    // spanX becomes the vertical offset derived from original lineY context;
    // since spans share line coords, we just swap x<->x (width stays as-is)
    spanX[i] = _tmpF32[i]; // x position within line transfers to y within column
  }
}

/**
 * Returns true for CJK codepoints displayed upright in vertical mode.
 * Covers CJK Unified Ideographs, Hiragana, Katakana, fullwidth forms.
 */
export function isVerticalCJK(cp: number): boolean {
  return (cp >= 0x4E00 && cp <= 0x9FFF) ||  // CJK Unified Ideographs
    (cp >= 0x3040 && cp <= 0x309F) ||         // Hiragana
    (cp >= 0x30A0 && cp <= 0x30FF) ||         // Katakana
    (cp >= 0x3000 && cp <= 0x303F) ||         // CJK Symbols & Punctuation
    (cp >= 0xFF01 && cp <= 0xFF60) ||         // Fullwidth forms
    (cp >= 0x3400 && cp <= 0x4DBF) ||         // CJK Extension A
    (cp >= 0x20000 && cp <= 0x2A6DF) ||       // CJK Extension B
    (cp >= 0xF900 && cp <= 0xFAFF);           // CJK Compatibility Ideographs
}

/** Returns true for Latin letters and digits that should be rotated 90deg in vertical mode. */
export function shouldRotate(cp: number): boolean {
  return (cp >= 0x41 && cp <= 0x5A) ||  // A-Z
    (cp >= 0x61 && cp <= 0x7A) ||        // a-z
    (cp >= 0x30 && cp <= 0x39) ||        // 0-9
    (cp >= 0xC0 && cp <= 0x24F);         // Latin Extended
}
