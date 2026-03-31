/** Inline element support for images, widgets, rules in text stream. */

export const enum InlineType { None = 0, Image = 1, Widget = 2, Rule = 3 }

export interface InlineBox { type: InlineType; width: number; height: number; baseline: number; id: number }

/** Sentinel codepoint marking inline object positions. */
export const OBJECT_REPLACEMENT = 0xFFFC;

// SoA storage parallel to codepoint stream
const _inlineType = new Uint8Array(1024);
const _inlineWidth = new Float32Array(1024);
const _inlineHeight = new Float32Array(1024);
const _inlineBaseline = new Float32Array(1024);
const _inlineId = new Uint32Array(1024);
let _inlineCount = 0;

/** Add an inline box, returns its index. */
export function addInline(box: InlineBox): number {
  const i = _inlineCount++;
  _inlineType[i] = box.type;
  _inlineWidth[i] = box.width;
  _inlineHeight[i] = box.height;
  _inlineBaseline[i] = box.baseline;
  _inlineId[i] = box.id;
  return i;
}

/** Retrieve inline box at index. */
export function getInline(index: number): InlineBox {
  return {
    type: _inlineType[index] as InlineType,
    width: _inlineWidth[index],
    height: _inlineHeight[index],
    baseline: _inlineBaseline[index],
    id: _inlineId[index],
  };
}

/** Reset all inline storage. */
export function clearInlines(): void { _inlineCount = 0; }

/** Check if codepoint is an inline object marker. */
export function isInlineMarker(cp: number): boolean { return cp === 0xFFFC; }

/** Return inline width if cp is FFFC, else 0. */
export function resolveInlineWidth(cp: number, inlineIndex: number): number {
  return cp === 0xFFFC ? _inlineWidth[inlineIndex] : 0;
}

/** Adjust line height for baseline alignment with inline element. */
export function adjustLineHeight(currentHeight: number, inlineIndex: number): number {
  return currentHeight > _inlineHeight[inlineIndex] ? currentHeight : _inlineHeight[inlineIndex];
}
