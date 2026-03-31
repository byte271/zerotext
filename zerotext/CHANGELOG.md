# Changelog

## 0.1.0 (2026-03-31)

### Features
- Core zero-allocation layout engine with arena pooling and prefix-sum binary search
- Full Unicode line breaking (UAX#14) with 40+ break classes
- Perfect hash glyph table with O(1) lookup
- LRU cache with numeric FNV-1a keys for sub-microsecond hot layouts
- Bidi/RTL reordering (UAX#9) with stack-based embedding levels
- Text shaping with flat trie ligature substitution (fi, fl, ff, ffi, ffl)
- Pair-wise kerning via FNV-1a hash table
- Liang-style hyphenation with soft-hyphen support
- Text alignment: left, center, right, justify
- Truncation with ellipsis (end, middle, start modes)
- Text decoration (underline, strikethrough, overline) with SoA bitflags
- Vertical writing modes (vertical-rl, vertical-lr)
- Hit testing and selection range API with binary search
- Inline element support via U+FFFC sentinel
- Font fallback chain with sorted interval binary search
- Real OpenType font metrics (cmap, hmtx, head, hhea table parsing)
- React, Vue, Svelte bindings using real ZeroEngine
- ZTB binary format for compiled layout data
- Flow plugin for text wrapping around obstacles
- WASM SIMD acceleration (Rust)
- WebGPU compute shader batch layout
- Vite, Webpack, Rollup build plugins
- ASCII width cache for hash-free glyph lookup on codepoints 0-127

### Performance
- Cold layout: 5.6us (target <8us)
- Hot layout: 0.1us / 100ns (target <1us)
- Zero GC pauses via arena pooling + generational buffering
