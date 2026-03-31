/** Minimal text shaping: ligature substitution + pair kerning. Zero-alloc after init. */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const MAX_LEN = 16384;

/* --- Ligature trie stored in flat Int32Array --- */

/** Trie node: [cp, output(-1=none), firstChild(-1=leaf), nextSibling(-1=none)] */
const TRIE_STRIDE = 4;

/** Flat trie for ligature lookup. */
export interface LigatureTable {
  /** Packed trie nodes. */
  nodes: Int32Array;
  /** Number of used nodes. */
  count: number;
}

/** Standard Latin ligatures. */
export const DEFAULT_LATIN_LIGATURES: Array<{ input: number[]; output: number }> = [
  { input: [0x66, 0x69], output: 0xFB01 },       // fi → ﬁ
  { input: [0x66, 0x6C], output: 0xFB02 },       // fl → ﬂ
  { input: [0x66, 0x66], output: 0xFB00 },       // ff → ﬀ
  { input: [0x66, 0x66, 0x69], output: 0xFB03 }, // ffi → ﬃ
  { input: [0x66, 0x66, 0x6C], output: 0xFB04 }, // ffl → ﬄ
];

/** Build a flat-trie ligature table from input sequences. */
export function buildLigatureTable(pairs: Array<{ input: number[]; output: number }>): LigatureTable {
  // Worst case: sum of all input lengths nodes
  let total = 0;
  for (let i = 0; i < pairs.length; i++) total += pairs[i].input.length;
  const nodes = new Int32Array((total + 1) * TRIE_STRIDE);
  nodes.fill(-1);
  let count = 0;

  for (let p = 0; p < pairs.length; p++) {
    const seq = pairs[p].input;
    let parent = -1;
    let childOff = 0; // root children start at offset 0 conceptually

    for (let d = 0; d < seq.length; d++) {
      const cp = seq[d];
      // Find or create node matching cp at this level
      let found = -1;
      const searchStart = parent === -1 ? 0 : nodes[parent * TRIE_STRIDE + 2];
      if (searchStart >= 0) {
        let sib = searchStart;
        while (sib >= 0) {
          if (nodes[sib * TRIE_STRIDE] === cp) { found = sib; break; }
          sib = nodes[sib * TRIE_STRIDE + 3];
        }
      }
      if (found >= 0) {
        parent = found;
      } else {
        const idx = count++;
        nodes[idx * TRIE_STRIDE] = cp;
        nodes[idx * TRIE_STRIDE + 1] = -1;
        nodes[idx * TRIE_STRIDE + 2] = -1;
        nodes[idx * TRIE_STRIDE + 3] = -1;
        // Link as child/sibling
        if (parent === -1) {
          // root level: chain siblings from node 0
          if (idx > 0) {
            let sib = 0;
            while (nodes[sib * TRIE_STRIDE + 3] >= 0) sib = nodes[sib * TRIE_STRIDE + 3];
            if (sib !== idx) nodes[sib * TRIE_STRIDE + 3] = idx;
          }
        } else {
          const fc = nodes[parent * TRIE_STRIDE + 2];
          if (fc < 0) {
            nodes[parent * TRIE_STRIDE + 2] = idx;
          } else {
            let sib = fc;
            while (nodes[sib * TRIE_STRIDE + 3] >= 0) sib = nodes[sib * TRIE_STRIDE + 3];
            nodes[sib * TRIE_STRIDE + 3] = idx;
          }
        }
        parent = idx;
      }
    }
    // Set output on terminal node
    if (parent >= 0) nodes[parent * TRIE_STRIDE + 1] = pairs[p].output;
  }
  return { nodes, count };
}

/** Scratch buffer for compaction during ligature application. */
const _scratch = new Uint32Array(MAX_LEN);

