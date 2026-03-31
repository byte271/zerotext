import { writable, derived, type Writable, type Readable } from "svelte/store";
import {
  ZeroEngine, type EngineConfig, type LayoutResult,
  type PreparedText, type GlyphEntry,
} from "@zerotext/core";

export interface ZeroTextStoreOptions {
  text: Writable<string>;
  width: Writable<number>;
  glyphEntries: Writable<GlyphEntry[]>;
  config?: EngineConfig;
}

export interface ZeroTextStore {
  layout: Readable<LayoutResult | null>;
  isReady: Readable<boolean>;
  destroy: () => void;
}

export interface ZeroTextActionParams {
  text: string;
  glyphEntries: GlyphEntry[];
}

export function createZeroTextStore(options: ZeroTextStoreOptions): ZeroTextStore {
  const engine = new ZeroEngine(options.config ?? {});
  const isReadyStore = writable(false);

  const layoutStore = derived(
    [options.text, options.width, options.glyphEntries],
    ([text, width, glyphs]) => {
      if (width <= 0) return null;
      const prepared = engine.prepare(text, glyphs);
      const result = engine.update(prepared, width);
      isReadyStore.set(true);
      return result;
    },
  );

  return {
    layout: layoutStore,
    isReady: { subscribe: isReadyStore.subscribe },
    destroy() { engine.gc(); },
  };
}

export function zerotext(
  node: HTMLElement,
  params: ZeroTextActionParams,
): { update: (params: ZeroTextActionParams) => void; destroy: () => void } {
  const engine = new ZeroEngine({});
  let currentParams = params;

  function apply() {
    const w = Math.round(node.clientWidth);
    if (w <= 0) return;
    const prepared = engine.prepare(currentParams.text, currentParams.glyphEntries);
    const result = engine.update(prepared, w);
    node.style.height = `${result.height}px`;
    (node as any).__zt = result;
  }

  const ro = new ResizeObserver(() => apply());
  ro.observe(node);
  apply();

  return {
    update(newParams: ZeroTextActionParams) {
      currentParams = newParams;
      apply();
    },
    destroy() {
      ro.disconnect();
      delete (node as any).__zt;
      engine.gc();
    },
  };
}

export type { LayoutResult, GlyphEntry, EngineConfig, PreparedText };
