mod simd;

use wasm_bindgen::prelude::*;

static GLYPH_WIDTHS: [f32; 128] = {
    let mut table = [0.0f32; 128];
    let mut i = 0;
    while i < 128 {
        table[i] = match i {
            0..=31 => 0.0,
            32 => 4.0,
            33..=47 => 6.0,
            48..=57 => 8.0,
            65..=90 => 10.0,
            97..=122 => 8.0,
            _ => 6.0,
        };
        i += 1;
    }
    table
};

#[wasm_bindgen]
pub fn glyph_width(codepoint: u32) -> f32 {
    if codepoint < 128 {
        GLYPH_WIDTHS[codepoint as usize]
    } else {
        10.0
    }
}

#[wasm_bindgen]
pub fn prefix_sum_search(prefix_sums: &[f32], target: f32) -> u32 {
    let len = prefix_sums.len();
    if len == 0 {
        return 0;
    }

    if len >= 16 {
        return simd::simd_prefix_sum_search(prefix_sums, target);
    }

    let mut lo: usize = 0;
    let mut hi: usize = len;
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        if prefix_sums[mid] <= target {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    lo as u32
}

#[wasm_bindgen]
pub fn batch_find_breakpoints(
    prefix_sums: &[f32],
    container_widths: &[f32],
    out_breakpoints: &mut [u32],
) -> u32 {
    let count = container_widths.len().min(out_breakpoints.len());
    let chunks = count / 4;
    let remainder = count % 4;

    for chunk in 0..chunks {
        let base = chunk * 4;
        let widths = [
            container_widths[base],
            container_widths[base + 1],
            container_widths[base + 2],
            container_widths[base + 3],
        ];
        let results = simd::simd_binary_search(prefix_sums, widths);
        out_breakpoints[base] = results[0];
        out_breakpoints[base + 1] = results[1];
        out_breakpoints[base + 2] = results[2];
        out_breakpoints[base + 3] = results[3];
    }

    let rem_base = chunks * 4;
    for i in 0..remainder {
        out_breakpoints[rem_base + i] = prefix_sum_search(prefix_sums, container_widths[rem_base + i]);
    }

    count as u32
}

#[wasm_bindgen]
pub fn batch_layout(
    text_bytes: &[u8],
    container_widths: &[f32],
    offsets: &[u32],
    out_packed: &mut [u32],
) -> u32 {
    let block_count = offsets.len().saturating_sub(1).min(container_widths.len());
    if block_count == 0 {
        return 0;
    }

    let chunks = block_count / 4;
    let remainder = block_count % 4;

    for chunk in 0..chunks {
        let base = chunk * 4;
        let mut results = [0u32; 4];
        let mut widths_accum = [0.0f32; 4];

        for lane in 0..4 {
            let idx = base + lane;
            let start = offsets[idx] as usize;
            let end = offsets[idx + 1] as usize;
            let max_w = container_widths[idx];
            let mut accum = 0.0f32;
            let mut bp: u32 = (end - start) as u32;

            for j in start..end {
                let w = if j < text_bytes.len() {
                    glyph_width(text_bytes[j] as u32)
                } else {
                    0.0
                };
                accum += w;
                if accum > max_w {
                    bp = (j - start) as u32;
                    break;
                }
            }

            widths_accum[lane] = accum;
            results[lane] = bp;
        }

        let packed = simd::simd_pack_bitfield(results, widths_accum);
        for lane in 0..4 {
            out_packed[base + lane] = packed[lane];
        }
    }

    let rem_base = chunks * 4;
    for i in 0..remainder {
        let idx = rem_base + i;
        let start = offsets[idx] as usize;
        let end = offsets[idx + 1] as usize;
        let max_w = container_widths[idx];
        let mut accum = 0.0f32;
        let mut bp: u32 = (end - start) as u32;

        for j in start..end {
            let w = if j < text_bytes.len() {
                glyph_width(text_bytes[j] as u32)
            } else {
                0.0
            };
            accum += w;
            if accum > max_w {
                bp = (j - start) as u32;
                break;
            }
        }

        let truncated = (accum.min(65535.0) as u32) & 0xFFFF;
        out_packed[idx] = (bp << 16) | truncated;
    }

    block_count as u32
}

#[wasm_bindgen]
pub fn compute_prefix_sums(text_bytes: &[u8], out_sums: &mut [f32]) -> u32 {
    let len = text_bytes.len().min(out_sums.len());
    if len == 0 {
        return 0;
    }

    let mut accum = 0.0f32;
    for i in 0..len {
        accum += glyph_width(text_bytes[i] as u32);
        out_sums[i] = accum;
    }

    len as u32
}
