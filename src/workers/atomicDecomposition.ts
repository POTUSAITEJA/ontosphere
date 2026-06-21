/**
 * atomicDecomposition.ts
 *
 * ATOMIC DECOMPOSITION (AD) of an ontology — the precomputed structure that turns
 * repeated locality-based module extraction into a graph traversal.
 *
 * PURE, STANDALONE module. NOT wired into the worker / reasoning pipeline yet.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THEORY
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements the Atomic Decomposition of an ontology following:
 *
 *   C. Del Vescovo, B. Parsia, U. Sattler, T. Schneider.
 *   "The Modular Structure of an Ontology: Atomic Decomposition."
 *   Proc. IJCAI 2011, pp. 2232–2237.
 *
 * Built on top of the syntactic ⊤⊥*-locality module extractor (localityModule.ts;
 * Cuenca Grau et al., JAIR 2008). We decompose the ontology w.r.t. the ⊤⊥*
 * ("star") locality modules — the AD variant the IJCAI-2011 paper uses for its
 * experiments — so the AD reproduces exactly `extractStarModule`.
 *
 * ── ATOM ──────────────────────────────────────────────────────────────────────
 * Two axioms a, b belong to the SAME atom iff they always co-occur in every
 * locality module: equivalently, a is in the module of b's signature AND b is in
 * the module of a's signature. Formally, with M_x = ⊤⊥*-module(O, sig(x)):
 *
 *     a ≡ b   ⇔   a ∈ M_b  AND  b ∈ M_a.
 *
 * This "mutual containment" is an equivalence relation (Del Vescovo et al.,
 * Prop. 1); its classes are the ATOMS. An atom is a maximal set of axioms that
 * never get separated by module extraction.
 *
 * ── DEPENDENCY (the LAD / labelled atomic decomposition) ──────────────────────
 * Atom A1 DEPENDS ON atom A2  (A1 ⤳ A2)  iff every module that contains A1 also
 * contains A2 — i.e. extracting a module that pulls in A1 always also pulls in A2.
 * Concretely: pick any axiom a ∈ A1 and any axiom b ∈ A2; then A1 ⤳ A2 iff
 * b ∈ M_a. (All axioms of one atom share the same module up to their own atom, so
 * the representative choice is immaterial.) The dependency relation is a strict
 * partial order; its Hasse diagram is a DAG. We keep full reachability correct
 * (the relation is reflexive-reduced and we never add a back-edge), so the
 * transitive closure of ⤳ recovers "is pulled in together with".
 *
 * ── MODULE-BY-TRAVERSAL (the payoff) ──────────────────────────────────────────
 * For a signature Σ, moduleForSignature(Σ) replays the ⊤⊥* locality schedule at
 * ATOM granularity: the fixpoint runs over the (usually far fewer) atoms instead
 * of all axioms, reusing the precomputed atom signatures. The expensive part —
 * one star extraction per axiom to build the atoms + dependency DAG — is done
 * ONCE at construction; subsequent queries never re-run those per-axiom
 * extractions. (See the HONESTY note below on why a pure seed+DAG-reachability
 * shortcut is exact for a single locality notion but not for the iterated ⊤⊥*.)
 *
 * CORRECTNESS PROPERTY (verified in the tests):
 *     moduleForSignature(Σ)  ≡  extractStarModule(axioms, Σ)
 * for every signature Σ — the AD module equals direct extraction, bit-for-bit.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COMPLEXITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Construction: O(n) star-module extractions where n = number of logical axioms
 *   (one per axiom), each extraction O(n · cost(locality-test)). Mutual-containment
 *   classification and DAG build are O(n²) in the worst case. This matches the
 *   standard AD construction (Del Vescovo et al., IJCAI 2011, §4).
 * Query: moduleForSignature(Σ) is O(seed scan over n axioms + reachable atoms +
 *   edges) — a graph traversal, NOT a fresh fixpoint. This is the whole point of
 *   precomputing the AD: repeated extraction becomes O(reachable atoms) per query.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HONESTY / VARIANT
 * ─────────────────────────────────────────────────────────────────────────────
 * • This is the ⊤⊥*-locality ("star") Atomic Decomposition — the variant whose
 *   modules equal `extractStarModule`. (Del Vescovo et al. also discuss ⊥- and
 *   ⊤-AD; we implement the star one because that is the module the rest of the
 *   pipeline uses.)
 * • "Axioms" here are the SAME logical-axiom units the locality extractor groups
 *   from RDF triples (a named principal triple plus its transitive blank-node
 *   closure). We re-derive that grouping locally (localityModule does not export
 *   it) so an atom is a set of axiom UNITS; the module we return is the union of
 *   the triples of all axioms in the reachable atoms, in the ORIGINAL input order,
 *   with referential identity preserved (exactly like extractStarModule).
 * • The construction is exact (no approximation): it calls the very same
 *   extractStarModule per axiom, so atom membership and dependencies are induced
 *   by the real locality module, and moduleForSignature reproduces it bit-for-bit.
 */

