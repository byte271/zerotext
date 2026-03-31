const MAX_LINES = 1024;
const MAX_SPANS = 4096;
const LINE_STRIDE = 16;
const SPAN_STRIDE = 8;
const ARENA_SIZE = 1024 * 1024;

// Maximum text length for arena-backed prefix sums (~128KB at 8 bytes each)
const MAX_PREFIX_LEN = 16384;

export { MAX_LINES, MAX_PREFIX_LEN };

export class ArenaPool {
  private buffer: ArrayBuffer;
  private lineOffset: number;
  private spanOffset: number;
  private stringPoolOffset: number;
  private generation: number;
  private lineGeneration: Uint32Array;
  private spanGeneration: Uint32Array;
  private head: number;
  private tail: number;

  lineX: Float64Array;
  lineY: Float64Array;
  lineWidth: Float32Array;
  lineHeight: Float32Array;
  lineFlags: Uint8Array;
  stringPool: Uint16Array;

  // Span SoA arrays (arena-backed)
  spanX: Float32Array;
  spanWidth: Float32Array;
  spanTextStart: Uint32Array;
  spanTextEnd: Uint32Array;
  spanFontId: Uint8Array;
  // Per-line: index of first span and span count
  lineSpanStart: Uint32Array;
  lineSpanCount: Uint16Array;

  // Arena-backed prefix sum buffer
  prefixSumPool: Float64Array;

  constructor() {
    this.buffer = new ArrayBuffer(ARENA_SIZE);
    this.generation = 0;
    this.head = 0;
    this.tail = 0;

    // Layout within the 1MB arena buffer:
    // lineX:         0       .. 8192      (1024 × 8B)
    // lineY:         8192    .. 16384     (1024 × 8B)
    // lineWidth:     16384   .. 20480     (1024 × 4B)
    // lineHeight:    20480   .. 24576     (1024 × 4B)
    // lineSpanStart: 24576   .. 28672     (1024 × 4B)
    // lineSpanCount: 28672   .. 30720     (1024 × 2B)
    // spanX:         30720   .. 47104     (4096 × 4B)
    // spanWidth:     47104   .. 63488     (4096 × 4B)
    // spanTextStart: 63488   .. 79872     (4096 × 4B)
    // spanTextEnd:   79872   .. 96256     (4096 × 4B)
    // prefixSumPool: 131072  .. 262144    (16384 × 8B)
    // stringPool:    262144  .. end
    const lineXOff = 0;
    const lineYOff = lineXOff + MAX_LINES * 8;
    const lineWidthOff = lineYOff + MAX_LINES * 8;
    const lineHeightOff = lineWidthOff + MAX_LINES * 4;
    const lineSpanStartOff = lineHeightOff + MAX_LINES * 4;
    const lineSpanCountOff = lineSpanStartOff + MAX_LINES * 4;
    const spanXOff = lineSpanCountOff + MAX_LINES * 2;
    // Align to 4 bytes
    const spanXOffAligned = (spanXOff + 3) & ~3;
    const spanWidthOff = spanXOffAligned + MAX_SPANS * 4;
    const spanTextStartOff = spanWidthOff + MAX_SPANS * 4;
    const spanTextEndOff = spanTextStartOff + MAX_SPANS * 4;
    const spanFontIdOff = spanTextEndOff + MAX_SPANS * 4;
    // Align prefix sums to 8 bytes
    const prefixOff = ((spanFontIdOff + MAX_SPANS) + 7) & ~7;
    this.stringPoolOffset = prefixOff + MAX_PREFIX_LEN * 8;
    // Ensure stringPoolOffset is aligned to 2 bytes (for Uint16Array)
    this.stringPoolOffset = (this.stringPoolOffset + 1) & ~1;

    this.lineOffset = 0;
    this.spanOffset = spanXOffAligned;

    this.lineX = new Float64Array(this.buffer, lineXOff, MAX_LINES);
    this.lineY = new Float64Array(this.buffer, lineYOff, MAX_LINES);
    this.lineWidth = new Float32Array(this.buffer, lineWidthOff, MAX_LINES);
    this.lineHeight = new Float32Array(this.buffer, lineHeightOff, MAX_LINES);
    this.lineSpanStart = new Uint32Array(this.buffer, lineSpanStartOff, MAX_LINES);
    this.lineSpanCount = new Uint16Array(this.buffer, lineSpanCountOff, MAX_LINES);
    this.spanX = new Float32Array(this.buffer, spanXOffAligned, MAX_SPANS);
    this.spanWidth = new Float32Array(this.buffer, spanWidthOff, MAX_SPANS);
    this.spanTextStart = new Uint32Array(this.buffer, spanTextStartOff, MAX_SPANS);
    this.spanTextEnd = new Uint32Array(this.buffer, spanTextEndOff, MAX_SPANS);
    this.spanFontId = new Uint8Array(this.buffer, spanFontIdOff, MAX_SPANS);
    this.prefixSumPool = new Float64Array(this.buffer, prefixOff, MAX_PREFIX_LEN);
    this.lineFlags = new Uint8Array(MAX_LINES);
    this.lineGeneration = new Uint32Array(MAX_LINES);
    this.spanGeneration = new Uint32Array(MAX_SPANS);

    const remaining = ARENA_SIZE - this.stringPoolOffset;
    this.stringPool = new Uint16Array(this.buffer, this.stringPoolOffset, Math.floor(remaining / 2));
  }

  allocLine(): number {
    const idx = this.head;
    this.head = (this.head + 1) % MAX_LINES;
    this.lineGeneration[idx] = this.generation;
    // Skip field zeroing — callers always overwrite lineX/Y/Width/Height
    return idx;
  }

  allocSpan(): number {
    const idx = this.tail;
    this.tail = (this.tail + 1) % MAX_SPANS;
    this.spanGeneration[idx] = this.generation;
    return idx;
  }

  sweep(generationThreshold: number): number {
    let freed = 0;
    for (let i = 0; i < MAX_LINES; i++) {
      if (this.lineGeneration[i] < generationThreshold) {
        this.lineFlags[i] = 0;
        freed++;
      }
    }
    for (let i = 0; i < MAX_SPANS; i++) {
      if (this.spanGeneration[i] < generationThreshold) {
        freed++;
      }
    }
    return freed;
  }

  reset(): void {
    this.head = 0;
    this.tail = 0;
    this.generation++;
    // Skip lineFlags.fill(0) — generation tracking makes it unnecessary
  }

  gc(): number {
    const threshold = this.generation > 1 ? this.generation - 1 : 0;
    return this.sweep(threshold);
  }
}
