#[cfg(target_arch = "wasm32")]
use core::arch::wasm32::*;

#[cfg(target_arch = "wasm32")]
#[target_feature(enable = "simd128")]
pub fn simd_binary_search(prefix_sums: &[f32], targets: [f32; 4]) -> [u32; 4] {
    let n = prefix_sums.len() as u32;
    let mut lo = u32x4_splat(0);
    let mut hi = u32x4_splat(n);

    let target_vec = f32x4(targets[0], targets[1], targets[2], targets[3]);

    let mut iterations = 0u32;
    let max_iter = 32;

    loop {
        let lo_vals: [u32; 4] = unsafe { core::mem::transmute(lo) };
        let hi_vals: [u32; 4] = unsafe { core::mem::transmute(hi) };

        if (lo_vals[0] >= hi_vals[0])
            && (lo_vals[1] >= hi_vals[1])
            && (lo_vals[2] >= hi_vals[2])
            && (lo_vals[3] >= hi_vals[3])
        {
            break;
        }

        if iterations >= max_iter {
            break;
        }
        iterations += 1;

        let diff = u32x4_sub(hi, lo);
        let half = u32x4_shr(diff, 1);
        let mid = u32x4_add(lo, half);

        let mid_vals: [u32; 4] = unsafe { core::mem::transmute(mid) };

        let ps0 = if mid_vals[0] < n { prefix_sums[mid_vals[0] as usize] } else { f32::MAX };
        let ps1 = if mid_vals[1] < n { prefix_sums[mid_vals[1] as usize] } else { f32::MAX };
        let ps2 = if mid_vals[2] < n { prefix_sums[mid_vals[2] as usize] } else { f32::MAX };
        let ps3 = if mid_vals[3] < n { prefix_sums[mid_vals[3] as usize] } else { f32::MAX };

        let ps_vec = f32x4(ps0, ps1, ps2, ps3);
        let cmp = f32x4_le(ps_vec, target_vec);

        let one = u32x4_splat(1);
        let mid_plus_one = u32x4_add(mid, one);

        lo = v128_bitselect(mid_plus_one, lo, cmp);
        hi = v128_bitselect(hi, mid, cmp);
    }

    unsafe { core::mem::transmute(lo) }
}

#[cfg(not(target_arch = "wasm32"))]
pub fn simd_binary_search(prefix_sums: &[f32], targets: [f32; 4]) -> [u32; 4] {
    let mut results = [0u32; 4];
    for i in 0..4 {
        let mut lo = 0usize;
        let mut hi = prefix_sums.len();
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            if prefix_sums[mid] <= targets[i] {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        results[i] = lo as u32;
    }
    results
}

#[cfg(target_arch = "wasm32")]
#[target_feature(enable = "simd128")]
pub fn simd_prefix_sum(values: &[f32], out: &mut [f32]) -> usize {
    let len = values.len().min(out.len());
    let chunks = len / 4;
    let mut running = f32x4_splat(0.0);

    for i in 0..chunks {
        let base = i * 4;
        let v = f32x4(
            values[base],
            values[base + 1],
            values[base + 2],
            values[base + 3],
        );

        let s1 = f32x4_add(v, i32x4_shuffle::<4, 0, 1, 2>(f32x4_splat(0.0), v));
        let s2 = f32x4_add(s1, i32x4_shuffle::<4, 4, 0, 1>(f32x4_splat(0.0), s1));

        let last = f32x4_extract_lane::<3>(running);
        let offset = f32x4_splat(last);
        let result = f32x4_add(s2, offset);

        out[base] = f32x4_extract_lane::<0>(result);
        out[base + 1] = f32x4_extract_lane::<1>(result);
        out[base + 2] = f32x4_extract_lane::<2>(result);
        out[base + 3] = f32x4_extract_lane::<3>(result);

        running = result;
    }

    let rem_base = chunks * 4;
    let mut last = if rem_base > 0 { out[rem_base - 1] } else { 0.0 };
    for i in rem_base..len {
        last += values[i];
        out[i] = last;
    }

    len
}

#[cfg(not(target_arch = "wasm32"))]
pub fn simd_prefix_sum(values: &[f32], out: &mut [f32]) -> usize {
    let len = values.len().min(out.len());
    let mut accum = 0.0f32;
    for i in 0..len {
        accum += values[i];
        out[i] = accum;
    }
    len
}

#[cfg(target_arch = "wasm32")]
#[target_feature(enable = "simd128")]
pub fn simd_pack_bitfield(breakpoints: [u32; 4], widths: [f32; 4]) -> [u32; 4] {
    let bp_vec = i32x4(
        breakpoints[0] as i32,
        breakpoints[1] as i32,
        breakpoints[2] as i32,
        breakpoints[3] as i32,
    );
    let shifted = i32x4_shl(bp_vec, 16);

    let w_clamped = [
        (widths[0].min(65535.0) as u32) & 0xFFFF,
        (widths[1].min(65535.0) as u32) & 0xFFFF,
        (widths[2].min(65535.0) as u32) & 0xFFFF,
        (widths[3].min(65535.0) as u32) & 0xFFFF,
    ];

    let w_vec = i32x4(
        w_clamped[0] as i32,
        w_clamped[1] as i32,
        w_clamped[2] as i32,
        w_clamped[3] as i32,
    );

    let packed = v128_or(shifted, w_vec);
    unsafe { core::mem::transmute(packed) }
}

#[cfg(not(target_arch = "wasm32"))]
pub fn simd_pack_bitfield(breakpoints: [u32; 4], widths: [f32; 4]) -> [u32; 4] {
    let mut packed = [0u32; 4];
    for i in 0..4 {
        let truncated = (widths[i].min(65535.0) as u32) & 0xFFFF;
        packed[i] = (breakpoints[i] << 16) | truncated;
    }
    packed
}

#[cfg(target_arch = "wasm32")]
#[target_feature(enable = "simd128")]
pub fn simd_prefix_sum_search(prefix_sums: &[f32], target: f32) -> u32 {
    let targets = [target, f32::MAX, f32::MAX, f32::MAX];
    let results = simd_binary_search(prefix_sums, targets);
    results[0]
}

#[cfg(not(target_arch = "wasm32"))]
pub fn simd_prefix_sum_search(prefix_sums: &[f32], target: f32) -> u32 {
    let mut lo = 0usize;
    let mut hi = prefix_sums.len();
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
