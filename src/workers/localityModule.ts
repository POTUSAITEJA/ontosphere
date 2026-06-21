/**
 * localityModule.ts
 *
 * SYNTACTIC LOCALITY-BASED MODULE EXTRACTION for OWL ontologies.
 *
 * PURE, STANDALONE module. NOT wired into the worker / reasoning pipeline yet.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THEORY
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements bottom (⊥) syntactic-locality-based module extraction and the
 * iterated ⊤⊥* ("star") variant, following:
 *
 *   B. Cuenca Grau, I. Horrocks, Y. Kazakov, U. Sattler.
 *   "Modular Reuse of Ontologies: Theory and Practice."
 *   Journal of Artificial Intelligence Research (JAIR) 31 (2008), 273–318.
 *   (the same algorithm the OWL API `SyntacticLocalityModuleExtractor` uses.)
 *
 * A *module* for a signature Σ (a set of class / object-property / data-property
 * IRIs) is a subset M of the ontology's axioms that preserves ALL entailments
 * expressible using only the symbols in Σ: for every axiom α over Σ, O ⊨ α iff
 * M ⊨ α. Modules let a reasoner work over a small, relevant slice of a large
 * ontology — the foundation for incremental / modular DL reasoning.
 *
 * SYNTACTIC LOCALITY (the cheap, sound sufficient condition for a module):
 *
 *   An axiom α is ⊥-LOCAL w.r.t. Σ iff the axiom becomes a TAUTOLOGY (trivially
 *   true in every interpretation) after the ⊥-substitution: replace every class
 *   name NOT in Σ by owl:Nothing (⊥, the empty class) and every property name NOT
 *   in Σ by the empty property (∅). Symbols IN Σ are left untouched.
 *
 *   Symmetrically, α is ⊤-LOCAL w.r.t. Σ iff α becomes a tautology after the
 *   ⊤-substitution: classes not in Σ → owl:Thing (⊤), properties not in Σ → the
 *   universal property.
 *
 *   An axiom that is ⊥-local (resp. ⊤-local) carries no information about Σ and
 *   may be SAFELY EXCLUDED from the module.
 *
 * THE FIXPOINT (module extraction). Start with M = ∅ and the "module signature"
 * Σ_M = Σ. Repeatedly scan all not-yet-included axioms; if an axiom is NOT local
 * w.r.t. Σ_M, add it to M and extend Σ_M with all the symbols that axiom uses.
 * Iterate until no axiom can be added (fixpoint). The result is the ⊥-module
 * (when using the ⊥-locality test) or the ⊤-module (when using ⊤-locality).
 *
 *   extractBotModule  — single ⊥-locality fixpoint.
 *   extractStarModule — the ⊤⊥* iteration: alternate ⊥- and ⊤-module extraction
 *     until the set of axioms stops shrinking. The star module is ⊆ the ⊥-module
 *     and is still SOUND (it is the smallest of the locality-based modules).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SOUNDNESS / CONSERVATIVE STANCE  (READ THIS)
 * ─────────────────────────────────────────────────────────────────────────────
 * Soundness ("the module preserves all Σ-entailments") depends on the locality
 * test being a CORRECT *sufficient* condition for exclusion. The danger is
 * wrongly judging an axiom local (and dropping it) — that would be UNSOUND.
 * Wrongly judging an axiom NON-local (and keeping it) only makes the module
 * bigger, which is always SOUND (a superset of a module is still a module).
 *
 * Therefore, for any axiom shape we do not fully analyse, we are CONSERVATIVE:
 * we treat it as NON-LOCAL (include it). This guarantees soundness at the cost
 * of occasionally larger modules. The cases we analyse precisely are listed in
 * the `isLocal` implementation; everything else falls through to "non-local".
 *
 * The locality conditions implemented below are the standard ones (JAIR 2008,
 * Table on syntactic locality; restated for the RDF/triples encoding):
 *
 *   Let x ∈ Σ̃ mean "x is NOT in Σ" (so x is replaced by ⊥ / ∅ under ⊥-subst).
 *
 *   A class expression C is ⊥-EQUIV-⊥ (≡⊥, behaves like owl:Nothing) when:
 *     • C is a class name A with A ∉ Σ                                (A → ⊥)
 *     • C = ∃R.D or ∃R.{...}    where R ∉ Σ  OR  D is ⊥-equiv-⊥       (∃∅.· = ⊥, ∃R.⊥ = ⊥)
 *     • C = R hasValue v        where R ∉ Σ                           (∅ hasValue v = ⊥)
 *     • C = ≥n R.D (n≥1)        where R ∉ Σ  OR  D is ⊥-equiv-⊥       (min-card on ∅ = ⊥)
 *     • C = C1 ⊓ … ⊓ Cn         where SOME Ci is ⊥-equiv-⊥           (intersection w/ ⊥ = ⊥)
 *     • C = C1 ⊔ … ⊔ Cn         where EVERY Ci is ⊥-equiv-⊥          (union of ⊥'s = ⊥)
 *
 *   A class expression C is ⊥-EQUIV-⊤ (≡⊤, behaves like owl:Thing) when:
 *     • C = ∀R.D                where R ∉ Σ                           (∀∅.· = ⊤)
 *     • C = ≤n R.D              where R ∉ Σ                           (≤n on ∅ = ⊤)
 *     • C = ¬D                  where D is ⊥-equiv-⊥
 *     • C = C1 ⊓ … ⊓ Cn         where EVERY Ci is ⊥-equiv-⊤
 *     • C = C1 ⊔ … ⊔ Cn         where SOME Ci is ⊥-equiv-⊤
 *     (owl:Thing itself is ≡⊤; a class name A ∉ Σ is ≡⊥, NOT ≡⊤.)
 *
 *   Axioms — ⊥-LOCAL when (using the above ⊥-substitution semantics):
 *     • SubClassOf(C, D)        : C ≡⊥  OR  D ≡⊤
 *     • EquivalentClasses(C, D) : both C ≡⊥  OR  both C ≡⊤
 *     • DisjointClasses(C, D)   : at most one of C,D is NOT ≡⊥ (i.e. ≥(n−1) are ⊥)
 *     • SubPropertyOf(R, S)     : R ∉ Σ  (∅ ⊑ S is a tautology)  OR  S ∉ Σ-handled below
 *     • Domain(R, C) / Range(R, C): R ∉ Σ  (∅ has empty domain/range — tautology)
 *                                   OR (for domain/range super-side) C ≡⊤
 *     • InverseProperties(R, S) : R ∉ Σ AND S ∉ Σ
 *     • Declaration(x)          : ALWAYS local (declarations entail nothing about Σ)
 *     • ClassAssertion(C, a)    : C ≡⊤   (a:C tautology only if C ≡⊤; else non-local — ABox is conservative)
 *     • everything else         : NON-LOCAL (conservative)
 *
 * The ⊤-substitution mirror (used by the star module) swaps the roles of ⊥/⊤
 * for class names: a class name A ∉ Σ becomes ⊤ under ⊤-substitution.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INPUT / OUTPUT ENCODING
 * ─────────────────────────────────────────────────────────────────────────────
 * Axioms are RDF triples in the same `{ subject, predicate, object }` string
 * shape used elsewhere in the repo (see ReasoningError.justification in
 * reasoningTypes.ts and ProfileTriple in owlProfile.ts). Multi-triple axioms
 * (blank-node restrictions, rdf:List for unionOf/intersectionOf, equivalentClass
 * to an anonymous class expression) are grouped into *axiom units*: a named
 * principal subject plus the transitive blank-node closure reachable from it.
 *
 * The module is returned as the subset of the INPUT triple objects (referential
 * identity preserved) so callers can map results straight back to their source.
 */

