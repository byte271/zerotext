/** Font fallback chain with compact interval lookup. */

export interface FontEntry { id: number; name: string; rangeStart: number; rangeEnd: number; priority: number }
export interface FallbackChain { entries: FontEntry[]; defaultId: number }

// Flat interval arrays sorted by rangeStart for binary search
const _fontRangeStart = new Uint32Array(256);
const _fontRangeEnd = new Uint32Array(256);
const _fontRangeId = new Uint8Array(256);
const _fontRangePriority = new Uint8Array(256);
let _fontRangeCount = 0;

/** Pre-allocated batch output buffer. */
export const _fontIds = new Uint8Array(16384);

/** Build fallback chain: sort by priority, fill flat arrays. */
export function buildFallbackChain(entries: FontEntry[]): void {
  const sorted = entries.slice().sort((a, b) => a.priority - b.priority || a.rangeStart - b.rangeStart);
  _fontRangeCount = sorted.length;
  for (let i = 0; i < sorted.length; i++) {
    _fontRangeStart[i] = sorted[i].rangeStart;
    _fontRangeEnd[i] = sorted[i].rangeEnd;
    _fontRangeId[i] = sorted[i].id;
    _fontRangePriority[i] = sorted[i].priority;
  }
}

/** Binary search sorted ranges for codepoint, returns fontId or 0. */
export function resolveFontId(cp: number): number {
  let lo = 0, hi = _fontRangeCount - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (cp < _fontRangeStart[mid]) hi = mid - 1;
    else if (cp > _fontRangeEnd[mid]) lo = mid + 1;
    else return _fontRangeId[mid];
  }
  return 0;
}

/** Batch resolve codepoints to fontIds. */
export function resolveFontIds(codepoints: Uint32Array, len: number, out: Uint8Array): void {
  for (let i = 0; i < len; i++) out[i] = resolveFontId(codepoints[i]);
}

/** Split into contiguous runs of same fontId. Returns run count. */
export function splitRunsByFont(
  fontIds: Uint8Array, len: number, starts: Uint32Array, ends: Uint32Array
): number {
  if (len === 0) return 0;
  let count = 0, runStart = 0;
  let cur = fontIds[0];
  for (let i = 1; i < len; i++) {
    if (fontIds[i] !== cur) {
      starts[count] = runStart;
      ends[count++] = i;
      runStart = i;
      cur = fontIds[i];
    }
  }
  starts[count] = runStart;
  ends[count++] = len;
  return count;
}