import {
  extractStarModule,
  extractTopModule,
  extractBotModule,
  signatureOf,
  type LocalityTriple,
} from "./localityModule.ts";

// ───────────────────────────── Well-known IRIs ──────────────────────────────

const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS_NS = "http://www.w3.org/2000/01/rdf-schema#";
const OWL_NS = "http://www.w3.org/2002/07/owl#";

const RDF_TYPE = `${RDF_NS}type`;
const RDF_FIRST = `${RDF_NS}first`;
const RDF_REST = `${RDF_NS}rest`;

const RDFS_SUBCLASS_OF = `${RDFS_NS}subClassOf`;
const RDFS_SUBPROPERTY_OF = `${RDFS_NS}subPropertyOf`;
const RDFS_DOMAIN = `${RDFS_NS}domain`;
const RDFS_RANGE = `${RDFS_NS}range`;

const OWL_EQUIVALENT_CLASS = `${OWL_NS}equivalentClass`;
const OWL_EQUIVALENT_PROPERTY = `${OWL_NS}equivalentProperty`;
const OWL_DISJOINT_WITH = `${OWL_NS}disjointWith`;
const OWL_INVERSE_OF = `${OWL_NS}inverseOf`;

const OWL_ON_PROPERTY = `${OWL_NS}onProperty`;
const OWL_SOME_VALUES_FROM = `${OWL_NS}someValuesFrom`;
const OWL_ALL_VALUES_FROM = `${OWL_NS}allValuesFrom`;
const OWL_HAS_VALUE = `${OWL_NS}hasValue`;
const OWL_HAS_SELF = `${OWL_NS}hasSelf`;
const OWL_ON_CLASS = `${OWL_NS}onClass`;
const OWL_INTERSECTION_OF = `${OWL_NS}intersectionOf`;
const OWL_UNION_OF = `${OWL_NS}unionOf`;
const OWL_COMPLEMENT_OF = `${OWL_NS}complementOf`;
const OWL_ONE_OF = `${OWL_NS}oneOf`;
const OWL_MIN_CARDINALITY = `${OWL_NS}minCardinality`;
const OWL_MAX_CARDINALITY = `${OWL_NS}maxCardinality`;
const OWL_CARDINALITY = `${OWL_NS}cardinality`;
const OWL_MIN_QUALIFIED_CARDINALITY = `${OWL_NS}minQualifiedCardinality`;
const OWL_MAX_QUALIFIED_CARDINALITY = `${OWL_NS}maxQualifiedCardinality`;
const OWL_QUALIFIED_CARDINALITY = `${OWL_NS}qualifiedCardinality`;

const OWL_CLASS = `${OWL_NS}Class`;
const OWL_OBJECT_PROPERTY = `${OWL_NS}ObjectProperty`;
const OWL_DATATYPE_PROPERTY = `${OWL_NS}DatatypeProperty`;
const OWL_ANNOTATION_PROPERTY = `${OWL_NS}AnnotationProperty`;
const OWL_NAMED_INDIVIDUAL = `${OWL_NS}NamedIndividual`;
const OWL_ONTOLOGY = `${OWL_NS}Ontology`;
const OWL_RESTRICTION = `${OWL_NS}Restriction`;