import { RDF, RDFS, OWL, XSD } from "../constants/vocabularies.ts";

// ───────────────────────────── Well-known IRIs ──────────────────────────────

const RDF_TYPE = RDF.type;
const RDF_FIRST = RDF.first;
const RDF_REST = RDF.rest;
const RDF_NIL = RDF.nil;

const RDFS_SUBCLASS_OF = `${RDFS.namespace}subClassOf`;
const RDFS_SUBPROPERTY_OF = `${RDFS.namespace}subPropertyOf`;
const RDFS_DOMAIN = RDFS.domain;
const RDFS_RANGE = RDFS.range;

const OWL_THING = `${OWL.namespace}Thing`;
const OWL_NOTHING = `${OWL.namespace}Nothing`;
const OWL_EQUIVALENT_CLASS = `${OWL.namespace}equivalentClass`;
const OWL_EQUIVALENT_PROPERTY = `${OWL.namespace}equivalentProperty`;
const OWL_DISJOINT_WITH = OWL.disjointWith;
const OWL_INVERSE_OF = `${OWL.namespace}inverseOf`;

const OWL_RESTRICTION = `${OWL.namespace}Restriction`;
const OWL_ON_PROPERTY = `${OWL.namespace}onProperty`;
const OWL_SOME_VALUES_FROM = `${OWL.namespace}someValuesFrom`;
const OWL_ALL_VALUES_FROM = `${OWL.namespace}allValuesFrom`;
const OWL_HAS_VALUE = `${OWL.namespace}hasValue`;
const OWL_HAS_SELF = `${OWL.namespace}hasSelf`;
const OWL_ON_CLASS = `${OWL.namespace}onClass`;
const OWL_MIN_CARDINALITY = `${OWL.namespace}minCardinality`;
const OWL_MAX_CARDINALITY = `${OWL.namespace}maxCardinality`;
const OWL_CARDINALITY = `${OWL.namespace}cardinality`;
const OWL_MIN_QUALIFIED_CARDINALITY = `${OWL.namespace}minQualifiedCardinality`;
const OWL_MAX_QUALIFIED_CARDINALITY = `${OWL.namespace}maxQualifiedCardinality`;
const OWL_QUALIFIED_CARDINALITY = `${OWL.namespace}qualifiedCardinality`;

const OWL_INTERSECTION_OF = `${OWL.namespace}intersectionOf`;
const OWL_UNION_OF = `${OWL.namespace}unionOf`;
const OWL_COMPLEMENT_OF = `${OWL.namespace}complementOf`;
const OWL_ONE_OF = `${OWL.namespace}oneOf`;

const OWL_CLASS = OWL.Class;
const OWL_OBJECT_PROPERTY = OWL.ObjectProperty;
const OWL_DATATYPE_PROPERTY = OWL.DatatypeProperty;
const OWL_ANNOTATION_PROPERTY = OWL.AnnotationProperty;
const OWL_NAMED_INDIVIDUAL = OWL.NamedIndividual;
const OWL_ONTOLOGY = OWL.Ontology;

const OWL_ON_DATA_RANGE = `${OWL.namespace}onDataRange`;
// NOTE on owl:propertyChainAxiom: it is NOT a recognised principal predicate, so
// in buildAxiomUnits a `R owl:propertyChainAxiom (…)` triple (named subject,
// blank-node list object) falls through to the CONSERVATIVE branch and is kept
// unconditionally (always NON-LOCAL). Property chains are therefore never dropped
// — sound by the conservative fallback (a chain entailment may affect Σ).

/**
 * Property-characteristic rdf:type objects. A triple `R rdf:type owl:X` where
 * owl:X ∈ this set is a LOGICAL axiom about the property R (not a declaration):
 * Transitive/Functional/InverseFunctional/Symmetric/Asymmetric/Reflexive/
 * Irreflexive. Per syntactic locality (Cuenca Grau et al., JAIR 2008; the OWL API
 * `SyntacticLocalityEvaluator.AxiomLocalityVisitor`), such an axiom is LOCAL iff
 * the property R is NOT in Σ (it is replaced by the empty/universal property and
 * the characteristic holds trivially), and NON-LOCAL iff R ∈ Σ — in BOTH the ⊥
 * and ⊤ locality modes. Treating these as declarations would DROP them from every
 * module, which is UNSOUND when R ∈ Σ (e.g. Transitive(R) derives new Σ-entailed
 * subsumptions / instances).
 */
const PROPERTY_CHARACTERISTIC_TYPES = new Set<string>([
  `${OWL.namespace}TransitiveProperty`,
  `${OWL.namespace}FunctionalProperty`,
  `${OWL.namespace}InverseFunctionalProperty`,
  `${OWL.namespace}SymmetricProperty`,
  `${OWL.namespace}AsymmetricProperty`,
  `${OWL.namespace}ReflexiveProperty`,
  `${OWL.namespace}IrreflexiveProperty`,
]);

/** Returns true when `obj` is a property-characteristic rdf:type object. */
function isPropertyCharacteristicType(obj: string): boolean {
  return PROPERTY_CHARACTERISTIC_TYPES.has(obj);
}

/**
 * Pure declaration rdf:type objects. A triple `x rdf:type owl:X` with owl:X in
 * this set asserts only the kind of `x` (class / property / individual /
 * ontology / structural builder) and entails nothing about Σ — it is ALWAYS
 * local. Property-characteristic types (handled above) are deliberately NOT here.
 */
const DECLARATION_TYPES = new Set<string>([
  OWL_CLASS,
  OWL_OBJECT_PROPERTY,
  OWL_DATATYPE_PROPERTY,
  OWL_ANNOTATION_PROPERTY,
  OWL_NAMED_INDIVIDUAL,
  OWL_ONTOLOGY,
  OWL_RESTRICTION,
  `${RDF.namespace}List`,
  `${RDF.namespace}Property`,
]);

/**
 * Well-known datatype / data-range IRIs that may appear as the filler of a
 * data-property restriction (owl:someValuesFrom / owl:allValuesFrom / a qualified
 * cardinality onDataRange). Datatypes are NEVER class names and NEVER in Σ; under
 * locality substitution they must NOT be replaced by ⊥/⊤ — see evalRestriction.
 */
const DATATYPE_IRIS = new Set<string>([
  XSD.string,
  XSD.integer,
  XSD.boolean,
  XSD.decimal,
  XSD.float,
  XSD.dateTime,
  XSD.date,
  `${RDFS.namespace}Literal`,
  `${OWL.namespace}real`,
  `${OWL.namespace}rational`,
]);

