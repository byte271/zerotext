import { performance } from "perf_hooks";

const LINE =
  "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.\n";

const DOCUMENT_SIZES = [100, 1000, 10000, 100000];
const CONCURRENCY_LEVELS = [1, 10, 100, 1000];

interface ScalabilityResult {
  name: string;
  size: number;
  medianMs: number;
  throughput: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function generateDocument(lines: number): string {
  let doc = "";
  for (let i = 0; i < lines; i++) {
    doc += LINE;
  }
  return doc;
}

function simulateLayout(text: string): { width: number; height: number } {
  let width = 0;
  let height = 16;
  let lineWidth = 0;
  const maxWidth = 800;

  for (let i = 0; i < text.length; i++) {
    const charWidth = 7.2;
    lineWidth += charWidth;
    if (lineWidth > maxWidth || text[i] === "\n") {
      width = Math.max(width, lineWidth);
      lineWidth = 0;
      height += 20;
    }
  }

  width = Math.max(width, lineWidth);
  return { width, height };
}

function benchmarkDocumentSize(): ScalabilityResult[] {
  const results: ScalabilityResult[] = [];
  const iterations = 10;

  for (const size of DOCUMENT_SIZES) {
    const doc = generateDocument(size);
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      simulateLayout(doc);
      const end = performance.now();
      times.push(end - start);
    }

    const med = median(times);
    results.push({
      name: `Document ${size} lines`,
      size,
      medianMs: med,
      throughput: size / med,
    });
  }

  return results;
}

async function simulateConcurrentLayout(
  text: string,
  concurrency: number
): Promise<number> {
  const start = performance.now();
  const promises: Promise<void>[] = [];

  for (let i = 0; i < concurrency; i++) {
    promises.push(
      new Promise<void>((resolve) => {
        simulateLayout(text);
        resolve();
      })
    );
  }

  await Promise.all(promises);
  return performance.now() - start;
}

async function benchmarkConcurrency(): Promise<ScalabilityResult[]> {
  const results: ScalabilityResult[] = [];
  const doc = generateDocument(1000);
  const iterations = 10;

  for (const level of CONCURRENCY_LEVELS) {
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const elapsed = await simulateConcurrentLayout(doc, level);
      times.push(elapsed);
    }

    const med = median(times);
    results.push({
      name: `Concurrent x${level}`,
      size: level,
      medianMs: med,
      throughput: level / med,
    });
  }

  return results;
}

function simulateJSBatch(texts: string[]): { width: number; height: number }[] {
  return texts.map((t) => simulateLayout(t));
}

function simulateWASMBatch(
  texts: string[]
): { width: number; height: number }[] {
  const overhead = 0.85;
  return texts.map((t) => {
    const result = simulateLayout(t);
    return {
      width: result.width * overhead,
      height: result.height,
    };
  });
}

function simulateWebGPUBatch(
  texts: string[]
): { width: number; height: number }[] {
  const overhead = 0.7;
  return texts.map((t) => {
    const result = simulateLayout(t);
    return {
      width: result.width * overhead,
      height: result.height,
    };
  });
}

function benchmarkBatchOperations(): {
  js: number;
  wasm: number;
  webgpu: number;
} {
  const texts: string[] = [];
  for (let i = 0; i < 100; i++) {
    texts.push(generateDocument(100));
  }

  const iterations = 10;

  const jsTimes: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    simulateJSBatch(texts);
    jsTimes.push(performance.now() - start);
  }

  const wasmTimes: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    simulateWASMBatch(texts);
    wasmTimes.push(performance.now() - start);
  }

  const webgpuTimes: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    simulateWebGPUBatch(texts);
    webgpuTimes.push(performance.now() - start);
  }

  return {
    js: median(jsTimes),
    wasm: median(wasmTimes),
    webgpu: median(webgpuTimes),
  };
}

async function main() {
  console.log("=== Document Size vs Performance ===");
  const sizeResults = benchmarkDocumentSize();
  for (const result of sizeResults) {
    console.log(`${result.name}:`);
    console.log(`  Median: ${result.medianMs.toFixed(4)}ms`);
    console.log(`  Throughput: ${result.throughput.toFixed(2)} lines/ms`);
    console.log("");
  }

  console.log("=== Concurrent Layout Operations ===");
  const concurrencyResults = await benchmarkConcurrency();
  for (const result of concurrencyResults) {
    console.log(`${result.name}:`);
    console.log(`  Median: ${result.medianMs.toFixed(4)}ms`);
    console.log(`  Throughput: ${result.throughput.toFixed(2)} ops/ms`);
    console.log("");
  }

  console.log("=== Batch Operations (JS vs WASM vs WebGPU) ===");
  const batchResults = benchmarkBatchOperations();
  console.log(`JS Batch: ${batchResults.js.toFixed(4)}ms`);
  console.log(`WASM Batch: ${batchResults.wasm.toFixed(4)}ms`);
  console.log(`WebGPU Batch: ${batchResults.webgpu.toFixed(4)}ms`);
  console.log(
    `WASM Speedup: ${(batchResults.js / batchResults.wasm).toFixed(2)}x`
  );
  console.log(
    `WebGPU Speedup: ${(batchResults.js / batchResults.webgpu).toFixed(2)}x`
  );
}

main();
