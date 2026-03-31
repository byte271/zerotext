import { performance } from "perf_hooks";

const LOREM_IPSUM =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Curabitur pretium tincidunt lacus. Nulla gravida orci a odio. Nullam varius, turpis et commodo pharetra, est eros bibendum elit, nec luctus magna felis sollicitudin mauris. Integer in mauris eu nibh euismod gravida. Duis ac tellus et risus vulputate vehicula. Donec lobortis risus a elit. Etiam tempor. Ut ullamcorper, ligula ut dictum pharetra, nisi nunc fringilla magna, in commodo elit erat nec turpis. Ut pharetra augue nec augue. Nam elit agna, endrerit sit amet, tincidunt ac, viverra sed, nulla. Donec porta diam eu massa. Quisque diam lorem, interdum vitae, dapibus ac, scelerisque vitae, pede. Donec eget tellus non erat lacinia fermentum. Donec in velit vel ipsum auctor pulvinar. Class aptent taciti sociosqu ad litora torquent per conubia nostra per.";

const ITERATIONS = 1000;

interface BenchmarkResult {
  name: string;
  medianMs: number;
  p50Ms: number;
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
    p50Ms: p50,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
  };
}

function simulateZeroTextLayout(text: string): { width: number; height: number } {
  let width = 0;
  let height = 16;
  let lineWidth = 0;
  const maxWidth = 600;

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

function simulatePretextLayout(text: string): { width: number; height: number } {
  let width = 0;
  let height = 16;
  let lineWidth = 0;
  const maxWidth = 600;

  const words = text.split(/\s+/);
  for (const word of words) {
    const wordWidth = word.length * 7.5;
    if (lineWidth + wordWidth > maxWidth) {
      width = Math.max(width, lineWidth);
      lineWidth = 0;
      height += 22;
    }
    lineWidth += wordWidth + 7.5;
  }

  width = Math.max(width, lineWidth);
  return { width, height };
}

function simulateZeroTextEmoji(text: string): string[] {
  const emojiPattern = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
  return text.match(emojiPattern) || [];
}

function simulatePretextEmoji(text: string): string[] {
  const results: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i);
    if (code && code > 0x1f000) {
      results.push(String.fromCodePoint(code));
      if (code > 0xffff) {
        i++;
      }
    }
  }
  return results;
}

async function main() {
  const results: BenchmarkResult[] = [];

  results.push(
    runBenchmark("ZeroText Cold Layout", () => {
      simulateZeroTextLayout(LOREM_IPSUM);
    })
  );

  results.push(
    runBenchmark("Pretext Cold Layout", () => {
      simulatePretextLayout(LOREM_IPSUM);
    })
  );

  simulateZeroTextLayout(LOREM_IPSUM);
  simulatePretextLayout(LOREM_IPSUM);

  results.push(
    runBenchmark("ZeroText Hot Layout", () => {
      simulateZeroTextLayout(LOREM_IPSUM);
    })
  );

  results.push(
    runBenchmark("Pretext Hot Layout", () => {
      simulatePretextLayout(LOREM_IPSUM);
    })
  );

  const memBefore = process.memoryUsage().heapUsed;
  for (let i = 0; i < ITERATIONS; i++) {
    simulateZeroTextLayout(LOREM_IPSUM);
  }
  const memAfterZero = process.memoryUsage().heapUsed;

  for (let i = 0; i < ITERATIONS; i++) {
    simulatePretextLayout(LOREM_IPSUM);
  }
  const memAfterPretext = process.memoryUsage().heapUsed;

  const emojiText = "Hello \u{1F600}\u{1F601}\u{1F602} World \u{1F680}\u{1F3E0} Test \u{2764}\u{FE0F}\u{1F44D}";

  results.push(
    runBenchmark("ZeroText Emoji Processing", () => {
      simulateZeroTextEmoji(emojiText);
    })
  );

  results.push(
    runBenchmark("Pretext Emoji Processing", () => {
      simulatePretextEmoji(emojiText);
    })
  );

  console.log("=== ZeroText vs Pretext Benchmark ===");
  console.log(`Iterations: ${ITERATIONS}`);
  console.log(`Text length: ${LOREM_IPSUM.length} chars`);
  console.log("");

  for (const result of results) {
    console.log(`${result.name}:`);
    console.log(`  Median (p50): ${result.p50Ms.toFixed(4)}ms`);
    console.log(`  Min: ${result.minMs.toFixed(4)}ms`);
    console.log(`  Max: ${result.maxMs.toFixed(4)}ms`);
    console.log("");
  }

  console.log("=== Memory Usage ===");
  console.log(`ZeroText: ${((memAfterZero - memBefore) / 1024).toFixed(2)} KB`);
  console.log(
    `Pretext: ${((memAfterPretext - memAfterZero) / 1024).toFixed(2)} KB`
  );
}

main();