/** True when `iri` names a datatype / data range (xsd:*, rdfs:Literal, …). */
function isDatatypeIri(iri: string): boolean {
  if (DATATYPE_IRIS.has(iri)) return true;
  // Any term in the XSD namespace is a datatype.
  return iri.startsWith(XSD.namespace);
}

/**
 * Structural predicates that never name a class/property symbol when read off a
 * triple — they describe how a class expression is *built*, not a Σ-symbol.
 * (Used by signatureOf to avoid harvesting blank-node ids and builder IRIs.)
 */

// ───────────────────────────────── Types ────────────────────────────────────

/**
 * A single RDF triple. Matches the `{ subject, predicate, object }` shape used
 * across the repo. `objectIsLiteral` is optional; when omitted we treat objects
 * that look like IRIs/blank-nodes as terms and everything else conservatively.
 */
export interface LocalityTriple {
  subject: string;
  predicate: string;
  object: string;
  objectIsLiteral?: boolean;
}

/** Options for module extraction. */
export interface LocalityOptions {
  /**
   * When true, declaration triples (rdf:type owl:Class / owl:ObjectProperty /
   * owl:DatatypeProperty / owl:NamedIndividual, etc.) for symbols already in the
   * module signature are pulled back in at the end. Declarations are ALWAYS
   * ⊥-local (they entail nothing), so they are not part of the logical module;
   * this convenience flag re-attaches them so the output is self-describing.
   * Default: false (a pure logical module).
   */
  includeDeclarationsForSignature?: boolean;
}

/**
 * An "axiom unit": one logical OWL axiom assembled from the principal triple
 * plus the transitive blank-node closure (restrictions, rdf:Lists, nested class
 * expressions) reachable from its subject and object.
 */
interface AxiomUnit {
  /** The principal triple that anchors this axiom. */
  principal: LocalityTriple;
  /** All triples belonging to this axiom (principal + reachable blank-node closure). */
  triples: LocalityTriple[];
  /** The class/property IRIs this axiom uses (its signature). */
  signature: Set<string>;
  /**
   * When true, this unit is an UNRECOGNISED axiom shape: we cannot prove it
   * local, so it is unconditionally NON-LOCAL (always kept). This is the
   * conservative fallback that guarantees soundness — see the header note.
   */
  conservative?: boolean;
}

/** Indexed, cycle-safe view of the triple set. */
interface TripleIndex {
  triples: LocalityTriple[];
  /** subject → outgoing triples */
  out: Map<string, LocalityTriple[]>;
  /** subject → set of rdf:type IRIs (non-literal objects) */
  types: Map<string, Set<string>>;
  /** declared object-property IRIs */
  objectProps: Set<string>;
  /** declared data-property IRIs */
  dataProps: Set<string>;
}

// ───────────────────────────── Term helpers ─────────────────────────────────

/** Blank nodes in RDF triples are typically encoded as `_:b0` or N3 `bN` ids. */
function isBlankNode(term: string): boolean {
  return term.startsWith("_:") || /^b\d+$/.test(term) || term.startsWith("n3-");
}

/** Owl/Rdf/Rdfs builtin terms that are never user Σ-symbols. */
const BUILTIN_TERMS = new Set<string>([
  OWL_THING,
  OWL_NOTHING,
  RDF_NIL,
  `${RDF.namespace}List`,
  OWL_CLASS,
  OWL_RESTRICTION,
  OWL_OBJECT_PROPERTY,
  OWL_DATATYPE_PROPERTY,
  OWL_ANNOTATION_PROPERTY,
  OWL_NAMED_INDIVIDUAL,
  OWL_ONTOLOGY,
  `${OWL.namespace}AllDisjointClasses`,
  `${OWL.namespace}AllDifferent`,
]);

/**
 * Predicates whose object is structural plumbing (a blank node, a list head, a
 * cardinality literal, or a builtin), never a Σ class/property symbol by itself.
 */
const STRUCTURAL_PREDICATES = new Set<string>([
  RDF_FIRST,
  RDF_REST,
  OWL_INTERSECTION_OF,
  OWL_UNION_OF,
  OWL_ONE_OF,
  OWL_MIN_CARDINALITY,
  OWL_MAX_CARDINALITY,
  OWL_CARDINALITY,
  OWL_MIN_QUALIFIED_CARDINALITY,
  OWL_MAX_QUALIFIED_CARDINALITY,
  OWL_QUALIFIED_CARDINALITY,
  OWL_HAS_SELF,
]);

// ───────────────────────────── Indexing ─────────────────────────────────────

function buildIndex(triples: LocalityTriple[]): TripleIndex {
  const out = new Map<string, LocalityTriple[]>();
  const types = new Map<string, Set<string>>();
  const objectProps = new Set<string>();
  const dataProps = new Set<string>();

  for (const t of triples) {
    let arr = out.get(t.subject);
    if (!arr) {
      arr = [];
      out.set(t.subject, arr);
    }
    arr.push(t);

    if (t.predicate === RDF_TYPE && !t.objectIsLiteral) {
      let set = types.get(t.subject);
      if (!set) {
        set = new Set();
        types.set(t.subject, set);
      }
      set.add(t.object);
      if (t.object === OWL_OBJECT_PROPERTY) objectProps.add(t.subject);
      if (t.object === OWL_DATATYPE_PROPERTY) dataProps.add(t.subject);
    }
  }

  return { triples, out, types, objectProps, dataProps };
}

/** First outgoing object value for a predicate, if any. */
function objOf(idx: TripleIndex, subject: string, predicate: string): LocalityTriple | undefined {
  return (idx.out.get(subject) ?? []).find((t) => t.predicate === predicate);
}

/**
 * Resolve an rdf:List headed by `head` into its member node ids. Cycle-safe via
 * a `seen` guard so malformed / cyclic lists terminate instead of hanging.
 */
