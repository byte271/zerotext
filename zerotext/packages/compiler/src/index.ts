export { scanSource, scanDirectory } from "./scanner.js";
export type {
  StringLiteral,
  TemplateExpression,
  ScanResult,
} from "./scanner.js";

export { FontSubsetter } from "./font-subset.js";
export type { CharFrequencyMap, FontConfig } from "./font-subset.js";

export {
  generateZTB,
  parseZTB,
  computeChecksum,
} from "./codegen.js";
export type { CompilationData } from "./codegen.js";

export interface CompileConfig {
  entry: string;
  outDir: string;
  fonts?: Array<{
    family: string;
    weights: number[];
    display?: string;
    preload?: boolean;
  }>;
  include?: string[];
  exclude?: string[];
  minify?: boolean;
  sourcemap?: boolean;
  target?: string;
}

export async function compile(config: CompileConfig): Promise<ArrayBuffer> {
  const { scanDirectory } = await import("./scanner.js");
  const { FontSubsetter } = await import("./font-subset.js");
  const { generateZTB } = await import("./codegen.js");

  const patterns = config.include || [`${config.entry}/**/*.ts`];
  const allResults = [];
  for (const pattern of patterns) {
    const results = await scanDirectory(pattern);
    allResults.push(...results);
  }

  const fontConfig = config.fonts?.[0] || {
    family: "system-ui",
    weights: [400],
  };
  const subsetter = new FontSubsetter(fontConfig);
  const charFreq = subsetter.analyzeFontUsage(allResults);

  const chars = new Set(charFreq.keys());
  const glyphTable = new Map<number, Uint8Array>();
  for (const cp of chars) {
    const freq = charFreq.get(cp) || 0;
    const entry = new Uint8Array(2);
    entry[0] = freq & 0xff;
    entry[1] = (freq >> 8) & 0xff;
    glyphTable.set(cp, entry);
  }

  const sortedChars = Array.from(chars).sort((a, b) => a - b);
  const prefixSums = new Float64Array(sortedChars.length);
  let runningSum = 0;
  for (let i = 0; i < sortedChars.length; i++) {
    runningSum += charFreq.get(sortedChars[i]) || 0;
    prefixSums[i] = runningSum;
  }

  const emojiMap = new Map<string, number[]>();
  const constraints = new Uint32Array(0);

  return generateZTB({ glyphTable, prefixSums, emojiMap, constraints });
}
