// src/components/Canvas/layout/silentLayout.ts
/**
 * runSilentLayout — compute layout positions for a set of nodes without triggering
 * Reactodia's spinner overlay. Returns a Map from element IRI to position Vector.
 *
 * The caller is responsible for applying positions (e.g. via el.setPosition) at the
 * appropriate time. This function only computes; it never touches the canvas model.
 */
import type { LayoutFunction, LayoutGraph, LayoutState, Vector } from '@reactodia/workspace';

export interface SilentLayoutEdge {
  source: string;
  target: string;
}

export interface SilentLayoutOptions {
  sizes?: Map<string, { width: number; height: number }>;
  /** Initial positions for any node (used as starting point for free nodes). */
  seeds?: Map<string, { x: number; y: number }>;
  /** Nodes that must not move — keep their seed position exactly. */
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

  // Build LayoutGraph — use a mutable Record then cast since LayoutGraph['nodes']
  // has a readonly index signature.
  const nodesMutable: Record<string, { types: []; fixed?: boolean }> = {};
  for (const id of iris) {
    nodesMutable[id] = options?.fixed?.has(id) ? { types: [], fixed: true } : { types: [] };
  }

  const irisSet = new Set(iris);
  const links: LayoutGraph['links'] = edges
    .filter(e => irisSet.has(e.source) && irisSet.has(e.target))
    .map(e => ({ type: '' as any, source: e.source, target: e.target }));

  const graph: LayoutGraph = { nodes: nodesMutable as LayoutGraph['nodes'], links };

  // Build LayoutState with known or default sizes and optional seed positions
  const bounds: Record<string, { x: number; y: number; width: number; height: number }> = {};
  for (const id of iris) {
    const s = options?.sizes?.get(id);
    const seed = options?.seeds?.get(id);
    bounds[id] = {
      x: seed?.x ?? 0,
      y: seed?.y ?? 0,
      width: s?.width ?? 120,
      height: s?.height ?? 40,
    };
  }
  const state: LayoutState = { bounds };

  // Run layout in worker (non-blocking by construction)
  const result = await layoutFn(graph, state);

  // Convert bounds to position map (top-left corner).
  // LayoutNode.fixed is declared in the type but ignored by the layout engine at
  // runtime — manually restore fixed nodes to their seed positions afterwards.
  const positions = new Map<string, Vector>();
  for (const id of iris) {
    if (options?.fixed?.has(id) && options.seeds?.has(id)) {
      const seed = options.seeds.get(id)!;
      positions.set(id, { x: seed.x, y: seed.y });
    } else {
      const b = result.bounds[id];
      if (b) positions.set(id, { x: b.x, y: b.y });
    }
  }
  return positions;
}