function resolveList(idx: TripleIndex, head: string): string[] {
  const items: string[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = head;
  while (cur && cur !== RDF_NIL && !seen.has(cur)) {
    seen.add(cur);
    const arr = idx.out.get(cur) ?? [];
    const first = arr.find((t) => t.predicate === RDF_FIRST);
    const rest = arr.find((t) => t.predicate === RDF_REST);
    if (first) items.push(first.object);
    cur = rest?.object;
  }
  return items;
}

// ─────────────────────────── Signature extraction ───────────────────────────

/**
 * signatureOf — the set of class/property IRIs *used* by the given axioms.
 *
 * We harvest named (non-blank, non-literal, non-builtin) IRIs that appear in
 * positions where a class or property symbol can occur: subjects of logical
 * axioms, objects of subclass/equivalence/disjoint/domain/range/inverse, the
 * property of restrictions (owl:onProperty), restriction fillers, list members,
 * and rdf:type assertions' class. Structural builder IRIs (owl:Class,
 * owl:Restriction, list/cardinality predicates) and blank-node ids are excluded.
 */
export function signatureOf(axioms: LocalityTriple[]): Set<string> {
  const idx = buildIndex(axioms);
  const sig = new Set<string>();

  const addTerm = (term: string | undefined, isLiteral?: boolean): void => {
    if (!term) return;
    if (isLiteral) return;
    if (isBlankNode(term)) return;
    if (BUILTIN_TERMS.has(term)) return;
    sig.add(term);
  };

  for (const t of idx.triples) {
    const p = t.predicate;

    if (p === RDF_TYPE) {
      // subject is an individual/class; object names a class (or is a builtin).
      addTerm(t.object, t.objectIsLiteral);
      continue;
    }

    // Class-axiom predicates: subject & object are class expressions.
    if (
      p === RDFS_SUBCLASS_OF ||
      p === OWL_EQUIVALENT_CLASS ||
      p === OWL_DISJOINT_WITH
    ) {
      addTerm(t.subject);
      addTerm(t.object, t.objectIsLiteral);
      continue;
    }

    // Property-axiom predicates.
    if (
      p === RDFS_SUBPROPERTY_OF ||
      p === OWL_EQUIVALENT_PROPERTY ||
      p === OWL_INVERSE_OF
    ) {
      addTerm(t.subject);
      addTerm(t.object, t.objectIsLiteral);
      continue;
    }

    if (p === RDFS_DOMAIN || p === RDFS_RANGE) {
      addTerm(t.subject); // the property
      addTerm(t.object, t.objectIsLiteral); // a class
      continue;
    }

    // Restriction fillers & onProperty name real symbols.
    if (
      p === OWL_ON_PROPERTY ||
      p === OWL_SOME_VALUES_FROM ||
      p === OWL_ALL_VALUES_FROM ||
      p === OWL_ON_CLASS ||
      p === OWL_COMPLEMENT_OF
    ) {
      addTerm(t.object, t.objectIsLiteral);
      continue;
    }

    // List membership: harvest each named member.
    if (p === RDF_FIRST) {
      addTerm(t.object, t.objectIsLiteral);
      continue;
    }

    // owl:hasValue object is an individual (not a class/property symbol) — skip.
    // Structural predicates contribute nothing on their own.
    if (STRUCTURAL_PREDICATES.has(p)) continue;
  }

  return sig;
}

// ──────────────────── Axiom-unit assembly (blank-node closure) ───────────────

/**
 * Predicates that anchor a *logical axiom* (as opposed to annotations and pure
 * declarations). A triple with one of these predicates is the principal of an
 * axiom unit. rdf:type is handled specially (declaration vs class assertion).
 */
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

/**
 * Predicates that build a class expression and are therefore CONSUMED by the
 * blank-node closure of a parent axiom — they must NOT spawn their own units.
 */
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

/**
 * Annotation predicates carry no logical meaning and are ALWAYS local — they
 * never spawn an axiom unit and are never pulled into the module by the logic.
 */
const ANNOTATION_PREDICATES = new Set<string>([
  RDFS.label,
  RDFS.comment,
  RDFS.seeAlso,
  `${RDFS.namespace}isDefinedBy`,
  `${OWL.namespace}versionInfo`,
  `${OWL.namespace}deprecated`,
  OWL.imports,
  `${RDF.namespace}type`, // handled separately (declarations / class assertions)
]);

/**
 * Collect the transitive blank-node closure of `start` (a class-expression node
 * that may be anonymous), returning every triple reachable through blank nodes.
 * Cycle-safe. Used to gather all triples that make up one anonymous class
 * expression (restriction, intersection/union list, nested complement, …).
 */
function blankClosure(idx: TripleIndex, start: string, acc: LocalityTriple[], seen: Set<string>): void {
  if (seen.has(start)) return;
  seen.add(start);
  const arr = idx.out.get(start);
  if (!arr) return;
  for (const t of arr) {
    acc.push(t);
    // Recurse into blank-node objects (nested expressions, list cells).
    if (!t.objectIsLiteral && isBlankNode(t.object)) {
      blankClosure(idx, t.object, acc, seen);
    }
  }
}

/**
 * Group the triples into axiom units. Each principal axiom triple becomes a unit
 * whose triple-set includes the principal plus the blank-node closure of any
 * anonymous subject/object it references. Triples that are not part of any
 * logical axiom (annotations, declarations, list/restriction plumbing reached
 * only through a parent) are still tracked so callers can re-attach them.
 */
function buildAxiomUnits(idx: TripleIndex): AxiomUnit[] {
  const units: AxiomUnit[] = [];

  for (const t of idx.triples) {
    const p = t.predicate;

    let isPrincipal = false;
    let conservative = false;
    let propertyCharacteristic = false;

    if (AXIOM_PREDICATES.has(p)) {
      isPrincipal = true;
    } else if (p === RDF_TYPE && !t.objectIsLiteral) {
      // rdf:type is a principal axiom when it is:
      //   • a ClassAssertion to a real class / anonymous class expression
      //     (NamedIndividual a C, or a r C), OR
      //   • a PROPERTY-CHARACTERISTIC axiom (R a owl:TransitiveProperty, etc.).
      // Pure DECLARATIONS (a owl:Class / owl:ObjectProperty / owl:Restriction /
      // …) are NOT logical axioms — they are always local — so not principals.
      const obj = t.object;
      if (isPropertyCharacteristicType(obj)) {
        // BUG 1/2 FIX: a property-characteristic axiom is a LOGICAL axiom about
        // the property R (its ⊥/⊤-locality depends on R ∈ Σ). Previously these
        // fell into the `obj.startsWith(owl:)` declaration branch and were DROPPED
        // from every module — UNSOUND when R ∈ Σ. Treat as a principal unit.
        isPrincipal = true;
        propertyCharacteristic = true;
      } else {
        const isDeclaration =
          DECLARATION_TYPES.has(obj) ||
          // Any other owl:-namespaced rdf:type object we do not recognise as a
          // property characteristic is treated as a declaration-like assertion
          // (e.g. owl:AllDisjointClasses headers) — always local. The recognised
          // logical property characteristics are handled above.
          obj.startsWith(`${OWL.namespace}`);
        isPrincipal = !isDeclaration;
      }
    } else if (
      !ANNOTATION_PREDICATES.has(p) &&
      !CLASS_BUILDER_PREDICATES.has(p) &&
      !isBlankNode(t.subject) &&
      !t.objectIsLiteral
    ) {
      // UNRECOGNISED predicate on a named subject with a non-literal object: we
      // cannot prove this axiom local, so include it conservatively (sound). A
      // literal-valued unknown triple is treated as an annotation-like data
      // assertion and left local (it cannot carry class/property subsumption).
      isPrincipal = true;
      conservative = true;
    }

    if (!isPrincipal) continue;

    const triplesOfUnit: LocalityTriple[] = [t];
    const seen = new Set<string>();
    // Expand anonymous subject and object class expressions.
    if (isBlankNode(t.subject)) blankClosure(idx, t.subject, triplesOfUnit, seen);
    if (!t.objectIsLiteral && isBlankNode(t.object)) blankClosure(idx, t.object, triplesOfUnit, seen);

    const signature = signatureOf(triplesOfUnit);
    if (conservative) {
      // Ensure the unknown axiom's named symbols enter the working signature so
      // its inclusion can transitively pull related axioms (sound over-approx).
      if (!isBlankNode(t.subject) && !BUILTIN_TERMS.has(t.subject)) signature.add(t.subject);
      if (!t.objectIsLiteral && !isBlankNode(t.object) && !BUILTIN_TERMS.has(t.object)) signature.add(t.object);
    }
    if (propertyCharacteristic) {
      // signatureOf harvests the rdf:type OBJECT (the characteristic IRI, a
      // builtin → dropped) but not the SUBJECT property R. R is exactly the symbol
      // whose Σ-membership decides locality, so it MUST be in the unit signature
      // (both for the locality test and to grow Σ when the axiom is kept).
      if (!isBlankNode(t.subject) && !BUILTIN_TERMS.has(t.subject)) signature.add(t.subject);
    }
    units.push({ principal: t, triples: triplesOfUnit, signature, conservative });
  }

  return units;
}

// ─────────────────────────── Class-expression model ─────────────────────────

/**
 * Evaluate whether an (anonymous or named) class-expression node behaves like ⊥
 * (the empty class) under the locality substitution, OR like ⊤ (the universal
 * class). The substitution is parameterised by `mode`:
 *
 *   mode === "bot": a class name NOT in Σ → ⊥ ; a property NOT in Σ → ∅.
 *   mode === "top": a class name NOT in Σ → ⊤ ; a property NOT in Σ → univ.
 *
 * Returns "bot" | "top" | "other".  "other" means "could be anything" — neither
 * provably empty nor provably universal under the substitution; the caller must
 * treat such an expression conservatively.
 *
 * Cycle-safe via `seen`.
 */
type ExprValue = "bot" | "top" | "other";

function evalClassExpr(
  idx: TripleIndex,
  node: string,
  sigma: Set<string>,
  mode: "bot" | "top",
  isLiteral: boolean,
  seen: Set<string>,
): ExprValue {
  if (isLiteral) return "other";

  // Named builtin top/bottom.
  if (node === OWL_THING) return "top";
  if (node === OWL_NOTHING) return "bot";

  // A NAMED class.
  if (!isBlankNode(node)) {
    if (sigma.has(node)) return "other"; // in Σ → kept as-is, unknown extension
    // Not in Σ → replaced.
    return mode === "bot" ? "bot" : "top";
  }

  // Anonymous class expression — inspect its structure. Guard cycles.
  if (seen.has(node)) return "other";
  seen.add(node);

  const arr = idx.out.get(node) ?? [];
  const has = (pred: string): LocalityTriple | undefined => arr.find((t) => t.predicate === pred);

  // ── Restrictions ──────────────────────────────────────────────────────────
  const onProp = has(OWL_ON_PROPERTY);
  if (onProp) {
    const propInSigma = !onProp.objectIsLiteral && !isBlankNode(onProp.object) && sigma.has(onProp.object);
    // propEmpty: the property is replaced by ∅ (bot mode) — affects ∃, ≥.
    // propUniv:  the property is replaced by universal (top mode) — affects ∀, ≤.
    const propReplaced = !propInSigma; // not in Σ → substituted

    const some = has(OWL_SOME_VALUES_FROM);
    const all = has(OWL_ALL_VALUES_FROM);
    const hasVal = has(OWL_HAS_VALUE);
    const hasSelf = has(OWL_HAS_SELF);
    const minCard = has(OWL_MIN_CARDINALITY) ?? has(OWL_MIN_QUALIFIED_CARDINALITY);
    const exactCard = has(OWL_CARDINALITY) ?? has(OWL_QUALIFIED_CARDINALITY);
    const maxCard = has(OWL_MAX_CARDINALITY) ?? has(OWL_MAX_QUALIFIED_CARDINALITY);
    const onDataRange = has(OWL_ON_DATA_RANGE);

    // BUG 3 FIX — DATA vs OBJECT restriction.
    // For a DATA restriction (`∃dataProp.dataRange`, `∀dataProp.dataRange`, a
    // qualified cardinality with owl:onDataRange, …) the filler is a DATA RANGE,
    // never a class. A datatype (xsd:integer, rdfs:Literal, …) is NOT a class
    // name, is never in Σ, and must NOT be substituted to ⊥/⊤. The locality of a
    // data restriction depends ONLY on the data property: `∃dataProp.dr` is
    // ⊥-local iff dataProp∉Σ (∃∅.dr = ⊥), `∀dataProp.dr` → ⊤ iff dataProp∉Σ. We
    // detect a data restriction by: a declared data property, a datatype/literal
    // filler, or an explicit owl:onDataRange. (Cuenca Grau et al. JAIR 2008; OWL
    // API SyntacticLocalityEvaluator treats data ranges outside the class
    // substitution.) Object fillers keep the original D ≡⊥ / D ≡⊤ propagation.
    const fillerOf = (t: LocalityTriple | undefined): string | undefined => t?.object;
    const fillerLit = (t: LocalityTriple | undefined): boolean => !!t?.objectIsLiteral;
    const isDataFiller = (filler: string | undefined, lit: boolean): boolean => {
      if (lit) return true; // a literal filler is data, never a class
      if (filler !== undefined && isDatatypeIri(filler)) return true;
      return false;
    };
    const propIsData =
      !onProp.objectIsLiteral && !isBlankNode(onProp.object) && idx.dataProps.has(onProp.object);

    /**
     * Evaluate a restriction filler for the ⊥/⊤ propagation. Returns "other" (no
     * ⊥/⊤ contribution) when the filler is a DATA RANGE — datatypes are never
     * substituted. Only OBJECT (class) fillers recurse through evalClassExpr.
     */
    const evalFiller = (t: LocalityTriple | undefined): ExprValue => {
      if (!t) return "other";
      const f = fillerOf(t);
      const lit = fillerLit(t);
      if (onDataRange !== undefined || propIsData || isDataFiller(f, lit)) return "other";
      return evalClassExpr(idx, t.object, sigma, mode, lit, seen);
    };

    if (mode === "bot") {
      // ∃R.D : ⊥ if R∉Σ (∃∅.D = ⊥) or (OBJECT filler) D ≡⊥ (∃R.⊥ = ⊥). For a DATA
      // filler the datatype is non-empty and unsubstituted → only R∉Σ forces ⊥.
      if (some) {
        if (propReplaced) return "bot";
        const fillerVal = evalFiller(some);
        return fillerVal === "bot" ? "bot" : "other";
      }
      // hasValue v : ∅ hasValue v = ⊥ when R∉Σ.
      if (hasVal) return propReplaced ? "bot" : "other";
      // ∀R.D : ∀∅.D = ⊤ when R∉Σ (holds for data and object fillers alike).
      if (all) return propReplaced ? "top" : "other";
      // ≥n R (n≥1): ≥n ∅ = ⊥ when R∉Σ (an empty role has no successors). n=0 → ⊤.
      if (minCard) {
        const n = cardValue(minCard);
        if (n === 0) return "top";
        // qualified ≥n R.D also ⊥ if the OBJECT filler D ≡⊥ (data ranges excluded).
        if (propReplaced) return "bot";
        const onClass = has(OWL_ON_CLASS);
        if (onClass) {
          const fv = evalFiller(onClass);
          if (fv === "bot") return "bot";
        }
        // onDataRange filler is a data range → never ⊥ from the filler.
        return "other";
      }
      // ≤n R : ≤n ∅ = ⊤ when R∉Σ (always satisfiable).
      if (maxCard) return propReplaced ? "top" : "other";
      // =n R : exact = min ⊓ max; with R∉Σ → ⊥ if n≥1, ⊤ if n=0.
      if (exactCard) {
        if (propReplaced) return cardValue(exactCard) === 0 ? "top" : "bot";
        return "other";
      }
      // hasSelf: ∃R.Self = ⊥ when R∉Σ.
      if (hasSelf) return propReplaced ? "bot" : "other";
      return "other";
    } else {
      // mode === "top": properties not in Σ → universal property.
      // ∃R.D : ∃univ.D — universal? Only ⊤ if D is satisfiable; conservative "other"
      //   unless filler is ⊤ AND propReplaced (∃univ.⊤ = ⊤). If filler ≡⊤ keep ⊤ only when R replaced.
      if (some) {
        const fillerVal = evalFiller(some);
        if (propReplaced && fillerVal === "top") return "top";
        if (fillerVal === "bot") return "bot"; // ∃R.⊥ = ⊥ regardless (object filler)
        return "other";
      }
      if (all) {
        // ∀univ.D : = ⊤ iff D ≡⊤ ; if D ≡⊥ then ∀univ.⊥ = "nothing has any univ-successor" → not generally ⊥.
        const fillerVal = evalFiller(all);
        if (propReplaced && fillerVal === "top") return "top";
        return "other";
      }
      if (hasVal) return "other";
      if (minCard) {
        const n = cardValue(minCard);
        if (n === 0) return "top";
        return "other";
      }
      if (maxCard) return "other";
      if (exactCard) return "other";
      if (hasSelf) return "other";
      return "other";
    }
  }

  // ── Boolean connectives ─────────────────────────────────────────────────────
  const inter = has(OWL_INTERSECTION_OF);
  if (inter) {
    const members = resolveList(idx, inter.object);
    const vals = members.map((m) => evalClassExpr(idx, m, sigma, mode, false, seen));
    // ⊓ : ⊥ if ANY member ≡⊥ ; ⊤ if ALL members ≡⊤.
    if (vals.some((v) => v === "bot")) return "bot";
    if (vals.length > 0 && vals.every((v) => v === "top")) return "top";
    return "other";
  }

  const union = has(OWL_UNION_OF);
  if (union) {
    const members = resolveList(idx, union.object);
    const vals = members.map((m) => evalClassExpr(idx, m, sigma, mode, false, seen));
    // ⊔ : ⊤ if ANY member ≡⊤ ; ⊥ if ALL members ≡⊥.
    if (vals.some((v) => v === "top")) return "top";
    if (vals.length > 0 && vals.every((v) => v === "bot")) return "bot";
    return "other";
  }

  const comp = has(OWL_COMPLEMENT_OF);
  if (comp) {
    const inner = evalClassExpr(idx, comp.object, sigma, mode, !!comp.objectIsLiteral, seen);
    // ¬⊥ = ⊤ ; ¬⊤ = ⊥.
    if (inner === "bot") return "top";
    if (inner === "top") return "bot";
    return "other";
  }

  // owl:oneOf {...}: a nominal set. Conservative — not provably ⊥/⊤ under subst.
  if (has(OWL_ONE_OF)) return "other";

  // Unknown anonymous shape — conservative.
  return "other";
}

/** Parse a cardinality literal value; non-numeric → NaN-safe large default. */
function cardValue(t: LocalityTriple): number {
  const n = parseInt(t.object, 10);
  return Number.isFinite(n) ? n : 1; // unknown → treat as ≥1 (conservative non-trivial)
}

// ───────────────────────────── Locality test ────────────────────────────────

/**
 * Test whether a class-axiom side (subject or object of a class axiom) is ⊥/⊤
 * under the substitution, handling the NAMED case directly (named class names
 * are common principals and arrive as plain IRIs, not blank nodes).
 */
function sideValue(idx: TripleIndex, term: string, isLiteral: boolean, sigma: Set<string>, mode: "bot" | "top"): ExprValue {
  return evalClassExpr(idx, term, sigma, mode, isLiteral, new Set<string>());
}

/**
 * isLocalUnit — core syntactic-locality test for one axiom unit under a given
 * substitution mode ("bot" → ⊥-locality, "top" → ⊤-locality) and signature.
 *
 * Returns true when the axiom is LOCAL (a tautology after substitution) and may
 * therefore be excluded from the module. Returns false (NON-LOCAL → keep) for
 * every shape we do not prove tautological — the CONSERVATIVE default.
 */
function isLocalUnit(idx: TripleIndex, unit: AxiomUnit, sigma: Set<string>, mode: "bot" | "top"): boolean {
  // Conservative units (unrecognised shapes) are unconditionally NON-LOCAL.
  if (unit.conservative) return false;

  const t = unit.principal;
  const p = t.predicate;

  // ── SubClassOf(C, D) ────────────────────────────────────────────────────────
  // ⊥-local iff C ≡⊥ or D ≡⊤.  (⊥ ⊑ D and C ⊑ ⊤ are tautologies.)
  if (p === RDFS_SUBCLASS_OF) {
    const c = sideValue(idx, t.subject, false, sigma, mode);
    const d = sideValue(idx, t.object, !!t.objectIsLiteral, sigma, mode);
    return c === "bot" || d === "top";
  }

  // ── EquivalentClasses(C, D) ─────────────────────────────────────────────────
  // ⊥-local iff (C ≡⊥ and D ≡⊥) or (C ≡⊤ and D ≡⊤): both sides collapse the same
  // way, so C ≡ D is a tautology.
  if (p === OWL_EQUIVALENT_CLASS) {
    const c = sideValue(idx, t.subject, false, sigma, mode);
    const d = sideValue(idx, t.object, !!t.objectIsLiteral, sigma, mode);
    return (c === "bot" && d === "bot") || (c === "top" && d === "top");
  }

  // ── DisjointClasses(C, D) ───────────────────────────────────────────────────
  // ⊥-local iff at least one side ≡⊥ (⊥ is disjoint from anything → tautology).
  if (p === OWL_DISJOINT_WITH) {
    const c = sideValue(idx, t.subject, false, sigma, mode);
    const d = sideValue(idx, t.object, !!t.objectIsLiteral, sigma, mode);
    // ⊥ ⊓ X = ⊥ ⇒ disjoint holds trivially when either side is ⊥.
    return c === "bot" || d === "bot";
  }

  // ── SubPropertyOf(R, S) ─────────────────────────────────────────────────────
  // ⊥-local iff R ∉ Σ. Under ⊥-subst R → ∅ and ∅ ⊑ S is a tautology.
  // ⊤-local iff S ∉ Σ. Under ⊤-subst S → universal and R ⊑ univ is a tautology.
  if (p === RDFS_SUBPROPERTY_OF) {
    const rInSigma = propInSigma(t.subject, sigma);
    const sInSigma = !t.objectIsLiteral && propInSigma(t.object, sigma);
    if (mode === "bot") return !rInSigma;
    return !sInSigma;
  }

  // ── EquivalentProperties(R, S) ──────────────────────────────────────────────
  // ⊥-local iff both R,S ∉ Σ (both → ∅; ∅ ≡ ∅ tautology).
  // ⊤-local iff both R,S ∉ Σ (both → universal).
  if (p === OWL_EQUIVALENT_PROPERTY) {
    const rInSigma = propInSigma(t.subject, sigma);
    const sInSigma = !t.objectIsLiteral && propInSigma(t.object, sigma);
    return !rInSigma && !sInSigma;
  }

  // ── InverseProperties(R, S) ─────────────────────────────────────────────────
  // ⊥-local iff both R,S ∉ Σ. inv(∅) = ∅, ∅ ≡ ∅ tautology.
  if (p === OWL_INVERSE_OF) {
    const rInSigma = propInSigma(t.subject, sigma);
    const sInSigma = !t.objectIsLiteral && propInSigma(t.object, sigma);
    return !rInSigma && !sInSigma;
  }

  // ── Domain(R, C) ────────────────────────────────────────────────────────────
  // domain(R) ⊑ C  ≈  ∃R.⊤ ⊑ C.
  // ⊥-local iff R ∉ Σ (∃∅.⊤ = ⊥ ⊑ C tautology) OR C ≡⊤ (X ⊑ ⊤ tautology).
  if (p === RDFS_DOMAIN) {
    const rInSigma = propInSigma(t.subject, sigma);
    if (mode === "bot" && !rInSigma) return true;
    const c = sideValue(idx, t.object, !!t.objectIsLiteral, sigma, mode);
    if (c === "top") return true;
    // ⊤-mode: R → universal property → ∃univ.⊤ = ⊤; ⊤ ⊑ C is a tautology only if C ≡⊤ (already covered).
    return false;
  }

  // ── Range(R, C) ─────────────────────────────────────────────────────────────
  // ⊤ ⊑ ∀R.C.  ⊥-local iff R ∉ Σ (∀∅.C = ⊤; ⊤ ⊑ ⊤ tautology) OR C ≡⊤.
  if (p === RDFS_RANGE) {
    const rInSigma = propInSigma(t.subject, sigma);
    if (mode === "bot" && !rInSigma) return true;
    const c = sideValue(idx, t.object, !!t.objectIsLiteral, sigma, mode);
    if (c === "top") return true;
    return false;
  }

  // ── Property-characteristic axiom  (R rdf:type owl:TransitiveProperty, …) ────
  // BUG 1/2 FIX. These are LOGICAL axioms about the property R. Per syntactic
  // locality (Cuenca Grau et al., JAIR 2008; OWL API SyntacticLocalityEvaluator):
  // when R ∉ Σ it is replaced by the empty property (⊥-mode) or the universal
  // property (⊤-mode) and the characteristic (Transitive/Functional/Symmetric/
  // …) holds trivially — so the axiom is LOCAL. When R ∈ Σ it constrains a kept
  // property and is NON-LOCAL (it can derive new Σ-entailments, e.g. transitivity
  // ⇒ extra subsumptions). The rule is the same in both modes: LOCAL iff R ∉ Σ.
  if (p === RDF_TYPE && !t.objectIsLiteral && isPropertyCharacteristicType(t.object)) {
    return !propInSigma(t.subject, sigma);
  }

  // ── ClassAssertion(C, a)  [rdf:type] ────────────────────────────────────────
  // a : C is a tautology after substitution only if C ≡⊤. Otherwise the ABox
  // assertion is NON-LOCAL (kept). This is the conservative ABox handling: ABox
  // axioms are generally non-local unless the class trivialises to ⊤.
  if (p === RDF_TYPE && !t.objectIsLiteral) {
    const c = sideValue(idx, t.object, false, sigma, mode);
    return c === "top";
  }

  // ── Everything else → NON-LOCAL (conservative; keeps the module sound). ──────
  return false;
}

/** A property symbol is "in Σ" iff it is a named IRI present in Σ. */
function propInSigma(term: string, sigma: Set<string>): boolean {
  if (isBlankNode(term)) return false;
  return sigma.has(term);
}

// ───────────────────────── Public per-axiom locality test ───────────────────

/**
 * isBottomLocal — exported per-axiom ⊥-locality test.
 *
 * `axiom` is the full set of triples that make up ONE axiom (principal +
 * blank-node closure). For a single-triple axiom just pass `[triple]`. The
 * principal is taken to be the first triple whose predicate is a recognised
 * logical-axiom predicate (or, failing that, the first triple).
 *
 * Returns true when the axiom is ⊥-LOCAL w.r.t. `signatureSet` (and thus
 * excludable from a ⊥-module), false when NON-LOCAL (must be kept).
 *
 * NOTE: an axiom whose principal we do not recognise as a logical axiom is
 * conservatively NON-LOCAL (returns false) — except pure declarations, which are
 * always local (return true), since a declaration entails nothing about Σ.
 */
export function isBottomLocal(axiom: LocalityTriple[], signatureSet: Set<string>): boolean {
  return isAxiomLocal(axiom, signatureSet, "bot");
}

/** ⊤-locality counterpart of isBottomLocal (exported for completeness/testing). */
export function isTopLocal(axiom: LocalityTriple[], signatureSet: Set<string>): boolean {
  return isAxiomLocal(axiom, signatureSet, "top");
}

function isAxiomLocal(axiom: LocalityTriple[], signatureSet: Set<string>, mode: "bot" | "top"): boolean {
  if (axiom.length === 0) return true; // no axiom → vacuously local

  const idx = buildIndex(axiom);

  // Find the principal triple.
  let principal: LocalityTriple | undefined = axiom.find((t) => AXIOM_PREDICATES.has(t.predicate));
  if (!principal) {
    // BUG 2 FIX: a property-characteristic axiom (R a owl:TransitiveProperty, …)
    // is a LOGICAL principal whose locality depends on R ∈ Σ. Find it BEFORE the
    // ClassAssertion finder (whose declaration filter would otherwise reject any
    // owl:-namespaced rdf:type object, silently dropping these).
    principal = axiom.find(
      (t) => t.predicate === RDF_TYPE && !t.objectIsLiteral && isPropertyCharacteristicType(t.object),
    );
  }
  if (!principal) {
    // Maybe a ClassAssertion (rdf:type to a non-declaration class).
    principal = axiom.find((t) => {
      if (t.predicate !== RDF_TYPE || t.objectIsLiteral) return false;
      const o = t.object;
      const isDecl = DECLARATION_TYPES.has(o) || o.startsWith(`${OWL.namespace}`);
      return !isDecl;
    });
  }

  if (!principal) {
    // No logical principal. If EVERY triple is a declaration / annotation /
    // structural, the axiom is local (entails nothing about Σ). Otherwise keep
    // conservatively. A declaration-only set is local.
    //
    // NOTE: a property-characteristic rdf:type triple would already have been
    // selected as the principal above, so any RDF_TYPE triple reaching here is a
    // pure declaration (a owl:Class / owl:ObjectProperty / …) → always local.
    const allDeclOrStructural = axiom.every((t) => {
      if (t.predicate === RDF_TYPE) return true; // pure declarations only here
      if (STRUCTURAL_PREDICATES.has(t.predicate)) return true;
      if (t.predicate === RDF_FIRST || t.predicate === RDF_REST) return true;
      if (t.predicate === OWL_ON_PROPERTY || t.predicate === OWL_SOME_VALUES_FROM ||
          t.predicate === OWL_ALL_VALUES_FROM || t.predicate === OWL_HAS_VALUE ||
          t.predicate === OWL_ON_CLASS || t.predicate === OWL_INTERSECTION_OF ||
          t.predicate === OWL_UNION_OF || t.predicate === OWL_COMPLEMENT_OF ||
          t.predicate === OWL_ONE_OF) return true;
      return false;
    });
    return allDeclOrStructural;
  }

  const unit: AxiomUnit = {
    principal,
    triples: axiom,
    signature: signatureOf(axiom),
  };
  return isLocalUnit(idx, unit, signatureSet, mode);
}

// ───────────────────────────── Module extraction ────────────────────────────

/**
 * Run a single locality fixpoint over `units` in the given mode. Returns the set
 * of unit indices included in the module. `sigma` is the working signature; it
 * is grown in place as non-local axioms are added.
 */
function localityFixpoint(
  idx: TripleIndex,
  units: AxiomUnit[],
  sigma: Set<string>,
  mode: "bot" | "top",
): Set<number> {
  const included = new Set<number>();
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < units.length; i++) {
      if (included.has(i)) continue;
      const u = units[i];
      if (!isLocalUnit(idx, u, sigma, mode)) {
        // NON-LOCAL → add to module, extend Σ with its symbols.
        included.add(i);
        let grew = false;
        for (const s of u.signature) {
          if (!sigma.has(s)) {
            sigma.add(s);
            grew = true;
          }
        }
        changed = true;
        if (grew) {
          // Σ grew: re-scan from scratch next pass (the while loop handles this).
        }
      }
    }
  }
  return included;
}

