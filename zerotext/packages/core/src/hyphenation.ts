/** Minimal Liang-style hyphenation for English. Static buffers, zero runtime alloc. */

export const SOFT_HYPHEN = 0x00AD;
export const HYPHEN_MINUS = 0x002D;

const MAX_LEN = 16384;
/** Static result mask — 1 = valid hyphen point. */
const _mask = new Uint8Array(MAX_LEN);
/** Static buffer for insertSoftHyphens output. */
const _buf = new Uint32Array(MAX_LEN * 2);

/**
 * Common English hyphenation patterns: [prefix/infix, offset-from-start-of-pattern].
 * Each entry: codepoint sequence + array of break positions (1-indexed from pattern start).
 */
interface HyphenPattern { cp: number[]; breaks: number[] }

const P: HyphenPattern[] = [
  { cp: [116,105,111,110], breaks: [2] },       // ti-on
  { cp: [115,105,111,110], breaks: [2] },       // si-on
  { cp: [109,101,110,116], breaks: [3] },       // men-t
  { cp: [110,101,115,115], breaks: [2] },       // ne-ss
  { cp: [97,98,108,101], breaks: [2] },         // ab-le
  { cp: [105,98,108,101], breaks: [2] },        // ib-le
  { cp: [105,110,103], breaks: [0] },           // -ing
  { cp: [116,105,111,110,115], breaks: [2] },   // ti-ons
  { cp: [97,116,105,111,110], breaks: [1] },    // a-tion
  { cp: [101,110,116], breaks: [2] },           // en-t
  { cp: [105,116,121], breaks: [1] },           // i-ty
  { cp: [97,108,108,121], breaks: [2] },        // al-ly
  { cp: [111,117,115], breaks: [1] },           // o-us
  { cp: [105,118,101], breaks: [1] },           // i-ve
  { cp: [116,117,114,101], breaks: [2] },       // tu-re
  { cp: [97,116,101], breaks: [1] },            // a-te
  { cp: [105,99,97,108], breaks: [1] },         // i-cal
  { cp: [101,114], breaks: [1] },               // e-r (only in pattern ctx)
  { cp: [105,110,103,108,121], breaks: [3] },   // ing-ly
  { cp: [97,114,121], breaks: [1] },            // a-ry
  { cp: [111,114,121], breaks: [1] },           // o-ry
  { cp: [105,115,116], breaks: [1] },           // i-st
  { cp: [116,101,100], breaks: [2] },           // te-d
  { cp: [116,101,114], breaks: [2] },           // te-r
  { cp: [116,105,99], breaks: [2] },            // ti-c
  { cp: [109,97,110], breaks: [2] },            // ma-n
  { cp: [105,122,101], breaks: [1] },           // i-ze
  { cp: [105,115,101], breaks: [1] },           // i-se
  { cp: [101,115,116], breaks: [2] },           // es-t
  { cp: [97,110,116], breaks: [2] },            // an-t
];

/** Lowercase a codepoint (ASCII fast path). */
function lower(cp: number): number { return cp >= 65 && cp <= 90 ? cp + 32 : cp; }

/**
 * Find valid hyphenation points in a codepoint range.
 * Returns static Uint8Array mask; 1 at index i means a break is valid before position i.
 */
export function findHyphenPoints(codepoints: Uint32Array, start: number, end: number): Uint8Array {
  const len = end - start;
  _mask.fill(0, 0, len);

  for (let p = 0; p < P.length; p++) {
    const pat = P[p];
    const plen = pat.cp.length;
    if (plen > len) continue;
    // Slide pattern over word
    for (let i = 0; i <= len - plen; i++) {
      let match = true;
      for (let j = 0; j < plen; j++) {
        if (lower(codepoints[start + i + j]) !== pat.cp[j]) { match = false; break; }
      }
      if (match) {
        for (let b = 0; b < pat.breaks.length; b++) {
          const pos = i + pat.breaks[b];
          if (pos > 0 && pos < len) _mask[pos] = 1;
        }
      }
    }
  }
  return _mask;
}

/**
 * Insert SOFT_HYPHEN at valid break points. Returns new codepoints + length via static buffer.
 * Respects minLeft/minRight margins from word boundaries.
 */
export function insertSoftHyphens(
  codepoints: Uint32Array, len: number, minLeft: number, minRight: number,
): { codepoints: Uint32Array; len: number } {
  const mask = findHyphenPoints(codepoints, 0, len);
  let out = 0;
  for (let i = 0; i < len; i++) {
    if (mask[i] && i >= minLeft && (len - i) >= minRight) {
      _buf[out++] = SOFT_HYPHEN;
    }
    _buf[out++] = codepoints[i];
  }
  // Copy back into a view of _buf
  for (let i = 0; i < out; i++) codepoints[i] = _buf[i];
  return { codepoints, len: out };
}