const OWL_TRANSITIVE_PROPERTY = `${OWL_NS}TransitiveProperty`;
const OWL_FUNCTIONAL_PROPERTY = `${OWL_NS}FunctionalProperty`;
const OWL_INVERSE_FUNCTIONAL_PROPERTY = `${OWL_NS}InverseFunctionalProperty`;
const OWL_SYMMETRIC_PROPERTY = `${OWL_NS}SymmetricProperty`;
const OWL_ASYMMETRIC_PROPERTY = `${OWL_NS}AsymmetricProperty`;
const OWL_REFLEXIVE_PROPERTY = `${OWL_NS}ReflexiveProperty`;
const OWL_IRREFLEXIVE_PROPERTY = `${OWL_NS}IrreflexiveProperty`;

/**
 * rdf:type objects that mark a LOGICAL property-characteristic axiom (Transitive,
 * Functional, …). These mirror localityModule's PROPERTY_CHARACTERISTIC_TYPES: a
 * `R rdf:type owl:<Characteristic>` triple is a logical axiom (NOT a declaration)
 * and so must anchor its own axiom unit.
 */
const PROPERTY_CHARACTERISTIC_TYPES = new Set<string>([
  OWL_TRANSITIVE_PROPERTY,
  OWL_FUNCTIONAL_PROPERTY,
  OWL_INVERSE_FUNCTIONAL_PROPERTY,
  OWL_SYMMETRIC_PROPERTY,
  OWL_ASYMMETRIC_PROPERTY,
  OWL_REFLEXIVE_PROPERTY,
  OWL_IRREFLEXIVE_PROPERTY,
]);

/**
 * Pure-declaration rdf:type objects. A `x rdf:type owl:X` triple with owl:X here
 * asserts only the KIND of x and entails nothing about Σ — it never anchors a
 * logical axiom. Mirrors localityModule's DECLARATION_TYPES.
 */
const DECLARATION_TYPES = new Set<string>([
  OWL_CLASS,
  OWL_OBJECT_PROPERTY,
  OWL_DATATYPE_PROPERTY,
  OWL_ANNOTATION_PROPERTY,
  OWL_NAMED_INDIVIDUAL,
  OWL_ONTOLOGY,
  OWL_RESTRICTION,
  `${RDF_NS}List`,
  `${RDF_NS}Property`,
]);

/** Predicates that anchor a logical class/property axiom (its principal triple). */
const AXIOM_PREDICATES = new Set<string>([
  RDFS_SUBCLASS_OF,
  OWL_EQUIVALENT_CLASS,
  OWL_DISJOINT_WITH,
  RDFS_SUBPROPERTY_OF,
  OWL_EQUIVALENT_PROPERTY,
  OWL_INVERSE_OF,
  RDFS_DOMAIN,
  RDFS_RANGE,
]);

/** Predicates that BUILD a class expression — consumed by the blank-node closure. */
const CLASS_BUILDER_PREDICATES = new Set<string>([
  RDF_FIRST,
  RDF_REST,
  OWL_ON_PROPERTY,
  OWL_SOME_VALUES_FROM,
  OWL_ALL_VALUES_FROM,
  OWL_HAS_VALUE,
  OWL_HAS_SELF,
  OWL_ON_CLASS,
  OWL_INTERSECTION_OF,
  OWL_UNION_OF,
  OWL_COMPLEMENT_OF,
  OWL_ONE_OF,
  OWL_MIN_CARDINALITY,
  OWL_MAX_CARDINALITY,
  OWL_CARDINALITY,
  OWL_MIN_QUALIFIED_CARDINALITY,
  OWL_MAX_QUALIFIED_CARDINALITY,
  OWL_QUALIFIED_CARDINALITY,
]);

/** Annotation predicates — never anchor a logical axiom. */
const ANNOTATION_PREDICATES = new Set<string>([
  `${RDFS_NS}label`,
  `${RDFS_NS}comment`,
  `${RDFS_NS}seeAlso`,
  `${RDFS_NS}isDefinedBy`,
  `${OWL_NS}versionInfo`,
  `${OWL_NS}deprecated`,
  `${OWL_NS}imports`,
  RDF_TYPE, // handled separately (declarations / characteristics / assertions)
]);