/**
 * Reattach declaration triples for every symbol currently in `sigma`, and any
 * annotation/structural triples that hang off included blank nodes. Used when
 * `includeDeclarationsForSignature` is requested. Operates on the ORIGINAL
 * triples so referential identity is preserved.
 */
function collectDeclarations(idx: TripleIndex, sigma: Set<string>): LocalityTriple[] {
  const extra: LocalityTriple[] = [];
  for (const t of idx.triples) {
    if (t.predicate === RDF_TYPE && !t.objectIsLiteral && sigma.has(t.subject)) {
      const o = t.object;
      const isDecl =
        o === OWL_CLASS ||
        o === OWL_OBJECT_PROPERTY ||
        o === OWL_DATATYPE_PROPERTY ||
        o === OWL_ANNOTATION_PROPERTY ||
        o === OWL_NAMED_INDIVIDUAL ||
        o.startsWith(`${OWL.namespace}`);
      if (isDecl) extra.push(t);
    }
  }
  return extra;
}

/**
 * extractBotModule — the ⊥-module of `axioms` for `signature`.
 *
 * Standard single ⊥-locality fixpoint: include any axiom not ⊥-local w.r.t. the
 * growing module signature, until fixpoint. The result is SOUND (preserves every
 * Σ-entailment) and is the well-known ⊥-locality-based module.
 *
 * Returns the subset of the INPUT triples (same object references) that belong
 * to the module: for every included axiom unit, all of its triples.
 */
