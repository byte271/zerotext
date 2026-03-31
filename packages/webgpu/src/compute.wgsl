struct Params {
    num_queries: u32,
    num_elements: u32,
    _pad0: u32,
    _pad1: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> prefix_sums: array<f32>;
@group(0) @binding(2) var<storage, read> container_widths: array<f32>;
@group(0) @binding(3) var<storage, read_write> break_indices: array<u32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= params.num_queries) {
        return;
    }

    let target = container_widths[idx];
    let n = params.num_elements;

    var lo: u32 = 0u;
    var hi: u32 = n;

    loop {
        if (lo >= hi) {
            break;
        }
        let mid = lo + (hi - lo) / 2u;
        if (prefix_sums[mid] <= target) {
            lo = mid + 1u;
        } else {
            hi = mid;
        }
    }

    break_indices[idx] = lo;
}
