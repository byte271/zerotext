import type { Plugin } from "rollup";

export interface ZeroTextRollupOptions {
  fonts?: string[];
  locales?: string[];
  scan?: string[];
}

const DEFAULT_OPTIONS: Required<ZeroTextRollupOptions> = {
  fonts: [],
  locales: ["en"],
  scan: ["src/**/*.{ts,tsx,js,jsx}"],
};

export function zeroText(options?: ZeroTextRollupOptions): Plugin {
  const resolvedOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  let compilerInstance: any = null;
  const processedFiles = new Set<string>();

  return {
    name: "zerotext",

    async buildStart() {
      processedFiles.clear();
      const { createCompiler } = await import("@zerotext/compiler");
      compilerInstance = createCompiler({
        fonts: resolvedOptions.fonts,
        locales: resolvedOptions.locales,
      });
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

      if (!compilerInstance) {
        return null;
      }

      const result = await compilerInstance.transform(code, id);
      if (!result) {
        return null;
      }

      return {
        code: result.code,
        map: result.map,
      };
    },

    async generateBundle() {
      if (!compilerInstance) {
        return;
      }

      const assets = await compilerInstance.generateAssets({
        compress: true,
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