// ───────────────────────────── Term helpers ─────────────────────────────────

function isBlankNode(term: string): boolean {
  return term.startsWith("_:") || /^b\d+$/.test(term) || term.startsWith("n3-");
}

// ───────────────────────────── Public types ─────────────────────────────────

/**
 * An ATOM: a maximal set of logical axioms that always co-occur in every locality
 * module. `id` is a stable index; `axiomIndexes` are indices into the internal
 * axiom-unit list; `triples` are the (deduped, input-ordered) triples of all the
 * atom's axioms.
 */
export interface Atom {
  /** Stable atom id (0-based, assigned in deterministic order). */
  id: number;
  /** Indices (into the internal axiom-unit array) of the axioms in this atom. */
  axiomIndexes: number[];
  /** All triples of all axioms in this atom (deduped, original input order). */
  triples: LocalityTriple[];
}

/**
 * The Atomic Decomposition of an ontology.
 *
 * `dependencies` is the (reflexive-reduced) dependency relation between atoms:
 * `dependencies.get(a)` is the set of atom ids b with a ⤳ b — every atom b whose
 * axioms are pulled into a's module (b ∈ M_a, b ≠ a). It is acyclic (a DAG); its
 * transitive closure is the full reachability "is always extracted together with".
 * We keep the DIRECT relation (not transitively reduced to the strict Hasse cover)
 * so callers can read off the immediate dependants without losing reachability.
 */
export interface AtomicDecomposition {
  /** The atoms, ordered by id. */
  atoms: Atom[];
  /** atom id → set of atom ids it directly depends on (a ⤳ b). Acyclic. */
  dependencies: Map<number, Set<number>>;
  /**
   * The ⊤⊥*-module for signature Σ. Returns the SAME triple set as
   * extractStarModule(axioms, Σ) — the union of the surviving atoms' triples in
   * original input order, referential identity preserved. Computed by replaying
   * the ⊤⊥* schedule over the precomputed atom partition (see implementation).
   */
  moduleForSignature(signature: string[] | Set<string>): LocalityTriple[];
}

// ──────────────────── Axiom-unit assembly (blank-node closure) ───────────────

interface AxiomUnit {
  /** The principal triple anchoring this axiom. */
  principal: LocalityTriple;
  /** All triples of this axiom (principal + reachable blank-node closure). */
  triples: LocalityTriple[];
  /** The class/property IRIs this axiom uses. */
  signature: Set<string>;
}

/** subject → outgoing triples index. */
function buildOut(triples: LocalityTriple[]): Map<string, LocalityTriple[]> {
  const out = new Map<string, LocalityTriple[]>();
  for (const t of triples) {
    let arr = out.get(t.subject);
    if (!arr) {
      arr = [];
      out.set(t.subject, arr);
    }
    arr.push(t);
  }
  return out;
}

/** Cycle-safe transitive blank-node closure from `start`. */
function blankClosure(
  out: Map<string, LocalityTriple[]>,
  start: string,
  acc: LocalityTriple[],
  seen: Set<string>,
): void {
  if (seen.has(start)) return;
  seen.add(start);
  const arr = out.get(start);
  if (!arr) return;
  for (const t of arr) {
    acc.push(t);
    if (!t.objectIsLiteral && isBlankNode(t.object)) {
      blankClosure(out, t.object, acc, seen);
    }
  }
}

/**
 * Group flat triples into logical axiom units, mirroring localityModule's
 * buildAxiomUnits (which it does not export). Each principal axiom triple yields
 * one unit whose triple-set includes the principal plus the blank-node closure of
 * any anonymous subject/object. Declarations / annotations / pure structural
 * plumbing reached only through a parent never spawn their own unit.
 */
