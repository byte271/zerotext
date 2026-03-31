/** Hit testing, caret positioning, and selection rect computation — zero allocations. */

/** Caret position result. */
export interface CaretPosition { line: number; offset: number; x: number; y: number; height: number; trailing: boolean }
/** Logical selection range. */
export interface SelectionRange { startLine: number; startOffset: number; endLine: number; endOffset: number }
/** Visual selection rectangle. */
export interface SelectionRect { x: number; y: number; width: number; height: number }

const _caret: CaretPosition = { line: 0, offset: 0, x: 0, y: 0, height: 0, trailing: false };

/** Binary search for line containing y. */
function findLine(y: number, lineY: Float64Array, lineHeight: Float32Array, count: number): number {
  let lo = 0, hi = count - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (y < lineY[mid]) hi = mid - 1;
    else if (y >= lineY[mid] + lineHeight[mid]) lo = mid + 1;
    else return mid;
  }
  return lo < count ? lo : count - 1;
}

/** Hit test a point. Binary search lines, linear scan spans, interpolate offset. */
export function hitTest(
  x: number, y: number, lineY: Float64Array, lineHeight: Float32Array, lineCount: number,
  spanX: Float32Array, spanWidth: Float32Array, lineSpanStart: Uint32Array, lineSpanCount: Uint16Array,
  spanTextStart: Uint32Array, spanTextEnd: Uint32Array
): CaretPosition {
  if (lineCount === 0) { _caret.line = _caret.offset = 0; _caret.x = _caret.y = _caret.height = 0; _caret.trailing = false; return _caret; }
  const li = findLine(y, lineY, lineHeight, lineCount);
  const start = lineSpanStart[li], cnt = lineSpanCount[li], end = start + cnt;
  _caret.line = li; _caret.y = lineY[li] as number; _caret.height = lineHeight[li];
  let si = start;
  for (; si < end; si++) if (x < spanX[si] + spanWidth[si]) break;
  if (si >= end) si = end - 1;
  const sS = spanTextStart[si], cc = spanTextEnd[si] - sS;
  if (cc <= 0) { _caret.offset = sS; _caret.x = spanX[si]; _caret.trailing = false; }
  else {
    const rel = x - spanX[si], gw = spanWidth[si] / cc;
    let idx = (rel / gw) | 0;
    if (idx < 0) idx = 0; if (idx >= cc) idx = cc - 1;
    const tr = (rel - idx * gw) > gw * 0.5;
    _caret.offset = sS + idx + (tr ? 1 : 0);
    _caret.x = spanX[si] + _caret.offset * gw - sS * gw; _caret.trailing = tr;
  }
  return _caret;
}

/** Get caret rect for a given line and text offset. */
export function getCaretRect(
  line: number, offset: number, lineY: Float64Array, lineHeight: Float32Array,
  spanX: Float32Array, spanWidth: Float32Array, lineSpanStart: Uint32Array, lineSpanCount: Uint16Array,
  spanTextStart: Uint32Array, spanTextEnd: Uint32Array
): CaretPosition {
  _caret.line = line; _caret.y = lineY[line] as number; _caret.height = lineHeight[line]; _caret.trailing = false;
  const start = lineSpanStart[line], end = start + lineSpanCount[line];
  for (let si = start; si < end; si++) {
    const sS = spanTextStart[si], sE = spanTextEnd[si];
    if (offset >= sS && offset <= sE) {
      const cc = sE - sS, gw = cc > 0 ? spanWidth[si] / cc : 0;
      _caret.x = spanX[si] + (offset - sS) * gw; _caret.offset = offset; return _caret;
    }
  }
  const last = end - 1;
  _caret.x = spanX[last] + spanWidth[last]; _caret.offset = offset; return _caret;
}

/** Compute selection highlight rects as [x, y, w, h] quads. Returns rect count. */
export function getSelectionRects(
  sel: SelectionRange, lineY: Float64Array, lineHeight: Float32Array, lineWidth: Float32Array,
  spanX: Float32Array, spanWidth: Float32Array,
  lineSpanStart: Uint32Array, lineSpanCount: Uint16Array, out: Float32Array
): number {
  let n = 0;
  for (let li = sel.startLine; li <= sel.endLine; li++) {
    const start = lineSpanStart[li], cnt = lineSpanCount[li];
    if (cnt === 0) continue;
    const first = start, last = start + cnt - 1;
    let x0 = spanX[first], x1 = spanX[last] + spanWidth[last];
    if (li === sel.startLine && sel.startOffset > 0)
      x0 = spanX[first] + spanWidth[first] * (sel.startOffset / Math.max(1, cnt));
    if (li === sel.endLine)
      for (let si = first; si <= last; si++) x1 = spanX[si] + spanWidth[si];
    const o = n << 2;
    out[o] = x0; out[o + 1] = lineY[li] as number; out[o + 2] = x1 - x0; out[o + 3] = lineHeight[li]; n++;
  }
  return n;
}
