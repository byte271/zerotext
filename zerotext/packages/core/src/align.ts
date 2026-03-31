/** Text alignment — in-place mutations of spanX, zero allocations. */

/** @internal */
export const enum TextAlign { Left = 0, Center = 1, Right = 2, Justify = 3 }

/** Align a single line's spans within containerWidth. */
export function alignLine(
  spanX: Float32Array, spanWidth: Float32Array,
  spanStart: number, spanCount: number,
  lineWidth: number, containerWidth: number,
  align: TextAlign, isLastLine: boolean,
): void {
  if (spanCount === 0 || align === TextAlign.Left) return;
  const extra = containerWidth - lineWidth;
  if (extra <= 0) return;

  if (align === TextAlign.Center || align === TextAlign.Right) {
    const shift = align === TextAlign.Center ? extra * 0.5 : extra;
    for (let i = spanStart, e = spanStart + spanCount; i < e; i++) spanX[i] += shift;
    return;
  }

  // Justify — last line falls back to left
  if (isLastLine || spanCount < 2) return;
  // Compute total span width sum
  let totalW = 0;
  for (let i = spanStart, e = spanStart + spanCount; i < e; i++) totalW += spanWidth[i];
  const gap = (containerWidth - totalW) / (spanCount - 1);
  let x = 0;
  for (let i = spanStart, e = spanStart + spanCount; i < e; i++) {
    spanX[i] = x;
    x += spanWidth[i] + gap;
  }
}

/** Batch-align all lines in a layout result. */
export function alignLayout(
  lineSpanStart: Uint32Array, lineSpanCount: Uint16Array, lineWidth: Float32Array,
  lineCount: number, spanX: Float32Array, spanWidth: Float32Array,
  containerWidth: number, align: TextAlign, lastLineIndex: number,
): void {
  for (let i = 0; i < lineCount; i++) {
    alignLine(
      spanX, spanWidth, lineSpanStart[i], lineSpanCount[i],
      lineWidth[i], containerWidth, align, i === lastLineIndex,
    );
  }
}
