// src/components/Canvas/layout/silentLayout.ts
/**
 * runSilentLayout — compute layout positions for a set of nodes without triggering
 * Reactodia's spinner overlay. Returns a Map from element IRI to position Vector.
 *
 * Fixed nodes are NOT passed to the layout engine — they return their seed positions
 * unchanged. Free nodes are passed to the engine with seeds as initial bounds.
 * This works with any layout engine regardless of native fixed-node support.
 */
import type { LayoutFunction, LayoutGraph, Vector } from '@reactodia/workspace';

export interface SilentLayoutEdge {
  source: string;
  target: string;
}

export interface SilentLayoutOptions {
  sizes?: Map<string, { width: number; height: number }>;
  /** Initial positions used as starting bounds for free nodes, and as final positions for fixed nodes. */
  seeds?: Map<string, { x: number; y: number }>;
  /** Nodes whose positions must not change — returned at their seed position, not passed to the engine. */
  fixed?: Set<string>;
}

/**
 * @param layoutFn  - Any LayoutFunction (Dagre worker, ELK worker, etc.)
 * @param iris      - All element IRIs to lay out
 * @param edges     - Edges between those elements
 * @param options   - Optional sizes, seed positions, and fixed-node set
 * @returns         - Map from IRI → {x, y} top-left position
 */
export async function runSilentLayout(
  layoutFn: LayoutFunction,
  iris: string[],
  edges: SilentLayoutEdge[],
  options?: SilentLayoutOptions
): Promise<Map<string, Vector>> {
  if (iris.length === 0) return new Map();

  const positions = new Map<string, Vector>();

  // Pass 1: fixed nodes — returned at seed positions, never passed to the engine.
  const freeIris: string[] = [];
  for (const id of iris) {
    if (options?.fixed?.has(id)) {
      const seed = options.seeds?.get(id);
      if (seed) positions.set(id, { x: seed.x, y: seed.y });
    } else {
      freeIris.push(id);
    }
  }

  if (freeIris.length === 0) return positions;

  // Pass 2: free nodes — run through the layout engine.
  // Edges involving fixed nodes are filtered out (fixed nodes aren't in the graph).
  const freeSet = new Set(freeIris);

  const nodesMutable: Record<string, { types: [] }> = {};
  for (const id of freeIris) {
    nodesMutable[id] = { types: [] };
  }

  const links: LayoutGraph['links'] = edges
    .filter(e => freeSet.has(e.source) && freeSet.has(e.target))
    .map(e => ({ type: '' as any, source: e.source, target: e.target }));

  const graph: LayoutGraph = { nodes: nodesMutable as LayoutGraph['nodes'], links };

  const bounds: Record<string, { x: number; y: number; width: number; height: number }> = {};
  for (const id of freeIris) {
    const s = options?.sizes?.get(id);
    const seed = options?.seeds?.get(id);
    bounds[id] = {
      x: seed?.x ?? 0,
      y: seed?.y ?? 0,
      width: s?.width ?? 120,
      height: s?.height ?? 40,
    };
  }

  const result = await layoutFn(graph, { bounds });

  for (const id of freeIris) {
    const b = result.bounds[id];
    if (b) positions.set(id, { x: b.x, y: b.y });
  }

  return positions;
}
