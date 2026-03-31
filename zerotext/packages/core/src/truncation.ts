/** Text truncation with ellipsis — O(log n) via binary search on prefix sums. */
/** @internal */
export const enum TruncateMode { None = 0, End = 1, Middle = 2, Start = 3 }
export const ELLIPSIS = 0x2026;
const _prefix = new Float64Array(16384);

/** Binary search: largest i in [lo,hi) where prefix[i] <= target. Returns lo-1 if none. */
function bsearch(prefix: Float64Array, lo: number, hi: number, target: number): number {
  let l = lo, r = hi - 1, res = lo - 1;
  while (l <= r) {
    const m = (l + r) >>> 1;
    if (prefix[m] <= target) { res = m; l = m + 1; } else r = m - 1;
  }
  return res;
}

function buildPrefix(glyphWidths: Float32Array, len: number): void {
  _prefix[0] = glyphWidths[0];
  for (let i = 1; i < len; i++) _prefix[i] = _prefix[i - 1] + glyphWidths[i];
}

/** Truncate a single line in-place. Returns new codepoint length. */
export function truncateLine(
  codepoints: Uint32Array, len: number, glyphWidths: Float32Array,
  maxWidth: number, mode: TruncateMode, ellipsisWidth: number,
): number {
  if (mode === TruncateMode.None || len === 0) return len;
  buildPrefix(glyphWidths, len);
  if (_prefix[len - 1] <= maxWidth) return len;

  const avail = maxWidth - ellipsisWidth;
  if (avail <= 0) { codepoints[0] = ELLIPSIS; return 1; }

  if (mode === TruncateMode.End) {
    const cut = bsearch(_prefix, 0, len, avail);
    const n = cut + 1;
    codepoints[n] = ELLIPSIS;
    return n + 1;
  }

  if (mode === TruncateMode.Start) {
    const totalW = _prefix[len - 1];
    const threshold = totalW - avail;
    let idx = 0;
    { let l = 0, r = len - 1;
      while (l <= r) { const m = (l + r) >>> 1; if (_prefix[m] < threshold) l = m + 1; else { idx = m; r = m - 1; } }
    }
    const kept = len - idx;
    codepoints[0] = ELLIPSIS;
    for (let i = 0; i < kept; i++) codepoints[1 + i] = codepoints[idx + i];
    return 1 + kept;
  }

  // Middle: half prefix + ellipsis + half suffix
  const half = avail * 0.5;
  const prefEnd = bsearch(_prefix, 0, len, half);
  const prefN = prefEnd + 1;
  const totalW = _prefix[len - 1];
  const threshold = totalW - half;
  let sufStart = len;
  { let l = 0, r = len - 1;
    while (l <= r) { const m = (l + r) >>> 1; if (_prefix[m] < threshold) l = m + 1; else { sufStart = m; r = m - 1; } }
  }
  const sufN = len - sufStart;
  codepoints[prefN] = ELLIPSIS;
  for (let i = 0; i < sufN; i++) codepoints[prefN + 1 + i] = codepoints[sufStart + i];
  return prefN + 1 + sufN;
}

/** Truncate layout to maxLines, adding ellipsis on the last visible line. Returns new total length. */
export function truncateLayout(
  lines: number, maxLines: number, codepoints: Uint32Array, len: number,
  glyphWidths: Float32Array, lineWidth: number, ellipsisWidth: number,
): number {
  if (lines <= maxLines || maxLines <= 0) return len;
  return truncateLine(codepoints, len, glyphWidths, lineWidth, TruncateMode.End, ellipsisWidth);
}
