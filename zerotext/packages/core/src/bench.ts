import { solveLayout, LayoutResult } from "./layout.js";
import { createGlyphTable, GlyphEntry, PerfectHashTable } from "./hash.js";

export interface BenchmarkConfig {
  texts: string[];
  widths: number[];
  iterations: number;
}

export interface BenchmarkResult {
  totalTimeMs: number;
  avgTimeMs: number;
  opsPerSecond: number;
  perText: { text: string; avgMs: number; linesProduced: number }[];
}

export function benchmark(config: BenchmarkConfig): BenchmarkResult {
  const { texts, widths, iterations } = config;

  const prepared: { codepoints: Uint32Array; table: PerfectHashTable }[] = [];
  for (let t = 0; t < texts.length; t++) {
    const text = texts[t];
    const codepoints = new Uint32Array(text.length);
    const seen = new Set<number>();
    const entries: GlyphEntry[] = [];
    for (let i = 0; i < text.length; i++) {
      codepoints[i] = text.codePointAt(i) ?? 0;
      if (!seen.has(codepoints[i])) {
        seen.add(codepoints[i]);
        entries.push({ codepoint: codepoints[i], fontId: 0, width: 8 });
      }
    }
    const table = createGlyphTable(entries);
    prepared.push({ codepoints, table });
  }

  const perText: { text: string; avgMs: number; linesProduced: number }[] = [];
  let totalTime = 0;

  for (let t = 0; t < texts.length; t++) {
    const { codepoints, table } = prepared[t];
    let textTime = 0;
    let linesProduced = 0;

    for (let w = 0; w < widths.length; w++) {
      const width = widths[w];
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        const result = solveLayout({
          glyphTable: table,
          text: codepoints,
          width
        });
        linesProduced += result.lines.length;
      }
      const elapsed = performance.now() - start;
      textTime += elapsed;
    }

    totalTime += textTime;
    const runs = widths.length * iterations;
    perText.push({
      text: texts[t].substring(0, 40),
      avgMs: textTime / runs,
      linesProduced
    });
  }

  const totalRuns = texts.length * widths.length * iterations;

  return {
    totalTimeMs: totalTime,
    avgTimeMs: totalTime / totalRuns,
    opsPerSecond: totalRuns / (totalTime / 1000),
    perText
  };
}
