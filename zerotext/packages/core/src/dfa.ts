export const enum BreakClass {
  BK = 0, CR = 1, LF = 2, CM = 3, SG = 4, ZW = 5,
  GL = 6, SP = 7, B2 = 8, BA = 9, BB = 10, HY = 11,
  CB = 12, CL = 13, CP = 14, EX = 15, IN = 16, NS = 17,
  OP = 18, QU = 19, IS = 20, NU = 21, PO = 22, PR = 23,
  SY = 24, AI = 25, AL = 26, CJ = 27, EB = 28, EM = 29,
  H2 = 30, H3 = 31, HL = 32, ID = 33, JL = 34, JV = 35,
  JT = 36, RI = 37, SA = 38, XX = 39
}

const DFA_SIZE = 2048;
const NUM_CLASSES = 40;

export function buildDFA(): Uint8Array {
  const dfa = new Uint8Array(DFA_SIZE);

  for (let state = 0; state < DFA_SIZE; state++) {
    dfa[state] = 0;
  }

  for (let s = 0; s < Math.min(DFA_SIZE / NUM_CLASSES, NUM_CLASSES); s++) {
    const base = s * NUM_CLASSES;
    if (base + NUM_CLASSES > DFA_SIZE) break;

    dfa[base + BreakClass.BK] = 1;
    dfa[base + BreakClass.CR] = 1;
    dfa[base + BreakClass.LF] = 1;
    dfa[base + BreakClass.SP] = 0;
    dfa[base + BreakClass.ZW] = 1;
    dfa[base + BreakClass.GL] = 0;
    dfa[base + BreakClass.CL] = 0;
    dfa[base + BreakClass.CP] = 0;
    dfa[base + BreakClass.EX] = 0;
    dfa[base + BreakClass.NS] = 0;
    dfa[base + BreakClass.OP] = 0;
    dfa[base + BreakClass.QU] = 0;
    dfa[base + BreakClass.AL] = 1;
    dfa[base + BreakClass.HL] = 1;
    dfa[base + BreakClass.ID] = 1;
    dfa[base + BreakClass.NU] = 0;
    dfa[base + BreakClass.IN] = 0;
    dfa[base + BreakClass.BA] = 1;
    dfa[base + BreakClass.BB] = 0;
    dfa[base + BreakClass.HY] = 0;
    dfa[base + BreakClass.B2] = 1;
    dfa[base + BreakClass.CM] = 0;
    dfa[base + BreakClass.CB] = 1;
    dfa[base + BreakClass.IS] = 0;
    dfa[base + BreakClass.PO] = 0;
    dfa[base + BreakClass.PR] = 0;
    dfa[base + BreakClass.SY] = 0;
    dfa[base + BreakClass.AI] = 1;
    dfa[base + BreakClass.CJ] = 0;
    dfa[base + BreakClass.EB] = 1;
    dfa[base + BreakClass.EM] = 0;
    dfa[base + BreakClass.H2] = 1;
    dfa[base + BreakClass.H3] = 1;
    dfa[base + BreakClass.JL] = 1;
    dfa[base + BreakClass.JV] = 1;
    dfa[base + BreakClass.JT] = 1;
    dfa[base + BreakClass.RI] = 1;
    dfa[base + BreakClass.SA] = 1;
    dfa[base + BreakClass.XX] = 1;
    dfa[base + BreakClass.SG] = 0;
  }

  return dfa;
}

