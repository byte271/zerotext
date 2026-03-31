interface ZeroTextEngine {
  layout(text: string, options: any): any;
}

type Shape =
  | { type: "circle"; cx: number; cy: number; r: number }
  | { type: "rect"; x: number; y: number; width: number; height: number }
  | { type: "polygon"; points: [number, number][] };

interface ObstacleOptions {
  padding?: number;
  side?: "left" | "right" | "both";
}

interface Obstacle {
  id: string;
  shape: Shape;
  options: ObstacleOptions;
  bitmap: Uint8Array;
}

interface FlowPlugin {
  addObstacle(config: Shape & ObstacleOptions): string;
  updateObstacle(id: string, config: Partial<Shape> & ObstacleOptions): void;
  removeObstacle(id: string): void;
  clearObstacles(): void;
  query(y: number): number;
  getBitmap(): Uint8Array;
  setContainerSize(width: number, height: number): void;
}

function rasterizeShape(
  shape: Shape,
  containerWidth: number,
  containerHeight: number,
  options: ObstacleOptions
): Uint8Array {
  const bitmap = new Uint8Array(containerHeight);
  bitmap.fill(containerWidth);
  const padding = options.padding ?? 0;
  const side = options.side ?? "both";

  if (shape.type === "circle") {
    const minY = Math.max(0, Math.floor(shape.cy - shape.r - padding));
    const maxY = Math.min(containerHeight - 1, Math.ceil(shape.cy + shape.r + padding));

    for (let y = minY; y <= maxY; y++) {
      const dy = y - shape.cy;
      const dxSq = (shape.r + padding) * (shape.r + padding) - dy * dy;
      if (dxSq < 0) continue;
      const dx = Math.sqrt(dxSq);
      const leftEdge = shape.cx - dx;
      const rightEdge = shape.cx + dx;
      const obstacleWidth = rightEdge - leftEdge;

      if (side === "left") {
        bitmap[y] = Math.max(0, containerWidth - Math.ceil(obstacleWidth));
      } else if (side === "right") {
        bitmap[y] = Math.max(0, Math.floor(leftEdge));
      } else {
        bitmap[y] = Math.max(0, containerWidth - Math.ceil(obstacleWidth));
      }
    }
  } else if (shape.type === "rect") {
    const minY = Math.max(0, Math.floor(shape.y - padding));
    const maxY = Math.min(containerHeight - 1, Math.ceil(shape.y + shape.height + padding));
    const obstacleWidth = shape.width + padding * 2;

    for (let y = minY; y <= maxY; y++) {
      if (side === "left") {
        bitmap[y] = Math.max(0, containerWidth - Math.ceil(obstacleWidth));
      } else if (side === "right") {
        bitmap[y] = Math.max(0, Math.floor(shape.x - padding));
      } else {
        bitmap[y] = Math.max(0, containerWidth - Math.ceil(obstacleWidth));
      }
    }
  } else if (shape.type === "polygon") {
    const points = shape.points;
    if (points.length < 3) return bitmap;

    let polyMinY = Infinity;
    let polyMaxY = -Infinity;
    for (const [, py] of points) {
      polyMinY = Math.min(polyMinY, py);
      polyMaxY = Math.max(polyMaxY, py);
    }

    const minY = Math.max(0, Math.floor(polyMinY - padding));
    const maxY = Math.min(containerHeight - 1, Math.ceil(polyMaxY + padding));

    for (let y = minY; y <= maxY; y++) {
      const intersections: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        const [x1, y1] = points[i];
        const [x2, y2] = points[j];

        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
          const t = (y - y1) / (y2 - y1);
          intersections.push(x1 + t * (x2 - x1));
        }
      }

      intersections.sort((a, b) => a - b);

      if (intersections.length >= 2) {
        const leftEdge = intersections[0] - padding;
        const rightEdge = intersections[intersections.length - 1] + padding;
        const obstacleWidth = rightEdge - leftEdge;

        if (side === "left") {
          bitmap[y] = Math.max(0, containerWidth - Math.ceil(obstacleWidth));
        } else if (side === "right") {
          bitmap[y] = Math.max(0, Math.floor(leftEdge));
        } else {
          bitmap[y] = Math.max(0, containerWidth - Math.ceil(obstacleWidth));
        }
      }
    }
  }

  return bitmap;
}

function mergeBitmaps(obstacles: Map<string, Obstacle>, containerWidth: number, containerHeight: number): Uint8Array {
  const merged = new Uint8Array(containerHeight);
  merged.fill(containerWidth);

  for (const obstacle of obstacles.values()) {
    const len = Math.min(obstacle.bitmap.length, containerHeight);
    for (let y = 0; y < len; y++) {
      merged[y] = Math.min(merged[y], obstacle.bitmap[y]);
    }
  }

  return merged;
}

export function createFlowPlugin(
  engine: ZeroTextEngine,
  config?: { width?: number; height?: number }
): FlowPlugin {
  const obstacles = new Map<string, Obstacle>();
  let containerWidth = config?.width ?? 800;
  let containerHeight = config?.height ?? 1024;
  let cachedBitmap: Uint8Array | null = null;
  let nextId = 0;

  function invalidateCache() {
    cachedBitmap = null;
  }

  function ensureBitmap(): Uint8Array {
    if (!cachedBitmap) {
      cachedBitmap = mergeBitmaps(obstacles, containerWidth, containerHeight);
    }
    return cachedBitmap;
  }

  return {
    addObstacle(config: Shape & ObstacleOptions): string {
      const id = `obstacle_${nextId++}`;
      const { padding, side, ...shapeProps } = config as any;
      const shape = shapeProps as Shape;
      const options: ObstacleOptions = { padding, side };
      const bitmap = rasterizeShape(shape, containerWidth, containerHeight, options);
      obstacles.set(id, { id, shape, options, bitmap });
      invalidateCache();
      return id;
    },

    updateObstacle(id: string, update: Partial<Shape> & ObstacleOptions) {
      const existing = obstacles.get(id);
      if (!existing) return;
      const { padding, side, ...shapeProps } = update as any;
      const shape = { ...existing.shape, ...shapeProps } as Shape;
      const options = {
        padding: padding ?? existing.options.padding,
        side: side ?? existing.options.side
      };
      const bitmap = rasterizeShape(shape, containerWidth, containerHeight, options);
      obstacles.set(id, { id, shape, options, bitmap });
      invalidateCache();
    },

    removeObstacle(id: string) {
      obstacles.delete(id);
      invalidateCache();
    },

    clearObstacles() {
      obstacles.clear();
      invalidateCache();
    },

    query(y: number): number {
      const bitmap = ensureBitmap();
      const index = Math.max(0, Math.min(Math.floor(y), containerHeight - 1));
      return bitmap[index];
    },

    getBitmap(): Uint8Array {
      return ensureBitmap();
    },

    setContainerSize(width: number, height: number) {
      containerWidth = width;
      containerHeight = height;
      for (const [, obstacle] of obstacles) {
        obstacle.bitmap = rasterizeShape(obstacle.shape, containerWidth, containerHeight, obstacle.options);
      }
      invalidateCache();
    },
  };
}

export { rasterizeShape };

export type {
  ZeroTextEngine,
  Shape,
  ObstacleOptions,
  Obstacle,
  FlowPlugin,
};
