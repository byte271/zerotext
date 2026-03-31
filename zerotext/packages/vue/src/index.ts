import {
  ref as vueRef, watch, onMounted, onUnmounted, inject, type Ref, type App,
  type Directive, type DirectiveBinding,
} from "vue";
import {
  ZeroEngine, type EngineConfig, type LayoutResult,
  type PreparedText, type GlyphEntry,
} from "@zerotext/core";

const ENGINE_KEY = Symbol("zerotext-engine");

export interface UseZeroTextOptions {
  glyphEntries: Ref<GlyphEntry[]>;
  width: Ref<number>;
}

export interface UseZeroTextReturn {
  layout: Ref<LayoutResult | null>;
  isReady: Ref<boolean>;
  error: Ref<Error | null>;
}

export interface DirectiveValue {
  text: string;
  glyphEntries: GlyphEntry[];
}

let singleton: ZeroEngine | null = null;
function getEngine(): ZeroEngine {
  return singleton ??= new ZeroEngine({});
}

export function useZeroText(text: Ref<string>, options: UseZeroTextOptions): UseZeroTextReturn {
  const layout = vueRef<LayoutResult | null>(null);
  const isReady = vueRef(false);
  const error = vueRef<Error | null>(null);
  const engine: ZeroEngine = inject<ZeroEngine>(ENGINE_KEY) ?? getEngine();

  const run = () => {
    try {
      const prepared = engine.prepare(text.value, options.glyphEntries.value);
      const w = options.width.value;
      if (w > 0) {
        layout.value = engine.update(prepared, w);
        isReady.value = true;
        error.value = null;
      }
    } catch (e) {
      error.value = e instanceof Error ? e : new Error(String(e));
    }
  };

  watch([text, options.glyphEntries, options.width], run, { immediate: true });
  return { layout, isReady, error };
}

export const vZeroText: Directive<HTMLElement, DirectiveValue> = {
  mounted(el: HTMLElement, binding: DirectiveBinding<DirectiveValue>) {
    const engine = getEngine();
    const apply = () => {
      const v = binding.value;
      const prepared = engine.prepare(v.text, v.glyphEntries);
      const result = engine.update(prepared, Math.round(el.clientWidth));
      el.style.height = `${result.height}px`;
      (el as any).__zt = result;
    };
    const ro = new ResizeObserver(() => apply());
    ro.observe(el);
    (el as any).__zt_ro = ro;
    (el as any).__zt_engine = engine;
    apply();
  },
  updated(el: HTMLElement, binding: DirectiveBinding<DirectiveValue>) {
    const engine: ZeroEngine = (el as any).__zt_engine ?? getEngine();
    const v = binding.value;
    const prepared = engine.prepare(v.text, v.glyphEntries);
    const result = engine.update(prepared, Math.round(el.clientWidth));
    el.style.height = `${result.height}px`;
    (el as any).__zt = result;
  },
  unmounted(el: HTMLElement) {
    ((el as any).__zt_ro as ResizeObserver)?.disconnect();
    delete (el as any).__zt;
    delete (el as any).__zt_ro;
    delete (el as any).__zt_engine;
  },
};

export const ZeroTextPlugin = {
  install(app: App, options?: { config?: EngineConfig }) {
    const engine = new ZeroEngine(options?.config ?? {});
    app.provide(ENGINE_KEY, engine);
    app.config.globalProperties.$zeroEngine = engine;
    app.directive("zero-text", vZeroText);
  },
};

export type { LayoutResult, GlyphEntry, EngineConfig, PreparedText };
