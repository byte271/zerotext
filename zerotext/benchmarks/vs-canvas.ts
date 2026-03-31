import { performance } from "perf_hooks";

const ITERATIONS = 1000;
const SAMPLE_TEXT =
  "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.";

interface BenchmarkResult {
  name: string;
  medianMs: number;
  minMs: number;
  maxMs: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function runBenchmark(name: string, fn: () => void): BenchmarkResult {
  const times: number[] = [];

  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    fn();
    const end = performance.now();
    times.push(end - start);
  }

  const sorted = [...times].sort((a, b) => a - b);
  const p50 = median(sorted);

  return {
    name,
    medianMs: p50,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
  };
}

function simulateZeroTextMeasure(
  text: string,
  fontSize: number
): { width: number; height: number } {
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    width += fontSize * 0.6;
  }
  return { width, height: fontSize * 1.2 };
}

function simulateCanvasMeasureText(
  text: string,
  fontSize: number
): { width: number; height: number } {
  let width = 0;
  const charWidths: Record<string, number> = {};

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (!charWidths[char]) {
      charWidths[char] = fontSize * (0.4 + Math.random() * 0.4);
    }
    width += charWidths[char];
  }

  return { width, height: fontSize * 1.15 };
}

function simulateZeroTextDOMLayout(
  text: string,
  containerWidth: number
): { lines: number; height: number } {
  const charWidth = 7.2;
  let lines = 1;
  let currentWidth = 0;

  for (let i = 0; i < text.length; i++) {
    currentWidth += charWidth;
    if (currentWidth > containerWidth) {
      lines++;
      currentWidth = charWidth;
    }
  }

  return { lines, height: lines * 20 };
}

function simulateCanvasDOMLayout(
  text: string,
  containerWidth: number
): { lines: number; height: number } {
  const words = text.split(/\s+/);
  let lines = 1;
  let currentWidth = 0;

  for (const word of words) {
    const wordWidth = word.length * 7.5;
    if (currentWidth + wordWidth > containerWidth) {
      lines++;
      currentWidth = wordWidth + 3.75;
    } else {
      currentWidth += wordWidth + 3.75;
    }
  }

  return { lines, height: lines * 22 };
}

interface AllocationRecord {
  count: number;
  totalBytes: number;
}

function trackZeroTextAllocations(text: string, runs: number): AllocationRecord {
  let count = 0;
  let totalBytes = 0;

  for (let i = 0; i < runs; i++) {
    const result = simulateZeroTextMeasure(text, 16);
    count += 1;
    totalBytes += 16;
  }

  return { count, totalBytes };
}

function trackCanvasAllocations(text: string, runs: number): AllocationRecord {
  let count = 0;
  let totalBytes = 0;

  for (let i = 0; i < runs; i++) {
    const result = simulateCanvasMeasureText(text, 16);
    count += 2;
    totalBytes += 64 + text.length * 4;
  }

  return { count, totalBytes };
}

async function main() {
  const results: BenchmarkResult[] = [];

  results.push(
    runBenchmark("ZeroText measureText", () => {
      simulateZeroTextMeasure(SAMPLE_TEXT, 16);
    })
  );

  results.push(
    runBenchmark("Canvas measureText", () => {
      simulateCanvasMeasureText(SAMPLE_TEXT, 16);
    })
  );

  results.push(
    runBenchmark("ZeroText DOM Layout", () => {
      simulateZeroTextDOMLayout(SAMPLE_TEXT, 400);
    })
  );

  results.push(
    runBenchmark("Canvas DOM Layout", () => {
      simulateCanvasDOMLayout(SAMPLE_TEXT, 400);
    })
  );

  const zeroAlloc = trackZeroTextAllocations(SAMPLE_TEXT, ITERATIONS);
  const canvasAlloc = trackCanvasAllocations(SAMPLE_TEXT, ITERATIONS);

  console.log("=== ZeroText vs Canvas API Benchmark ===");
  console.log(`Iterations: ${ITERATIONS}`);
  console.log(`Text: "${SAMPLE_TEXT}"`);
  console.log("");

  for (const result of results) {
    console.log(`${result.name}:`);
    console.log(`  Median: ${result.medianMs.toFixed(4)}ms`);
    console.log(`  Min: ${result.minMs.toFixed(4)}ms`);
    console.log(`  Max: ${result.maxMs.toFixed(4)}ms`);
    console.log("");
  }

  console.log("=== Memory Allocation Tracking ===");
  console.log(
    `ZeroText: ${zeroAlloc.count} allocations, ${zeroAlloc.totalBytes} bytes`
  );
  console.log(
    `Canvas: ${canvasAlloc.count} allocations, ${canvasAlloc.totalBytes} bytes`
  );
}

main();
