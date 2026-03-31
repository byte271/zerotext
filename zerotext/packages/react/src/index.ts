import {
  useRef, useState, useEffect, useMemo,
  createContext, useContext,
  type ReactNode, type RefObject,
} from "react";
import {
  ZeroEngine, type EngineConfig, type LayoutResult,
  type PreparedText, type GlyphEntry,
} from "@zerotext/core";

export interface UseZeroTextOptions {
  glyphEntries: GlyphEntry[];
  lineHeight?: number;
}

export interface UseZeroTextReturn {
  ref: RefObject<HTMLElement | null>;
  layout: LayoutResult | null;
  isReady: boolean;
}

export interface ZeroTextProviderProps {
  config?: EngineConfig;
  children: ReactNode;
}

const ZeroTextContext = createContext<ZeroEngine | null>(null);

export function ZeroTextProvider({ config, children }: ZeroTextProviderProps) {
  const [engine] = useState(() => new ZeroEngine(config ?? {}));

  useEffect(() => {
    return () => { engine.gc(); };
  }, [engine]);

  return ZeroTextContext.Provider({ value: engine, children });
}

export function useZeroEngine(): ZeroEngine {
  const engine = useContext(ZeroTextContext);
  if (!engine) throw new Error("useZeroEngine must be used within a ZeroTextProvider");
  return engine;
}

export function useZeroText(text: string, options: UseZeroTextOptions): UseZeroTextReturn {
  const ref = useRef<HTMLElement | null>(null);
  const [layout, setLayout] = useState<LayoutResult | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [width, setWidth] = useState(0);

  const ctx = useContext(ZeroTextContext);
  const fallback = useRef<ZeroEngine | null>(null);
  const engine = ctx ?? (fallback.current ??= new ZeroEngine({}));

  const prepared = useMemo(
    () => engine.prepare(text, options.glyphEntries),
    [engine, text, options.glyphEntries],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      setWidth((prev) => (prev === w ? prev : w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (width <= 0) return;
    const result = engine.update(prepared, width);
    setLayout(result);
    setIsReady(true);
  }, [engine, prepared, width]);

  useEffect(() => {
    return () => {
      if (!ctx && fallback.current) { fallback.current.gc(); fallback.current = null; }
    };
  }, [ctx]);

  return { ref, layout, isReady };
}

export type { LayoutResult, GlyphEntry, EngineConfig, PreparedText };
