/**
 * Minimal UAX#9 Bidi algorithm — zero-alloc after init.
 * Uses compact DFA/lookup with 4-bit bidi types and pre-allocated buffers.
 */

const MAX_LEN = 16384;

/** UAX#9 bidi character types (4-bit) */
export const enum BidiType {
  L = 0, R = 1, AL = 2, EN = 3, ES = 4, ET = 5, AN = 6, CS = 7,
  NSM = 8, BN = 9, B = 10, S = 11, WS = 12, ON = 13,
  LRE = 14, LRO = 15, RLE = 16, RLO = 17, PDF = 18,
  LRI = 19, RLI = 20, FSI = 21, PDI = 22,
}

/* --- Pre-allocated static buffers --- */
const _types = new Uint8Array(MAX_LEN);
const _levels = new Uint8Array(MAX_LEN);
const _stack = new Uint8Array(256);   // embedding level stack
const _stackO = new Uint8Array(256);  // override status stack (0=neutral,1=L,2=R)
const _stackI = new Uint8Array(256);  // isolate status stack

/** Resolve bidi type from codepoint via range checks. */
export function getBidiType(cp: number): BidiType {
  if (cp <= 0x7F) {
    if (cp >= 0x30 && cp <= 0x39) return BidiType.EN;
    if (cp === 0x0A || cp === 0x0D || cp === 0x1C || cp === 0x1D || cp === 0x1E || cp === 0x1F || cp === 0x85) return BidiType.B;
    if (cp === 0x09 || cp === 0x0B || cp === 0x1F) return BidiType.S;
    if (cp === 0x20) return BidiType.WS;
    if (cp >= 0x41 && cp <= 0x5A) return BidiType.L;
    if (cp >= 0x61 && cp <= 0x7A) return BidiType.L;
    if (cp === 0x2B || cp === 0x2D) return BidiType.ES;
    if (cp === 0x23 || cp === 0x24 || cp === 0x25) return BidiType.ET;
    if (cp === 0x2C || cp === 0x2E || cp === 0x2F || cp === 0x3A) return BidiType.CS;
    return BidiType.ON;
  }
  // Explicit directional formatting
  if (cp === 0x202A) return BidiType.LRE;
  if (cp === 0x202B) return BidiType.RLE;
  if (cp === 0x202C) return BidiType.PDF;
  if (cp === 0x202D) return BidiType.LRO;
  if (cp === 0x202E) return BidiType.RLO;
  if (cp === 0x2066) return BidiType.LRI;
  if (cp === 0x2067) return BidiType.RLI;
  if (cp === 0x2068) return BidiType.FSI;
  if (cp === 0x2069) return BidiType.PDI;
  // Hebrew → R
  if (cp >= 0x0590 && cp <= 0x05FF) return BidiType.R;
  if (cp >= 0xFB1D && cp <= 0xFB4F) return BidiType.R;
  // Arabic → AL
  if (cp >= 0x0600 && cp <= 0x06FF) return BidiType.AL;
  if (cp >= 0x0750 && cp <= 0x077F) return BidiType.AL;
  if (cp >= 0x0870 && cp <= 0x089F) return BidiType.AL;
  if (cp >= 0x08A0 && cp <= 0x08FF) return BidiType.AL;
  if (cp >= 0xFB50 && cp <= 0xFDFF) return BidiType.AL;
  if (cp >= 0xFE70 && cp <= 0xFEFF) return BidiType.AL;
  // European digits & related
  if (cp >= 0x0030 && cp <= 0x0039) return BidiType.EN;
  if (cp >= 0x00B2 && cp <= 0x00B3) return BidiType.EN;
  if (cp >= 0x2070 && cp <= 0x2089) return BidiType.EN;
  // Arabic-Indic digits → AN
  if (cp >= 0x0660 && cp <= 0x0669) return BidiType.AN;
  if (cp >= 0x06F0 && cp <= 0x06F9) return BidiType.AN;
  // Whitespace
  if (cp === 0x00A0 || cp === 0x2000 || (cp >= 0x2000 && cp <= 0x200A) || cp === 0x202F || cp === 0x205F || cp === 0x3000) return BidiType.WS;
  // NSM (combining marks rough ranges)
  if (cp >= 0x0300 && cp <= 0x036F) return BidiType.NSM;
  if (cp >= 0x0591 && cp <= 0x05BD) return BidiType.NSM;
  if (cp >= 0x0610 && cp <= 0x061A) return BidiType.NSM;
  if (cp >= 0x064B && cp <= 0x065F) return BidiType.NSM;
  // BN (formatting chars)
  if (cp >= 0x200B && cp <= 0x200F) return BidiType.BN;
  if (cp >= 0x2060 && cp <= 0x2064) return BidiType.BN;
  if (cp === 0xFEFF) return BidiType.BN;
  // Latin extended, CJK, etc → L
  if (cp >= 0x00C0 && cp <= 0x024F) return BidiType.L;
  if (cp >= 0x0400 && cp <= 0x04FF) return BidiType.L;
  if (cp >= 0x1100 && cp <= 0x11FF) return BidiType.L;
  if (cp >= 0x2E80 && cp <= 0x9FFF) return BidiType.L;
  if (cp >= 0xAC00 && cp <= 0xD7AF) return BidiType.L;
  if (cp >= 0xF900 && cp <= 0xFAFF) return BidiType.L;
  if (cp >= 0x10000 && cp <= 0x1FFFF) return BidiType.L;
  if (cp >= 0x20000 && cp <= 0x2FA1F) return BidiType.L;
  return BidiType.ON;
}

