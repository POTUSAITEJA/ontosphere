// src/components/Canvas/core/structuralGroups.ts

export type StructuralGroupMap = Map<string, string>; // memberIri → groupRootIri

export interface RdfQuadLike {
  subject: { termType: string; value: string };
  predicate: { termType: string; value: string };
  object: { termType: string; value: string };
}

const RDFS_SUBCLASS_OF =
  "http://www.w3.org/2000/01/rdf-schema#subClassOf";
const RDF_REST =
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest";
const RDF_NIL =
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil";

const OWL_COLLECTION_PREDICATES = new Set([
  "http://www.w3.org/2002/07/owl#intersectionOf",
  "http://www.w3.org/2002/07/owl#unionOf",
  "http://www.w3.org/2002/07/owl#oneOf",
  "http://www.w3.org/2002/07/owl#disjointUnionOf",
  "http://www.w3.org/2002/07/owl#propertyChainAxiom",
  "http://www.w3.org/2002/07/owl#hasKey",
]);
// TODO: extend subclass grouping to rdfs:subPropertyOf for property hierarchies

/** Returns a map of non-root member IRIs → their group root IRI. */
export function computeStructuralGroups(
  allQuads: readonly RdfQuadLike[],
): StructuralGroupMap {
  // ── 1. Build indexes ────────────────────────────────────────────────────────

  // subClassOf: child IRI → first parent IRI (NamedNodes only)
  const subclassParent = new Map<string, string>();

  // rdf:rest: consCell IRI → next node IRI
  const restNext = new Map<string, string>();

  // collection head: class IRI → list head IRI
  const collectionHeads: Array<{ classIri: string; headIri: string }> = [];

  for (const quad of allQuads) {
    const { subject, predicate, object } = quad;

    if (predicate.value === RDFS_SUBCLASS_OF) {
      // Only NamedNode subjects and objects
      if (
        subject.termType === "NamedNode" &&
        object.termType === "NamedNode" &&
        subject.value !== object.value
      ) {
        if (!subclassParent.has(subject.value)) {
          subclassParent.set(subject.value, object.value);
        }
      }
    } else if (predicate.value === RDF_REST) {
      if (
        subject.termType !== "DefaultGraph" &&
        subject.termType !== "Literal" &&
        object.termType !== "DefaultGraph" &&
        object.termType !== "Literal"
      ) {
        restNext.set(subject.value, object.value);
      }
    } else if (OWL_COLLECTION_PREDICATES.has(predicate.value)) {
      if (
        subject.termType === "NamedNode" &&
        object.termType !== "DefaultGraph" &&
        object.termType !== "Literal"
      ) {
        collectionHeads.push({
          classIri: subject.value,
          headIri: object.value,
        });
      }
    }
  }

  const result: StructuralGroupMap = new Map();

  // ── 2. Subclass chains ──────────────────────────────────────────────────────

  const rootCache = new Map<string, string | undefined>();

  /**
   * Walk up the subclass chain to find the transitive root.
   * Returns undefined if the node is the root (no parent) or if a cycle is
   * detected that would make the node its own root.
   */
  function findRoot(iri: string): string | undefined {
    if (rootCache.has(iri)) {
      return rootCache.get(iri);
    }

    const visited = new Set<string>();
    let current = iri;

    while (true) {
      if (visited.has(current)) {
        // Cycle detected — the starting node has no distinct root
        rootCache.set(iri, undefined);
        return undefined;
      }
      visited.add(current);

      const parent = subclassParent.get(current);
      if (parent === undefined) {
        // current IS the root
        rootCache.set(iri, current);
        return current;
      }
      current = parent;
    }
  }

  for (const child of subclassParent.keys()) {
    const root = findRoot(child);
    // Only map when root is different from child (child is not the root itself)
    if (root !== undefined && root !== child) {
      result.set(child, root);
    }
  }

  // ── 3. OWL collection cons-cells ────────────────────────────────────────────

  for (const { classIri, headIri } of collectionHeads) {
    const visited = new Set<string>();
    let current: string | undefined = headIri;

    while (current !== undefined && current !== RDF_NIL) {
      if (visited.has(current)) break; // cycle guard
      visited.add(current);

      // Map this cons-cell node → the owning class
      result.set(current, classIri);

      current = restNext.get(current);
    }
  }

  return result;
}