export function extractBotModule(
  axioms: LocalityTriple[],
  signature: string[] | Set<string>,
  opts?: LocalityOptions,
): LocalityTriple[] {
  return extractModule(axioms, signature, "bot", opts);
}

/**
 * extractTopModule — the ⊤-module (the ⊤-locality fixpoint). Exposed mainly so
 * the star module and tests can use it directly. Also sound.
 */
export function extractTopModule(
  axioms: LocalityTriple[],
  signature: string[] | Set<string>,
  opts?: LocalityOptions,
): LocalityTriple[] {
  return extractModule(axioms, signature, "top", opts);
}

function extractModule(
  axioms: LocalityTriple[],
  signature: string[] | Set<string>,
  mode: "bot" | "top",
  opts?: LocalityOptions,
): LocalityTriple[] {
  const idx = buildIndex(axioms);
  const units = buildAxiomUnits(idx);
  const sigma = new Set<string>(signature instanceof Set ? signature : signature);

  const included = localityFixpoint(idx, units, sigma, mode);

  return materialize(idx, units, included, sigma, opts);
}

/**
 * extractStarModule — the iterated ⊤⊥* ("star") module.
 *
 * Algorithm (JAIR 2008, §"Nested locality-based modules"): alternate ⊤- and ⊥-
 * module extraction, each time restricting the ontology to the previous module's
 * axioms, until the module stops shrinking (fixpoint). The star module is ⊆ the
 * ⊥-module and ⊆ the ⊤-module, and is still SOUND (it preserves all Σ-entailments
 * — it is the smallest of the syntactic-locality modules).
 */