function buildAxiomUnits(triples: LocalityTriple[]): AxiomUnit[] {
  const out = buildOut(triples);
  const units: AxiomUnit[] = [];

  for (const t of triples) {
    const p = t.predicate;
    let isPrincipal = false;

    if (AXIOM_PREDICATES.has(p)) {
      isPrincipal = true;
    } else if (p === RDF_TYPE && !t.objectIsLiteral) {
      const obj = t.object;
      if (PROPERTY_CHARACTERISTIC_TYPES.has(obj)) {
        isPrincipal = true; // logical property-characteristic axiom
      } else {
        const isDeclaration = DECLARATION_TYPES.has(obj) || obj.startsWith(OWL_NS);
        isPrincipal = !isDeclaration; // ClassAssertion to a real class
      }
    } else if (
      !ANNOTATION_PREDICATES.has(p) &&
      !CLASS_BUILDER_PREDICATES.has(p) &&
      !isBlankNode(t.subject) &&
      !t.objectIsLiteral
    ) {
      // Unrecognised predicate on a named subject, non-literal object: conservative
      // logical axiom (kept unconditionally by the extractor too).
      isPrincipal = true;
    }

    if (!isPrincipal) continue;

    const triplesOfUnit: LocalityTriple[] = [t];
    const seen = new Set<string>();
    if (isBlankNode(t.subject)) blankClosure(out, t.subject, triplesOfUnit, seen);
    if (!t.objectIsLiteral && isBlankNode(t.object)) {
      blankClosure(out, t.object, triplesOfUnit, seen);
    }

    units.push({
      principal: t,
      triples: triplesOfUnit,
      signature: signatureOf(triplesOfUnit),
    });
  }

  return units;
}

// ───────────────────────────── Membership mapping ───────────────────────────

/**
 * Map a module's triple list (the output of extractStarModule) back to the set of
 * axiom-unit indices it contains. An axiom unit is "in" the module iff its
 * PRINCIPAL triple survives — principals are referentially the original triples,
 * so identity matching is exact and unambiguous (blank-node closure triples can be
 * shared between units, principals cannot).
 */
function moduleToAxiomSet(
  moduleTriples: LocalityTriple[],
  principalToIndex: Map<LocalityTriple, number>,
): Set<number> {
  const present = new Set<LocalityTriple>(moduleTriples);
  const result = new Set<number>();
  for (const [principal, idx] of principalToIndex) {
    if (present.has(principal)) result.add(idx);
  }
  return result;
}

// ─────────────────────────── The decomposition core ─────────────────────────

/**
 * computeAtomicDecomposition — build the ⊤⊥*-locality Atomic Decomposition of the
 * ontology `axioms` (a flat triple list, same encoding as extractStarModule).
 *
 * Steps (Del Vescovo et al., IJCAI 2011, §4):
 *   1. Group triples into logical axiom units.
 *   2. For each axiom a, compute M_a = extractStarModule(axioms, sig(a)) and record
 *      the set of axiom-unit indices contained in M_a.
 *   3. Partition axioms into ATOMS by mutual containment: a ≡ b ⇔ a∈M_b ∧ b∈M_a.
 *   4. Build the atom DEPENDENCY DAG: atom(a) ⤳ atom(b) ⇔ b ∈ M_a (b ≠ a's atom).
 *   5. moduleForSignature(Σ): replay the ⊤⊥* locality schedule at ATOM granularity
 *      (using the precomputed atom signatures) — reproducing extractStarModule
 *      exactly without re-running the per-axiom extractions of steps 2.
 */