/** Resolve embedding levels per UAX#9 (W1-W7, N1-N2). */
export function resolveLevels(codepoints: Uint32Array, len: number, baseLevel?: number): Uint8Array {
  if (len > MAX_LEN) len = MAX_LEN;
  const base = baseLevel ?? 0;
  // P2/P3: populate types
  for (let i = 0; i < len; i++) _types[i] = getBidiType(codepoints[i]) as number;
  // Init levels
  _levels.fill(base, 0, len);

  // X1-X8: explicit embeddings (simplified)
  let sp = 0;
  let curLevel = base;
  _stack[0] = base; _stackO[0] = 0; _stackI[0] = 0; sp = 1;
  for (let i = 0; i < len; i++) {
    const t = _types[i];
    if (t >= 14 && t <= 22) { // explicit codes
      if (t === BidiType.LRE || t === BidiType.LRO || t === BidiType.LRI) {
        const nl = (curLevel + (curLevel & 1 ? 1 : 2)) & 0x7E;
        if (nl <= 61 && sp < 255) {
          _stack[sp] = curLevel; _stackO[sp] = t === BidiType.LRO ? 1 : 0; _stackI[sp] = (t === BidiType.LRI ? 1 : 0); sp++;
          curLevel = nl;
        }
      } else if (t === BidiType.RLE || t === BidiType.RLO || t === BidiType.RLI) {
        const nl = (curLevel + (curLevel & 1 ? 2 : 1)) | 1;
        if (nl <= 61 && sp < 255) {
          _stack[sp] = curLevel; _stackO[sp] = t === BidiType.RLO ? 2 : 0; _stackI[sp] = (t === BidiType.RLI ? 1 : 0); sp++;
          curLevel = nl;
        }
      } else if (t === BidiType.PDF || t === BidiType.PDI) {
        if (sp > 1) { sp--; curLevel = _stack[sp]; }
      }
      _levels[i] = curLevel;
      _types[i] = BidiType.BN;
      continue;
    }
    _levels[i] = curLevel;
    const ov = sp > 0 ? _stackO[sp - 1] : 0;
    if (ov === 1) _types[i] = BidiType.L;
    else if (ov === 2) _types[i] = BidiType.R;
  }

  // W1: NSM → type of previous
  for (let i = 0; i < len; i++) {
    if (_types[i] === BidiType.NSM) _types[i] = i > 0 ? _types[i - 1] : base;
  }
  // W2: EN after AL → AN
  for (let i = 0; i < len; i++) {
    if (_types[i] === BidiType.EN) {
      for (let j = i - 1; j >= 0; j--) {
        const t = _types[j]; if (t === BidiType.AL) { _types[i] = BidiType.AN; break; }
        if (t === BidiType.R || t === BidiType.L) break;
      }
    }
  }
  // W3: AL → R
  for (let i = 0; i < len; i++) { if (_types[i] === BidiType.AL) _types[i] = BidiType.R; }
  // W4: ES between EN → EN; CS between matching → matching
  for (let i = 1; i < len - 1; i++) {
    if (_types[i] === BidiType.ES && _types[i - 1] === BidiType.EN && _types[i + 1] === BidiType.EN) _types[i] = BidiType.EN;
    if (_types[i] === BidiType.CS) {
      if (_types[i - 1] === BidiType.EN && _types[i + 1] === BidiType.EN) _types[i] = BidiType.EN;
      if (_types[i - 1] === BidiType.AN && _types[i + 1] === BidiType.AN) _types[i] = BidiType.AN;
    }
  }
  // W5: ET adjacent to EN → EN
  for (let i = 0; i < len; i++) {
    if (_types[i] === BidiType.ET) {
      let adj = false;
      if (i > 0 && _types[i - 1] === BidiType.EN) adj = true;
      if (i < len - 1 && _types[i + 1] === BidiType.EN) adj = true;
      if (adj) _types[i] = BidiType.EN;
    }
  }
  // W6: remaining ES, ET, CS → ON
  for (let i = 0; i < len; i++) {
    const t = _types[i]; if (t === BidiType.ES || t === BidiType.ET || t === BidiType.CS) _types[i] = BidiType.ON;
  }
  // W7: EN with prior strong L → L
  for (let i = 0; i < len; i++) {
    if (_types[i] === BidiType.EN) {
      for (let j = i - 1; j >= 0; j--) {
        if (_types[j] === BidiType.L) { _types[i] = BidiType.L; break; }
        if (_types[j] === BidiType.R) break;
      }
    }
  }
  // N1/N2: neutrals between strongs
  for (let i = 0; i < len; i++) {
    const t = _types[i];
    if (t === BidiType.ON || t === BidiType.WS || t === BidiType.S || t === BidiType.B || t === BidiType.BN) {
      let prev = (base & 1) ? BidiType.R : BidiType.L;
      for (let j = i - 1; j >= 0; j--) { if (_types[j] === BidiType.L || _types[j] === BidiType.R || _types[j] === BidiType.AN || _types[j] === BidiType.EN) { prev = _types[j] === BidiType.AN || _types[j] === BidiType.EN ? BidiType.R : _types[j]; break; } }
      let next = (base & 1) ? BidiType.R : BidiType.L;
      for (let j = i + 1; j < len; j++) { if (_types[j] === BidiType.L || _types[j] === BidiType.R || _types[j] === BidiType.AN || _types[j] === BidiType.EN) { next = _types[j] === BidiType.AN || _types[j] === BidiType.EN ? BidiType.R : _types[j]; break; } }
      _types[i] = prev === next ? prev : (((_levels[i] & 1) ? BidiType.R : BidiType.L));
    }
  }
  // I1/I2: resolve levels from types
  for (let i = 0; i < len; i++) {
    const lv = _levels[i];
    if (lv & 1) { // odd level
      if (_types[i] !== BidiType.R) _levels[i] = lv + 1;
    } else { // even level
      if (_types[i] === BidiType.R) _levels[i] = lv + 1;
      else if (_types[i] === BidiType.AN || _types[i] === BidiType.EN) _levels[i] = lv + 2;
    }
  }
  return _levels;
}

/** L2: reorder indices in-place for visual order by reversing subsequences per level. */
export function reorderLine(levels: Uint8Array, start: number, end: number, indices: Uint32Array): void {
  if (end <= start) return;
  let maxLv = 0, minOdd = 62;
  for (let i = start; i < end; i++) {
    const lv = levels[i];
    if (lv > maxLv) maxLv = lv;
    if ((lv & 1) && lv < minOdd) minOdd = lv;
  }
  for (let lv = maxLv; lv >= minOdd; lv--) {
    let i = start;
    while (i < end) {
      if (levels[i] >= lv) {
        let j = i + 1;
        while (j < end && levels[j] >= lv) j++;
        // reverse indices[i..j-1]
        let lo = i, hi = j - 1;
        while (lo < hi) { const tmp = indices[lo]; indices[lo] = indices[hi]; indices[hi] = tmp; lo++; hi--; }
        i = j;
      } else { i++; }
    }
  }
}