export function extractStarModule(
  axioms: LocalityTriple[],
  signature: string[] | Set<string>,
  opts?: LocalityOptions,
): LocalityTriple[] {
  const sig = new Set<string>(signature instanceof Set ? signature : signature);

  // Work over the surviving triple set; each round re-extracts on the previous
  // module. Σ stays fixed at the requested signature throughout (the standard
  // ⊤⊥* schedule). The module monotonically shrinks (a module of a subset is a
  // subset), so the loop terminates when the size stops changing. The iteration
  // cap is a defensive guard only — convergence is guaranteed.
  let current = axioms;
  for (let iter = 0; iter < axioms.length + 2; iter++) {
    // ⊤ then ⊥ each round (the ⊤⊥* alternation).
    const top = extractModule(current, sig, "top");
    const bot = extractModule(top, sig, "bot");
    if (bot.length === current.length) {
      current = bot;
      break; // fixpoint reached
    }
    current = bot;
  }

  // Final pass to apply opts (declarations) consistently.
  if (opts?.includeDeclarationsForSignature) {
    const idx = buildIndex(axioms);
    const sigmaFinal = signatureOf(current);
    for (const s of sig) sigmaFinal.add(s);
    const decls = collectDeclarations(idx, sigmaFinal);
    return dedupe([...current, ...decls]);
  }
  return current;
}

/**
 * Build the output triple list from the included unit indices. Preserves input
 * order and referential identity, de-duplicating shared triples (a blank node
 * referenced by two included axioms appears once).
 */
function materialize(
  idx: TripleIndex,
  units: AxiomUnit[],
  included: Set<number>,
  sigma: Set<string>,
  opts?: LocalityOptions,
): LocalityTriple[] {
  const keep = new Set<LocalityTriple>();
  for (const i of included) {
    for (const t of units[i].triples) keep.add(t);
  }

  if (opts?.includeDeclarationsForSignature) {
    for (const d of collectDeclarations(idx, sigma)) keep.add(d);
  }

  // Emit in original input order for determinism.
  const out: LocalityTriple[] = [];
  for (const t of idx.triples) {
    if (keep.has(t)) out.push(t);
  }
  return out;
}

/** De-duplicate triples by reference identity, preserving order. */
function dedupe(triples: LocalityTriple[]): LocalityTriple[] {
  const seen = new Set<LocalityTriple>();
  const out: LocalityTriple[] = [];
  for (const t of triples) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}
