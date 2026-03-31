import type { Compiler, WebpackPluginInstance } from "webpack";

export interface ZeroTextWebpackOptions {
  fonts?: string[];
  scan?: string[];
}

const DEFAULT_OPTIONS: Required<ZeroTextWebpackOptions> = {
  fonts: [],
  scan: ["src/**/*.{ts,tsx,js,jsx}"],
};

export class ZeroTextPlugin implements WebpackPluginInstance {
  private options: Required<ZeroTextWebpackOptions>;
  private compiler: any;

  constructor(options?: ZeroTextWebpackOptions) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };
    this.compiler = null;
  }

  apply(compiler: Compiler): void {
    compiler.hooks.beforeCompile.tapPromise("ZeroTextPlugin", async () => {
      const { createCompiler } = await import("@zerotext/compiler");
      this.compiler = createCompiler({
        fonts: this.options.fonts,
      });
    });

    compiler.hooks.compilation.tap("ZeroTextPlugin", (compilation) => {
      compilation.hooks.processAssets.tapPromise(
        {
          name: "ZeroTextPlugin",
          stage: compilation.constructor.PROCESS_ASSETS_STAGE_OPTIMIZE,
        },
        async (assets) => {
          if (!this.compiler) {
            return;
          }

          const generatedAssets = await this.compiler.generateAssets({
            compress: true,
          });

          for (const asset of generatedAssets) {
            const { sources } = await import("webpack");
            compilation.emitAsset(
              asset.fileName,
              new sources.RawSource(asset.source)
            );
          }
        }
      );
    });

    compiler.hooks.normalModuleFactory.tap("ZeroTextPlugin", (factory) => {
      factory.hooks.afterResolve.tapPromise("ZeroTextPlugin", async (data) => {
        if (!this.compiler) {
          return;
        }

        const isTarget = this.options.scan.some((pattern) => {
          const ext = data.createData?.resource?.split(".").pop();
          return ext && pattern.includes(ext);
        });

        if (!isTarget) {
          return;
        }

        return data;
      });
    });
  }
}

export default ZeroTextPlugin;