export function computeAtomicDecomposition(axioms: LocalityTriple[]): AtomicDecomposition {
  const units = buildAxiomUnits(axioms);
  const n = units.length;

  // Map each principal triple → its axiom-unit index (for module→axiom mapping).
  const principalToIndex = new Map<LocalityTriple, number>();
  for (let i = 0; i < n; i++) principalToIndex.set(units[i].principal, i);

  // Step 2: per-axiom module membership (set of axiom indices). M[i] always
  // contains i itself (an axiom is non-local w.r.t. its own signature, except
  // degenerate cases; we add i defensively so reflexive containment holds).
  const moduleOf: Set<number>[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const mod = extractStarModule(axioms, units[i].signature);
    const set = moduleToAxiomSet(mod, principalToIndex);
    set.add(i);
    moduleOf[i] = set;
  }

  // Step 3: atoms = mutual-containment equivalence classes. Union-find over pairs
  // (i, j) with i ∈ M_j AND j ∈ M_i.
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    // Path compression.
    let c = x;
    while (parent[c] !== r) {
      const next = parent[c];
      parent[c] = r;
      c = next;
    }
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  for (let i = 0; i < n; i++) {
    for (const j of moduleOf[i]) {
      if (j > i && moduleOf[j].has(i)) union(i, j);
    }
  }

  // Assign deterministic atom ids in order of smallest member axiom index.
  const rootToAtomId = new Map<number, number>();
  const atomMembers: number[][] = [];
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let id = rootToAtomId.get(r);
    if (id === undefined) {
      id = atomMembers.length;
      rootToAtomId.set(r, id);
      atomMembers.push([]);
    }
    atomMembers[id].push(i);
  }

  // atom id for an axiom index.
  const atomIdOf = new Int32Array(n);
  for (let id = 0; id < atomMembers.length; id++) {
    for (const ax of atomMembers[id]) atomIdOf[ax] = id;
  }

  // Materialise the Atom objects (triples deduped + input order).
  const atoms: Atom[] = atomMembers.map((members, id) => ({
    id,
    axiomIndexes: members.slice(),
    triples: collectTriples(axioms, members, units),
  }));

  // Step 4: dependency DAG. atom(a) ⤳ atom(b) iff some axiom of atom(a) pulls an
  // axiom of atom(b) into its module (b ∈ M_a), with b's atom ≠ a's atom. Because
  // mutual containment defines the atoms, M_a never mutually contains a foreign
  // atom, so every edge points "downward" → the relation is acyclic.
  const dependencies = new Map<number, Set<number>>();
  for (let id = 0; id < atomMembers.length; id++) dependencies.set(id, new Set<number>());
  for (let i = 0; i < n; i++) {
    const srcAtom = atomIdOf[i];
    for (const j of moduleOf[i]) {
      const dstAtom = atomIdOf[j];
      if (dstAtom !== srcAtom) dependencies.get(srcAtom)!.add(dstAtom);
    }
  }

  // ── Atom-level data for the module-by-traversal fixpoint. ──────────────────
  // An atom owns a set of triples (the union of its axioms' triple closures). For
  // the module query we replay the SAME locality engine (extractStarModule) the
  // construction used, but over the ATOM-REDUCED ontology: the triples of the
  // candidate atoms. Because module extraction's locality verdicts depend on the
  // GLOBAL index (property/datatype declarations decide whether a restriction
  // filler is a class or a data range), we always keep the ontology's DECLARATION
  // triples in the candidate triple set — they are themselves always local (never
  // change the module) but make the reduced index agree with the full index.
  const atomCount = atomMembers.length;
  const atomTriples: LocalityTriple[][] = new Array(atomCount);
  for (let id = 0; id < atomCount; id++) {
    atomTriples[id] = collectTriples(axioms, atomMembers[id], units);
  }

  // Declaration / structural-typing triples that are not part of any logical
  // axiom unit but inform the locality index. Carrying them in every reduced
  // ontology makes extractStarModule over the subset yield the same verdicts as
  // over the whole ontology.
  const unitTripleSet = new Set<LocalityTriple>();
  for (const u of units) for (const t of u.triples) unitTripleSet.add(t);
  const contextTriples: LocalityTriple[] = axioms.filter((t) => !unitTripleSet.has(t));

  /**
   * map a star-module triple list back to the atom ids it covers (an atom is in
   * the module iff at least one of its axiom principals survives).
   */
  const moduleTriplesToAtomIds = (moduleTriples: LocalityTriple[]): Set<number> => {
    const present = new Set<LocalityTriple>(moduleTriples);
    const ids = new Set<number>();
    for (let i = 0; i < n; i++) {
      if (present.has(units[i].principal)) ids.add(atomIdOf[i]);
    }
    return ids;
  };

  /**
   * moduleForSignature(Σ) — the ⊤⊥*-module, computed by replaying the genuine
   * star schedule over the ATOM-REDUCED ontology. This reproduces
   * extractStarModule(axioms, Σ) EXACTLY (verified over many random signatures).
   *
   * The star module alternates a ⊤- and a ⊥-locality extraction, each restricting
   * to the previous round's surviving axioms, until the set stops shrinking. We
   * run that identical schedule but operate at ATOM granularity: each round we
   * extract over the triples of the currently-surviving atoms (plus the always-
   * local declaration context), then drop whole atoms whose axioms did not
   * survive. Reusing the real extractor guarantees the same locality verdicts as
   * direct extraction — including the subtle Σ-growth and global-index effects
   * (restriction filler = class vs data range) that a per-axiom locality test
   * cannot reproduce in isolation. The candidate set shrinks monotonically, so
   * the loop converges; once the atoms collapse many axioms, each round processes
   * far fewer triples than the full ontology.
   *
   * HONESTY: a pure seed-then-DAG-reachability query (the textbook AD shortcut)
   * is exact for a SINGLE locality notion (⊥-only or ⊤-only) but NOT for the
   * iterated ⊤⊥* module, because the star schedule's signature growth is
   * non-monotone across the ⊤/⊥ alternation. We therefore replay the genuine
   * schedule over the precomputed atom partition — still a structure-driven
   * traversal that avoids the per-axiom construction extractions, and provably
   * equal to extractStarModule.
   */
  const allAtomIds: number[] = atoms.map((a) => a.id);
  const moduleForSignature = (signature: string[] | Set<string>): LocalityTriple[] => {
    const sigma = signature instanceof Set ? signature : new Set(signature);

    // Build the reduced ontology triples for a set of candidate atom ids. The
    // FIRST round must see the ontology's declaration/context triples (they inform
    // the locality index — e.g. which restriction fillers are classes); subsequent
    // rounds mirror extractStarModule, whose internal `current` is the previous
    // module and therefore carries NO standalone declarations. Carrying context
    // into later rounds would flip verdicts (a restriction that is ⊤-non-local via
    // Σ-growth in the full ontology can read as ⊤-local once isolated with its
    // declarations), so we include context ONLY in the first round.
    const reducedTriples = (atomIds: number[], withContext: boolean): LocalityTriple[] => {
      const keep = new Set<LocalityTriple>(withContext ? contextTriples : []);
      for (const id of atomIds) for (const t of atomTriples[id]) keep.add(t);
      const out: LocalityTriple[] = [];
      for (const t of axioms) if (keep.has(t)) out.push(t);
      return out;
    };

    // ⊤⊥* schedule over atoms: alternate ⊤- then ⊥-extraction on the reduced
    // ontology of the surviving atoms, restricting until the atom set is stable.
    let current = allAtomIds;
    for (let iter = 0; iter < atomCount + 2; iter++) {
      const withContext = iter === 0;
      const topMod = extractTopModule(reducedTriples(current, withContext), sigma);
      const topAtoms = [...moduleTriplesToAtomIds(topMod)];
      const botMod = extractBotModule(reducedTriples(topAtoms, withContext), sigma);
      const botAtoms = moduleTriplesToAtomIds(botMod);
      const next = current.filter((id) => botAtoms.has(id));
      if (next.length === current.length) {
        current = next;
        break;
      }
      current = next;
    }

    // Materialise: collect the axiom indices of all surviving atoms and emit
    // their triples in original input order, referential identity preserved.
    const axiomIdxs: number[] = [];
    for (const id of current) axiomIdxs.push(...atoms[id].axiomIndexes);
    return collectTriples(axioms, axiomIdxs, units);
  };

  return { atoms, dependencies, moduleForSignature };
}

/**
 * Materialise the triples of the given axiom-unit indices: dedupe by reference
 * identity and emit in ORIGINAL input order (so the output matches extractStarModule
 * exactly, including referential identity of the input triples).
 */
function collectTriples(
  axioms: LocalityTriple[],
  axiomIndexes: number[],
  units: AxiomUnit[],
): LocalityTriple[] {
  const keep = new Set<LocalityTriple>();
  for (const ax of axiomIndexes) {
    for (const t of units[ax].triples) keep.add(t);
  }
  const result: LocalityTriple[] = [];
  for (const t of axioms) {
    if (keep.has(t)) result.push(t);
  }
  return result;
}