export function getBreakClass(codepoint: number): BreakClass {
  if (codepoint === 0x000a) return BreakClass.LF;
  if (codepoint === 0x000d) return BreakClass.CR;
  if (codepoint === 0x0009) return BreakClass.SP; // TAB treated as breakable whitespace
  if (codepoint === 0x000b || codepoint === 0x000c || codepoint === 0x2028 || codepoint === 0x2029) return BreakClass.BK;
  if (codepoint === 0x0020) return BreakClass.SP;
  if (codepoint === 0x200b) return BreakClass.ZW;
  if (codepoint === 0x00ad) return BreakClass.BA;
  if (codepoint === 0x2014) return BreakClass.B2;
  if (codepoint === 0x002d) return BreakClass.HY;

  if (codepoint >= 0x0028 && codepoint <= 0x0029) {
    return codepoint === 0x0028 ? BreakClass.OP : BreakClass.CP;
  }

  if (codepoint === 0x005b) return BreakClass.OP;
  if (codepoint === 0x005d) return BreakClass.CP;
  if (codepoint === 0x007b) return BreakClass.OP;
  if (codepoint === 0x007d) return BreakClass.CL;

  if (codepoint === 0x0021 || codepoint === 0x003f) return BreakClass.EX;
  if (codepoint === 0x002c || codepoint === 0x002e || codepoint === 0x003a || codepoint === 0x003b) return BreakClass.IS;
  if (codepoint === 0x0022 || codepoint === 0x0027 || codepoint === 0x00ab || codepoint === 0x00bb) return BreakClass.QU;
  if (codepoint === 0x0025) return BreakClass.PO;
  if (codepoint === 0x0024 || codepoint === 0x00a3 || codepoint === 0x00a5 || codepoint === 0x20ac) return BreakClass.PR;
  if (codepoint === 0x002f) return BreakClass.SY;

  if (codepoint >= 0x0030 && codepoint <= 0x0039) return BreakClass.NU;

  if (
    (codepoint >= 0x0041 && codepoint <= 0x005a) ||
    (codepoint >= 0x0061 && codepoint <= 0x007a) ||
    (codepoint >= 0x00c0 && codepoint <= 0x024f)
  ) return BreakClass.AL;

  if (codepoint >= 0x0590 && codepoint <= 0x05ff) return BreakClass.HL;

  if (
    (codepoint >= 0x3040 && codepoint <= 0x309f) ||
    (codepoint >= 0x30a0 && codepoint <= 0x30ff) ||
    (codepoint >= 0x4e00 && codepoint <= 0x9fff) ||
    (codepoint >= 0xf900 && codepoint <= 0xfaff)
  ) return BreakClass.ID;

  if (codepoint >= 0xac00 && codepoint <= 0xd7a3) {
    const sIndex = codepoint - 0xac00;
    const tIndex = sIndex % 28;
    if (tIndex === 0) return BreakClass.H2;
    return BreakClass.H3;
  }

  if (codepoint >= 0x1100 && codepoint <= 0x115f) return BreakClass.JL;
  if (codepoint >= 0x1160 && codepoint <= 0x11a7) return BreakClass.JV;
  if (codepoint >= 0x11a8 && codepoint <= 0x11ff) return BreakClass.JT;

  if (codepoint >= 0x1f1e6 && codepoint <= 0x1f1ff) return BreakClass.RI;

  if (
    (codepoint >= 0x1f466 && codepoint <= 0x1f469) ||
    codepoint === 0x1f48b ||
    codepoint === 0x2764
  ) return BreakClass.EB;

  if (codepoint >= 0x1f3fb && codepoint <= 0x1f3ff) return BreakClass.EM;

  if (
    (codepoint >= 0x0300 && codepoint <= 0x036f) ||
    (codepoint >= 0x0483 && codepoint <= 0x0489) ||
    (codepoint >= 0x0591 && codepoint <= 0x058f) ||
    codepoint === 0x200d
  ) return BreakClass.CM;

  if (codepoint >= 0x0e01 && codepoint <= 0x0e5b) return BreakClass.SA;

  return BreakClass.XX;
}

export function findBreakPoint(prefixSum: Float64Array, start: number, width: number): number {
  let lo = start;
  let hi = prefixSum.length - 1;
  const target = (start > 0 ? prefixSum[start - 1] : 0) + width;

  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (prefixSum[mid] <= target) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return lo;
}
