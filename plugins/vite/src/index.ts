import type { Plugin, ResolvedConfig } from "vite";

export interface ZeroTextOptimization {
  precomputeBreakpoints?: boolean;
  inlineThreshold?: number;
  inlineSmallText?: boolean;
  compress?: boolean;
  subsetCoverage?: number;
}

export interface ZeroTextExperimental {
  wasm?: boolean;
  webgpu?: boolean;
}

export interface ZeroTextOptions {
  fonts?: string[];
  locales?: string[];
  scan?: string[];
  output?: string;
  optimization?: ZeroTextOptimization;
  experimental?: ZeroTextExperimental;
}

const DEFAULT_OPTIONS: Required<ZeroTextOptions> = {
  fonts: [],
  locales: ["en"],
  scan: ["src/**/*.{ts,tsx,js,jsx,vue,svelte}"],
  output: "dist",
  optimization: {
    precomputeBreakpoints: true,
    inlineThreshold: 256,
    inlineSmallText: true,
    compress: true,
    subsetCoverage: 0.95,
  },
  experimental: {
    wasm: false,
    webgpu: false,
  },
};

export function zeroText(options?: ZeroTextOptions): Plugin {
  const resolvedOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
    optimization: { ...DEFAULT_OPTIONS.optimization, ...options?.optimization },
    experimental: { ...DEFAULT_OPTIONS.experimental, ...options?.experimental },
  };

  let config: ResolvedConfig;
  const processedFiles = new Set<string>();

  return {
    name: "zerotext",
    enforce: "pre",

    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },

    async buildStart() {
      processedFiles.clear();
      const { createCompiler } = await import("@zerotext/compiler");
      const compiler = createCompiler({
        fonts: resolvedOptions.fonts,
        locales: resolvedOptions.locales,
        optimization: resolvedOptions.optimization,
        experimental: resolvedOptions.experimental,
      });
      (this as any).__zeroTextCompiler = compiler;
    },

    async transform(code, id) {
      if (processedFiles.has(id)) {
        return null;
      }

      const isTarget = resolvedOptions.scan.some((pattern) => {
        const ext = id.split(".").pop();
        return ext && pattern.includes(ext);
      });

      if (!isTarget) {
        return null;
      }

      processedFiles.add(id);

      const compiler = (this as any).__zeroTextCompiler;
      if (!compiler) {
        return null;
      }

      const result = await compiler.transform(code, id);
      if (!result) {
        return null;
      }

      return {
        code: result.code,
        map: result.map,
      };
    },

    async generateBundle(_outputOptions, bundle) {
      const compiler = (this as any).__zeroTextCompiler;
      if (!compiler) {
        return;
      }

      const assets = await compiler.generateAssets({
        compress: resolvedOptions.optimization.compress,
        subsetCoverage: resolvedOptions.optimization.subsetCoverage,
      });

      for (const asset of assets) {
        this.emitFile({
          type: "asset",
          fileName: asset.fileName,
          source: asset.source,
        });
      }
    },
  };
}

export default zeroText;
