const SHADER_SOURCE = `
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
`;

export interface LayoutItem {
  prefixSums: Float32Array;
  containerWidth: number;
}

export interface LayoutResult {
  breakIndex: number;
}

export class GPULayoutEngine {
  private device: GPUDevice;
  private pipeline: GPUComputePipeline;
  private bindGroupLayout: GPUBindGroupLayout;

  private constructor(
    device: GPUDevice,
    pipeline: GPUComputePipeline,
    bindGroupLayout: GPUBindGroupLayout
  ) {
    this.device = device;
    this.pipeline = pipeline;
    this.bindGroupLayout = bindGroupLayout;
  }

  static async create(device: GPUDevice): Promise<GPULayoutEngine> {
    const shaderModule = device.createShaderModule({ code: SHADER_SOURCE });

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
      ],
    });

    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    const pipeline = device.createComputePipeline({
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: "main",
      },
    });

    return new GPULayoutEngine(device, pipeline, bindGroupLayout);
  }

  async batchLayoutGPU(items: LayoutItem[]): Promise<LayoutResult[]> {
    if (items.length === 0) {
      return [];
    }

    const numQueries = items.length;
    const numElements = items[0].prefixSums.length;

    const paramsData = new Uint32Array([numQueries, numElements, 0, 0]);
    const paramsBuffer = this.device.createBuffer({
      size: paramsData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(paramsBuffer, 0, paramsData);

    const prefixSumsBuffer = this.device.createBuffer({
      size: items[0].prefixSums.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(prefixSumsBuffer, 0, items[0].prefixSums);

    const widthsData = new Float32Array(numQueries);
    for (let i = 0; i < numQueries; i++) {
      widthsData[i] = items[i].containerWidth;
    }
    const widthsBuffer = this.device.createBuffer({
      size: widthsData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(widthsBuffer, 0, widthsData);

    const outputSize = numQueries * 4;
    const outputBuffer = this.device.createBuffer({
      size: outputSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const readbackBuffer = this.device.createBuffer({
      size: outputSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } },
        { binding: 1, resource: { buffer: prefixSumsBuffer } },
        { binding: 2, resource: { buffer: widthsBuffer } },
        { binding: 3, resource: { buffer: outputBuffer } },
      ],
    });

    const commandEncoder = this.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatchWorkgroups(Math.ceil(numQueries / 256));
    passEncoder.end();

    commandEncoder.copyBufferToBuffer(
      outputBuffer,
      0,
      readbackBuffer,
      0,
      outputSize
    );

    this.device.queue.submit([commandEncoder.finish()]);

    await readbackBuffer.mapAsync(GPUMapMode.READ);
    const resultArray = new Uint32Array(readbackBuffer.getMappedRange().slice(0));
    readbackBuffer.unmap();

    const results: LayoutResult[] = new Array(numQueries);
    for (let i = 0; i < numQueries; i++) {
      results[i] = { breakIndex: resultArray[i] };
    }

    paramsBuffer.destroy();
    prefixSumsBuffer.destroy();
    widthsBuffer.destroy();
    outputBuffer.destroy();
    readbackBuffer.destroy();

    return results;
  }

  destroy(): void {
    this.device.destroy();
  }
}

export async function initWebGPU(): Promise<GPUDevice> {
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });

  if (!adapter) {
    throw new Error("WebGPU adapter not available");
  }

  const device = await adapter.requestDevice();

  device.lost.then((info) => {
    if (info.reason !== "destroyed") {
      throw new Error(`WebGPU device lost: ${info.message}`);
    }
  });

  return device;
}

export async function batchLayoutGPU(
  items: LayoutItem[]
): Promise<LayoutResult[]> {
  const device = await initWebGPU();
  const engine = await GPULayoutEngine.create(device);

  try {
    return await engine.batchLayoutGPU(items);
  } finally {
    engine.destroy();
  }
}