/** Apply ligatures in-place, returns new length. */
export function applyLigatures(codepoints: Uint32Array, len: number, table: LigatureTable): number {
  if (table.count === 0 || len === 0) return len;
  const nd = table.nodes;
  let out = 0;
  let i = 0;
  while (i < len) {
    // Try to match starting at root
    let node = -1;
    let bestEnd = -1, bestOutput = -1;
    // Find root node matching codepoints[i]
    let sib = 0;
    let matched = false;
    while (sib >= 0 && sib < table.count) {
      if (nd[sib * TRIE_STRIDE] === codepoints[i]) { node = sib; matched = true; break; }
      sib = nd[sib * TRIE_STRIDE + 3];
    }
    if (matched && node >= 0) {
      if (nd[node * TRIE_STRIDE + 1] >= 0) { bestEnd = i + 1; bestOutput = nd[node * TRIE_STRIDE + 1]; }
      let j = i + 1;
      while (j < len) {
        const child = nd[node * TRIE_STRIDE + 2];
        if (child < 0) break;
        let found = -1;
        let c = child;
        while (c >= 0 && c < table.count) {
          if (nd[c * TRIE_STRIDE] === codepoints[j]) { found = c; break; }
          c = nd[c * TRIE_STRIDE + 3];
        }
        if (found < 0) break;
        node = found;
        if (nd[node * TRIE_STRIDE + 1] >= 0) { bestEnd = j + 1; bestOutput = nd[node * TRIE_STRIDE + 1]; }
        j++;
      }
    }
    if (bestOutput >= 0) {
      _scratch[out++] = bestOutput;
      i = bestEnd;
    } else {
      _scratch[out++] = codepoints[i++];
    }
  }
  // Copy back
  for (let k = 0; k < out; k++) codepoints[k] = _scratch[k];
  return out;
}

/* --- Kern table: open-addressing hash map with FNV-1a --- */

/** Hash-based kern pair table. */
export interface KernTable {
  keys: Uint32Array;
  values: Float32Array;
  size: number;
  mask: number;
}

function fnv1a(key: number): number {
  let h = FNV_OFFSET;
  h ^= key & 0xFF;         h = Math.imul(h, FNV_PRIME);
  h ^= (key >>> 8) & 0xFF; h = Math.imul(h, FNV_PRIME);
  h ^= (key >>> 16) & 0xFF; h = Math.imul(h, FNV_PRIME);
  h ^= (key >>> 24) & 0xFF; h = Math.imul(h, FNV_PRIME);
  return h >>> 0;
}

/** Next power of two >= n. */
function nextPow2(n: number): number { let v = n - 1; v |= v >> 1; v |= v >> 2; v |= v >> 4; v |= v >> 8; v |= v >> 16; return v + 1; }

/** Build a kern table from glyph pairs. */
export function buildKernTable(pairs: Array<{ left: number; right: number; adjust: number }>): KernTable {
  const size = nextPow2(Math.max(64, pairs.length * 4));
  const mask = size - 1;
  const keys = new Uint32Array(size);
  const values = new Float32Array(size);
  keys.fill(0xFFFFFFFF);
  for (let i = 0; i < pairs.length; i++) {
    const packed = ((pairs[i].left & 0xFFFF) << 16) | (pairs[i].right & 0xFFFF);
    let idx = fnv1a(packed) & mask;
    while (keys[idx] !== 0xFFFFFFFF) idx = (idx + 1) & mask;
    keys[idx] = packed;
    values[idx] = pairs[i].adjust;
  }
  return { keys, values, size, mask };
}

/** O(1) kern pair lookup. Returns 0 if no pair found. */
export function getKernAdjust(table: KernTable, left: number, right: number): number {
  const packed = ((left & 0xFFFF) << 16) | (right & 0xFFFF);
  let idx = fnv1a(packed) & table.mask;
  let attempts = 0;
  while (attempts < table.size) {
    const k = table.keys[idx];
    if (k === packed) return table.values[idx];
    if (k === 0xFFFFFFFF) return 0;
    idx = (idx + 1) & table.mask;
    attempts++;
  }
  return 0;
}
