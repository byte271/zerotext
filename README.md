# ZeroText

Zero-allocation text layout engine for the web. Sub-microsecond cached layouts, 5KB core.

[![npm version](https://img.shields.io/npm/v/@zerotext/core)](https://www.npmjs.com/package/@zerotext/core)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@zerotext/core)](https://bundlephobia.com/package/@zerotext/core)
[![license](https://img.shields.io/github/license/byte271/zerotext)](./LICENSE)
[![CI](https://github.com/byte271/zerotext/actions/workflows/ci.yml/badge.svg)](https://github.com/byte271/zerotext/actions/workflows/ci.yml)

## Why ZeroText?

Canvas-based text layout allocates on every frame. DOM-based layout triggers reflow. ZeroText does neither.

- **Zero allocation** -- arena pooling and pre-allocated typed arrays eliminate GC pauses entirely
- **O(1) glyph lookup** -- perfect hash table with ASCII fast path (codepoints 0-127 cached without hashing)
- **O(log n) line breaking** -- prefix-sum binary search over a DFA-driven break table (UAX#14)
- **Sub-microsecond hot path** -- LRU cache keyed by numeric FNV-1a hashes (no string allocation on lookup)
- **WASM SIMD + WebGPU** -- optional acceleration paths for batch workloads

## Benchmarks

| Metric | Target | Actual |
|---|---|---|
| Bundle size | <8 KB | ~5-6 KB |
| Initial layout (cold) | <8 us | 5.6 us |
| Hot layout (cached) | <1 us | 0.1 us (100 ns) |
| GC pauses | 0 | 0 |

Run locally: `npx tsx benchmarks/features.ts`

## Features

| # | Feature | Status | Algorithm |
|---|---|---|---|
| 1 | Line breaking | Done | UAX#14 DFA + prefix-sum binary search |
| 2 | Glyph lookup | Done | Perfect hash table, O(1) + ASCII cache |
| 3 | Arena memory | Done | Pool allocator, generational buffers |
| 4 | LRU cache | Done | Doubly-linked list + Map, FNV-1a keys |
| 5 | Bidi/RTL | Done | UAX#9 stack-based embedding levels |
| 6 | Ligatures | Done | Flat trie substitution (fi, fl, ff, ffi, ffl) |
| 7 | Kerning | Done | Pair-wise FNV-1a hash table |
| 8 | Hyphenation | Done | Liang algorithm + soft-hyphen insertion |
| 9 | Alignment | Done | Left, center, right, justify |
| 10 | Truncation | Done | End, middle, start with ellipsis |
| 11 | Decoration | Done | SoA bitflags (underline, strikethrough, overline) |
| 12 | Vertical writing | Done | vertical-rl, vertical-lr coordinate transform |
| 13 | Hit testing | Done | Binary search over lines and spans |

## Installation

```bash
npm install @zerotext/core
```

## Usage

### Basic layout

```ts
import { createEngine } from "@zerotext/core";
import type { GlyphEntry } from "@zerotext/core";

const glyphs: GlyphEntry[] = [
  { codepoint: 72, width: 8 },  // H
  { codepoint: 101, width: 6 }, // e
  { codepoint: 108, width: 3 }, // l
  { codepoint: 111, width: 7 }, // o
  // ...
];

const engine = createEngine({});
const prepared = engine.prepare("Hello world", glyphs);
const layout = engine.update(prepared, 200); // 200px container width

console.log(layout.lines.length, layout.height);
```

### Full pipeline (bidi + ligatures + alignment)

```ts
import { createEngine, createGlyphTable } from "@zerotext/core";

const engine = createEngine({
  enableBidi: true,
  enableLigatures: true,
  enableHyphenation: true,
  textAlign: 1,      // Center
  writingMode: 0,    // Horizontal
  truncate: 0,       // None
  maxLines: 0,       // Unlimited
});

const glyphTable = createGlyphTable(glyphs);
const text = new Uint32Array([/* codepoints */]);

const result = engine.layoutFull({
  glyphTable,
  text,
  width: 300,
  lineHeight: 20,
});
```

### Hit testing

```ts
const caret = engine.hitTest(mouseX, mouseY, layout);
console.log(caret.offset, caret.lineIndex);

const rects = engine.getSelectionRects(
  { start: 0, end: 10 },
  layout,
);
```

### React hook

```tsx
import { ZeroTextProvider, useZeroText } from "@zerotext/react";
import type { GlyphEntry } from "@zerotext/core";

function App() {
  return (
    <ZeroTextProvider config={{ enableLigatures: true }}>
      <TextBlock text="Hello world" />
    </ZeroTextProvider>
  );
}

function TextBlock({ text }: { text: string }) {
  const glyphs: GlyphEntry[] = [/* glyph entries */];
  const { ref, layout, isReady } = useZeroText(text, {
    glyphEntries: glyphs,
    lineHeight: 20,
  });

  return <div ref={ref}>{isReady && <span>{layout!.lines.length} lines</span>}</div>;
}
```

## Packages

| Package | Description |
|---|---|
| [`@zerotext/core`](./packages/core) | Layout engine, arena, cache, all text features |
| [`@zerotext/compiler`](./packages/compiler) | Ahead-of-time font subset + ZTB binary format |
| [`@zerotext/flow`](./packages/flow) | Text wrapping around obstacles |
| [`@zerotext/react`](./packages/react) | React bindings (`useZeroText`, `ZeroTextProvider`) |
| [`@zerotext/vue`](./packages/vue) | Vue composable |
| [`@zerotext/svelte`](./packages/svelte) | Svelte action |
| [`@zerotext/wasm`](./packages/wasm) | WASM SIMD acceleration (Rust) |
| [`@zerotext/webgpu`](./packages/webgpu) | WebGPU compute shader batch layout |

Build plugins: [`@zerotext/vite`](./plugins/vite), [`@zerotext/webpack`](./plugins/webpack), [`@zerotext/rollup`](./plugins/rollup)

## Architecture

```
Text input
  |
  v
Arena (pre-allocated typed arrays, zero GC)
  |
  v
PrefixSum (cumulative glyph widths)
  |
  v
DFA (UAX#14 line break classification)
  |
  v
BinarySearch (O(log n) break point selection)
  |
  v
Cache (LRU, FNV-1a numeric keys, O(1) hot path)
  |
  v
LayoutResult (lines, spans, positions)
```

Optional pipeline stages (bidi, ligatures, hyphenation, alignment, truncation, decoration, vertical transform) are applied in `engine.layoutFull()`.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, testing, and coding guidelines.

## License

Apache-2.0. See [LICENSE](./LICENSE).
