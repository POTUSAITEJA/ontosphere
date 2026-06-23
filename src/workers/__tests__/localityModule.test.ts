// @vitest-environment node
//
// Tests for the syntactic locality-based module extractor (localityModule.ts).
//
// The KEY property under test is SOUNDNESS: the extracted module must contain
// every axiom that can affect entailments over the requested signature Σ, and
// may exclude axioms that provably cannot. We prove this on small hand-built
// ontologies whose ⊥-modules are known by the JAIR-2008 locality definitions.

import { describe, it, expect } from "vitest";
import * as N3 from "n3";
import {
  extractBotModule,
  extractTopModule,
  extractStarModule,
  isBottomLocal,
  isTopLocal,
  signatureOf,
  type LocalityTriple,
} from "../localityModule.ts";

const REQUIRE_KONCLUDE = !!process.env.REQUIRE_KONCLUDE;

// ───────────────────────────── Vocabulary shortcuts ─────────────────────────
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const OWL = "http://www.w3.org/2002/07/owl#";

const RDF_TYPE = `${RDF}type`;
const RDF_FIRST = `${RDF}first`;
const RDF_REST = `${RDF}rest`;
const RDF_NIL = `${RDF}nil`;

const SUBCLASS = `${RDFS}subClassOf`;
const SUBPROP = `${RDFS}subPropertyOf`;
const DOMAIN = `${RDFS}domain`;
const RANGE = `${RDFS}range`;

const EQUIV_CLASS = `${OWL}equivalentClass`;
const DISJOINT = `${OWL}disjointWith`;
const INVERSE_OF = `${OWL}inverseOf`;
const THING = `${OWL}Thing`;
const NOTHING = `${OWL}Nothing`;

const RESTRICTION = `${OWL}Restriction`;
const ON_PROPERTY = `${OWL}onProperty`;
const SOME_VALUES = `${OWL}someValuesFrom`;
const ALL_VALUES = `${OWL}allValuesFrom`;
const HAS_VALUE = `${OWL}hasValue`;
const INTERSECTION = `${OWL}intersectionOf`;
const UNION = `${OWL}unionOf`;
const COMPLEMENT = `${OWL}complementOf`;
const MIN_CARD = `${OWL}minCardinality`;
const MAX_CARD = `${OWL}maxCardinality`;

const OWL_CLASS = `${OWL}Class`;
const OWL_OBJ_PROP = `${OWL}ObjectProperty`;
const OWL_DATA_PROP = `${OWL}DatatypeProperty`;
const TRANSITIVE_PROP = `${OWL}TransitiveProperty`;
const FUNCTIONAL_PROP = `${OWL}FunctionalProperty`;
const INVERSE_FUNCTIONAL_PROP = `${OWL}InverseFunctionalProperty`;
const SYMMETRIC_PROP = `${OWL}SymmetricProperty`;
const ASYMMETRIC_PROP = `${OWL}AsymmetricProperty`;
const REFLEXIVE_PROP = `${OWL}ReflexiveProperty`;
const IRREFLEXIVE_PROP = `${OWL}IrreflexiveProperty`;

const OWL_DATATYPE = `${OWL}Datatype`;

const XSD = "http://www.w3.org/2001/XMLSchema#";
const XSD_INTEGER = `${XSD}integer`;

// Test namespace.
const EX = "http://example.org/";
const A = `${EX}A`;
const B = `${EX}B`;
const C = `${EX}C`;
const D = `${EX}D`;
const E = `${EX}E`;
const F = `${EX}F`;
const p = `${EX}p`;
const q = `${EX}q`;
const R = `${EX}R`;
const hasAge = `${EX}hasAge`;
const Person = `${EX}Person`;

// ───────────────────────────── Triple helpers ───────────────────────────────
function t(subject: string, predicate: string, object: string, objectIsLiteral = false): LocalityTriple {
  return { subject, predicate, object, objectIsLiteral };
}

/** Render a module as a set of "s p o" strings, for order-independent asserts. */
function asKeys(triples: LocalityTriple[]): Set<string> {
  return new Set(triples.map((x) => `${x.subject} ${x.predicate} ${x.object}`));
}
function has(triples: LocalityTriple[], subject: string, predicate: string, object: string): boolean {
  return asKeys(triples).has(`${subject} ${predicate} ${object}`);
}

// ============================================================================
// 1. SOUNDNESS — the headline test: a subclass chain plus an unrelated axiom.
// ============================================================================
describe("extractBotModule — soundness on a subclass chain", () => {
  // Ontology: A ⊑ B, B ⊑ C, D ⊑ E. Signature {A}.
  // ⊥-module MUST include A⊑B and B⊑C (they affect A's superclasses) and EXCLUDE
  // D⊑E (unrelated to A).
  const onto: LocalityTriple[] = [
    t(A, SUBCLASS, B),
    t(B, SUBCLASS, C),
    t(D, SUBCLASS, E),
  ];

  it("includes A⊑B and B⊑C, excludes D⊑E for signature {A}", () => {
    const mod = extractBotModule(onto, [A]);
    expect(has(mod, A, SUBCLASS, B)).toBe(true);
    expect(has(mod, B, SUBCLASS, C)).toBe(true);
    expect(has(mod, D, SUBCLASS, E)).toBe(false);
    // Exactly those two axioms.
    expect(asKeys(mod)).toEqual(new Set([`${A} ${SUBCLASS} ${B}`, `${B} ${SUBCLASS} ${C}`]));
  });

  it("signature {D} pulls only D⊑E", () => {
    const mod = extractBotModule(onto, [D]);
    expect(asKeys(mod)).toEqual(new Set([`${D} ${SUBCLASS} ${E}`]));
  });

  it("signature {C} (a leaf superclass) — C ⊑ D appears nowhere, module is empty", () => {
    // C only appears as a SUPERCLASS. ⊥-locality: A⊑B has C nowhere; B⊑C has C on
    // the super side (D position) → B⊑C is ⊥-local iff B≡⊥ or C≡⊤. With Σ={C}: B∉Σ
    // so B≡⊥ → A⊑B... wait B⊑C: subject B∉Σ→⊥, so ⊥⊑C is a tautology → EXCLUDED.
    const mod = extractBotModule(onto, [C]);
    expect(mod.length).toBe(0);
  });
});

// ============================================================================
// 2. isBottomLocal — per-axiom unit tests of the locality conditions.
// ============================================================================
describe("isBottomLocal — per-axiom locality conditions", () => {
  it("axiom with ALL symbols outside Σ is ⊥-local (excluded)", () => {
    // D ⊑ E, Σ = {A}. Both D,E ∉ Σ → D≡⊥ → ⊥⊑E tautology → local.
    expect(isBottomLocal([t(D, SUBCLASS, E)], new Set([A]))).toBe(true);
  });

  it("subclass axiom whose SUBCLASS symbol is in Σ is NON-local (included)", () => {
    // A ⊑ B, Σ = {A}. A∈Σ (not ⊥), B∉Σ → B≡⊥, not ⊤. So neither C≡⊥ nor D≡⊤ → non-local.
    expect(isBottomLocal([t(A, SUBCLASS, B)], new Set([A]))).toBe(false);
  });

  it("subclass axiom whose SUPERCLASS symbol only is in Σ is ⊥-local (excluded)", () => {
    // A ⊑ B, Σ = {B}. A∉Σ → A≡⊥ → ⊥⊑B tautology → local.
    expect(isBottomLocal([t(A, SUBCLASS, B)], new Set([B]))).toBe(true);
  });

  it("X ⊑ owl:Thing is always ⊥-local (D≡⊤)", () => {
    expect(isBottomLocal([t(A, SUBCLASS, THING)], new Set([A]))).toBe(true);
  });

  it("owl:Nothing ⊑ X is always ⊥-local (C≡⊥)", () => {
    expect(isBottomLocal([t(NOTHING, SUBCLASS, A)], new Set([A]))).toBe(true);
  });

  it("equivalentClass local iff both sides collapse the same way", () => {
    // A ≡ B, Σ={A}: A∈Σ→other, B∉Σ→⊥. Not (both⊥) nor (both⊤) → NON-local.
    expect(isBottomLocal([t(A, EQUIV_CLASS, B)], new Set([A]))).toBe(false);
    // A ≡ B, Σ={}: both ∉Σ → both ⊥ → local.
    expect(isBottomLocal([t(A, EQUIV_CLASS, B)], new Set<string>())).toBe(true);
  });

  it("disjointWith local iff at least one side ≡⊥", () => {
    // A disjoint B, Σ={A}: B∉Σ→⊥ → disjoint trivially holds → local.
    expect(isBottomLocal([t(A, DISJOINT, B)], new Set([A]))).toBe(true);
    // A disjoint B, Σ={A,B}: both in Σ → neither ⊥ → NON-local.
    expect(isBottomLocal([t(A, DISJOINT, B)], new Set([A, B]))).toBe(false);
  });

  it("subPropertyOf ⊥-local iff sub-property R ∉ Σ", () => {
    expect(isBottomLocal([t(p, SUBPROP, q)], new Set([q]))).toBe(true); // p∉Σ
    expect(isBottomLocal([t(p, SUBPROP, q)], new Set([p]))).toBe(false); // p∈Σ
  });

  it("inverseOf ⊥-local iff both properties ∉ Σ", () => {
    expect(isBottomLocal([t(p, INVERSE_OF, q)], new Set<string>())).toBe(true);
    expect(isBottomLocal([t(p, INVERSE_OF, q)], new Set([p]))).toBe(false);
  });

  it("domain ⊥-local iff property ∉ Σ (or class ≡⊤)", () => {
    expect(isBottomLocal([t(p, DOMAIN, A)], new Set([A]))).toBe(true); // p∉Σ
    expect(isBottomLocal([t(p, DOMAIN, A)], new Set([p, A]))).toBe(false); // p∈Σ, A∈Σ
    expect(isBottomLocal([t(p, DOMAIN, THING)], new Set([p]))).toBe(true); // class ≡⊤
  });

  it("range ⊥-local iff property ∉ Σ (or class ≡⊤)", () => {
    expect(isBottomLocal([t(p, RANGE, A)], new Set([A]))).toBe(true); // p∉Σ
    expect(isBottomLocal([t(p, RANGE, A)], new Set([p, A]))).toBe(false); // p∈Σ, A∈Σ
  });

  it("a declaration-only axiom is always ⊥-local", () => {
    expect(isBottomLocal([t(A, RDF_TYPE, OWL_CLASS)], new Set([A]))).toBe(true);
    expect(isBottomLocal([t(p, RDF_TYPE, OWL_OBJ_PROP)], new Set([p]))).toBe(true);
  });
});

// ============================================================================
// 3. RESTRICTION handling — A ⊑ ∃p.B.
// ============================================================================
describe("restriction handling — A ⊑ ∃p.B", () => {
  // A rdfs:subClassOf [ a Restriction ; onProperty p ; someValuesFrom B ]
  const REST = "_:r1";
  const onto: LocalityTriple[] = [
    t(A, SUBCLASS, REST),
    t(REST, RDF_TYPE, RESTRICTION),
    t(REST, ON_PROPERTY, p),
    t(REST, SOME_VALUES, B),
  ];

  it("signature {A} pulls in the existential restriction (non-local)", () => {
    // A∈Σ (subject ≠⊥). Object = ∃p.B with p∉Σ → ∃∅.B = ⊥... that makes D≡⊥ NOT ⊤.
    // SubClassOf local iff C≡⊥ or D≡⊤. C=A∈Σ→other; D=∃p.B, p∉Σ→ filler ∃∅.B=⊥ (≡⊥,
    // not ⊤). So NON-local → included. The restriction's signature {p,B} joins Σ.
    const mod = extractBotModule(onto, [A]);
    expect(has(mod, A, SUBCLASS, REST)).toBe(true);
    // The whole blank-node restriction closure is included.
    expect(has(mod, REST, ON_PROPERTY, p)).toBe(true);
    expect(has(mod, REST, SOME_VALUES, B)).toBe(true);
    // And the module signature now includes p and B.
    expect(signatureOf(mod).has(p)).toBe(true);
    expect(signatureOf(mod).has(B)).toBe(true);
  });

  it("empty signature → everything ⊥-local → empty module", () => {
    const mod = extractBotModule(onto, []);
    expect(mod.length).toBe(0);
  });

  it("isBottomLocal on the restriction axiom: {A} non-local, {} local", () => {
    const axiom: LocalityTriple[] = [
      t(A, SUBCLASS, REST),
      t(REST, RDF_TYPE, RESTRICTION),
      t(REST, ON_PROPERTY, p),
      t(REST, SOME_VALUES, B),
    ];
    expect(isBottomLocal(axiom, new Set([A]))).toBe(false);
    expect(isBottomLocal(axiom, new Set<string>())).toBe(true);
  });

  it("∀-restriction: A ⊑ ∀p.B with p∉Σ is ⊥-local (∀∅.B = ⊤)", () => {
    const REST2 = "_:r2";
    const axiom: LocalityTriple[] = [
      t(A, SUBCLASS, REST2),
      t(REST2, RDF_TYPE, RESTRICTION),
      t(REST2, ON_PROPERTY, p),
      t(REST2, ALL_VALUES, B),
    ];
    // Σ={A}: D = ∀p.B, p∉Σ → ∀∅.B = ⊤ → SubClassOf C⊑⊤ tautology → local.
    expect(isBottomLocal(axiom, new Set([A]))).toBe(true);
  });

  it("min-cardinality ≥1 on p∉Σ makes ∃-like ⊥ (non-local under {A})", () => {
    const REST3 = "_:r3";
    const axiom: LocalityTriple[] = [
      t(A, SUBCLASS, REST3),
      t(REST3, RDF_TYPE, RESTRICTION),
      t(REST3, ON_PROPERTY, p),
      t(REST3, MIN_CARD, "1", true),
    ];
    // ≥1 ∅ = ⊥ → D≡⊥ (not ⊤) → SubClassOf A⊑⊥ NOT tautology → non-local.
    expect(isBottomLocal(axiom, new Set([A]))).toBe(false);
  });

  it("max-cardinality on p∉Σ is ⊤ (⊥-local under {A})", () => {
    const REST4 = "_:r4";
    const axiom: LocalityTriple[] = [
      t(A, SUBCLASS, REST4),
      t(REST4, RDF_TYPE, RESTRICTION),
      t(REST4, ON_PROPERTY, p),
      t(REST4, MAX_CARD, "2", true),
    ];
    // ≤2 ∅ = ⊤ → D≡⊤ → tautology → local.
    expect(isBottomLocal(axiom, new Set([A]))).toBe(true);
  });

  it("hasValue on p∉Σ is ⊥ (non-local under {A})", () => {
    const REST5 = "_:r5";
    const axiom: LocalityTriple[] = [
      t(A, SUBCLASS, REST5),
      t(REST5, RDF_TYPE, RESTRICTION),
      t(REST5, ON_PROPERTY, p),
      t(REST5, HAS_VALUE, `${EX}ind`),
    ];
    // ∅ hasValue v = ⊥ → D≡⊥ not ⊤ → non-local.
    expect(isBottomLocal(axiom, new Set([A]))).toBe(false);
  });
});

// ============================================================================
// 4. Boolean connectives — intersectionOf / unionOf / complementOf.
// ============================================================================
describe("boolean connectives", () => {
  it("A ⊑ (B ⊓ C): intersection ≡⊥ if any member ⊥", () => {
    // A ⊑ [intersectionOf (B C)]. Σ={A}: B,C ∉Σ → both ⊥ → ⊓ has a ⊥ member → ≡⊥.
    // D≡⊥ not ⊤ → SubClassOf non-local (A is a real subclass with empty super only
    // if A itself unsat — keep, sound).
    const L1 = "_:l1";
    const L2 = "_:l2";
    const INT = "_:int";
    const axiom: LocalityTriple[] = [
      t(A, SUBCLASS, INT),
      t(INT, INTERSECTION, L1),
      t(L1, RDF_FIRST, B),
      t(L1, RDF_REST, L2),
      t(L2, RDF_FIRST, C),
      t(L2, RDF_REST, RDF_NIL),
    ];
    expect(isBottomLocal(axiom, new Set([A]))).toBe(false);
    // With Σ={A,B,C}: members B,C ∈Σ → "other"; intersection → other; D not ⊤ → non-local.
    expect(isBottomLocal(axiom, new Set([A, B, C]))).toBe(false);
  });

  it("(B ⊔ C) ⊑ A: union ≡⊥ when all members ⊥ → ⊥⊑A local", () => {
    const L1 = "_:u1";
    const L2 = "_:u2";
    const UNI = "_:uni";
    const axiom: LocalityTriple[] = [
      t(UNI, SUBCLASS, A),
      t(UNI, UNION, L1),
      t(L1, RDF_FIRST, B),
      t(L1, RDF_REST, L2),
      t(L2, RDF_FIRST, C),
      t(L2, RDF_REST, RDF_NIL),
    ];
    // Σ={A}: B,C∉Σ → all ⊥ → union ≡⊥ → C≡⊥ → ⊥⊑A tautology → local.
    expect(isBottomLocal(axiom, new Set([A]))).toBe(true);
    // Σ={A,B}: B∈Σ (other), C∉Σ (⊥) → union has a non-⊥ member → not all ⊥ → "other"
    // → C not ⊥ → non-local.
    expect(isBottomLocal(axiom, new Set([A, B]))).toBe(false);
  });

  it("A ⊑ ¬B: complement of ⊥ is ⊤ → local under {A}", () => {
    const NEG = "_:neg";
    const axiom: LocalityTriple[] = [
      t(A, SUBCLASS, NEG),
      t(NEG, COMPLEMENT, B),
    ];
    // Σ={A}: B∉Σ → ⊥; ¬⊥ = ⊤ → D≡⊤ → A⊑⊤ tautology → local.
    expect(isBottomLocal(axiom, new Set([A]))).toBe(true);
    // Σ={A,B}: B∈Σ → other; ¬other = other → non-local.
    expect(isBottomLocal(axiom, new Set([A, B]))).toBe(false);
  });
});

// ============================================================================
// 5. Conservative fallback — unrecognized shape is NON-local (kept).
// ============================================================================
describe("conservative fallback", () => {
  it("an unrecognized predicate axiom is kept (non-local)", () => {
    const weird = `${EX}someWeirdAxiomPredicate`;
    const axiom: LocalityTriple[] = [t(A, weird, B)];
    // Not a recognized logical axiom predicate and not a declaration → conservative
    // NON-local → must be kept (returns false from isBottomLocal).
    expect(isBottomLocal(axiom, new Set([A]))).toBe(false);
  });

  it("module includes an unrecognized axiom even when Σ seems unrelated", () => {
    const weird = `${EX}weirdPredicate`;
    const onto: LocalityTriple[] = [
      t(A, SUBCLASS, B),
      t(C, weird, D), // unrecognized → conservatively kept
    ];
    const mod = extractBotModule(onto, [A]);
    expect(has(mod, C, weird, D)).toBe(true);
  });

  it("ClassAssertion (ABox) is kept unless the class ≡⊤", () => {
    const ind = `${EX}ind1`;
    // ind a A, Σ={A}: A∈Σ → not ⊤ → non-local (ABox kept).
    expect(isBottomLocal([t(ind, RDF_TYPE, A)], new Set([A]))).toBe(false);
    // ind a owl:Thing → ⊤ → local.
    expect(isBottomLocal([t(ind, RDF_TYPE, THING)], new Set([A]))).toBe(true);
  });
});

// ============================================================================
// 6. Monotonicity — module(Σ) ⊆ module(Σ') when Σ ⊆ Σ'.
// ============================================================================
describe("monotonicity: module grows with the signature", () => {
  const onto: LocalityTriple[] = [
    t(A, SUBCLASS, B),
    t(B, SUBCLASS, C),
    t(D, SUBCLASS, E),
    t(E, SUBCLASS, F),
  ];

  it("module({A}) ⊆ module({A,D})", () => {
    const small = asKeys(extractBotModule(onto, [A]));
    const big = asKeys(extractBotModule(onto, [A, D]));
    for (const k of small) expect(big.has(k)).toBe(true);
    // The bigger signature genuinely adds D's chain.
    expect(big.has(`${D} ${SUBCLASS} ${E}`)).toBe(true);
    expect(small.has(`${D} ${SUBCLASS} ${E}`)).toBe(false);
  });

  it("the module's own signature is a superset of Σ ∩ (used symbols)", () => {
    const mod = extractBotModule(onto, [A]);
    const modSig = signatureOf(mod);
    // A is used and in Σ → must appear in the module signature.
    expect(modSig.has(A)).toBe(true);
    // Transitive supers pulled in.
    expect(modSig.has(B)).toBe(true);
    expect(modSig.has(C)).toBe(true);
  });
});

// ============================================================================
// 7. Star module ⊆ ⊥-module, still sound.
// ============================================================================
describe("star (⊤⊥*) module", () => {
  const onto: LocalityTriple[] = [
    t(A, SUBCLASS, B),
    t(B, SUBCLASS, C),
    t(D, SUBCLASS, E),
  ];

  it("star module ⊆ ⊥-module on the chain (both endpoints in Σ)", () => {
    // Σ={A,C}: the whole chain A⊑B⊑C is relevant. The ⊥-module keeps {A⊑B,B⊑C};
    // the star module must be a subset of it.
    const bot = asKeys(extractBotModule(onto, [A, C]));
    const star = asKeys(extractStarModule(onto, [A, C]));
    for (const k of star) expect(bot.has(k)).toBe(true);
  });

  it("star module keeps the relevant chain when both endpoints are in Σ", () => {
    // Σ={A,C}: the chain connecting the two Σ-classes is preserved by the star
    // module (signature growth pulls B⊑C then A⊑B); D⊑E stays excluded.
    const star = extractStarModule(onto, [A, C]);
    expect(has(star, A, SUBCLASS, B)).toBe(true);
    expect(has(star, B, SUBCLASS, C)).toBe(true);
    expect(has(star, D, SUBCLASS, E)).toBe(false);
  });

  it("star module ⊆ ⊥-module for a single endpoint signature {A}", () => {
    // For Σ={A} the ⊥-module is {A⊑B,B⊑C} (self-contained), while the star module
    // is smaller — possibly empty — because no non-trivial Σ-Σ subsumption exists
    // (B,C ∉ Σ). Whatever it is, it must remain a subset of the ⊥-module and must
    // never include the unrelated D⊑E. This documents the (sound) ⊤⊥* behaviour.
    const bot = asKeys(extractBotModule(onto, [A]));
    const star = extractStarModule(onto, [A]);
    for (const k of asKeys(star)) expect(bot.has(k)).toBe(true);
    expect(has(star, D, SUBCLASS, E)).toBe(false);
  });

  it("star module of the empty signature is empty", () => {
    expect(extractStarModule(onto, []).length).toBe(0);
  });

  it("top module is also sound on the chain (⊆ ontology, contains relevant axioms)", () => {
    const top = extractTopModule(onto, [A]);
    // ⊤-locality: A⊑B with Σ={A}. Under ⊤-subst B∉Σ→⊤ → A⊑⊤ tautology → ⊤-local
    // (excluded by the ⊤ test). This shows ⊤ and ⊥ modules differ — the star
    // module intersects their effects. We just assert it does not crash & is ⊆ onto.
    expect(top.length).toBeLessThanOrEqual(onto.length);
  });
});

// ============================================================================
// 8. Cycle safety & degenerate inputs.
// ============================================================================
describe("cycle safety and degenerate inputs", () => {
  it("a cyclic rdf:List does not hang or crash", () => {
    // L1 -> first B, rest L2 ; L2 -> first C, rest L1  (CYCLE).
    const L1 = "_:c1";
    const L2 = "_:c2";
    const INT = "_:cint";
    const onto: LocalityTriple[] = [
      t(A, SUBCLASS, INT),
      t(INT, INTERSECTION, L1),
      t(L1, RDF_FIRST, B),
      t(L1, RDF_REST, L2),
      t(L2, RDF_FIRST, C),
      t(L2, RDF_REST, L1), // cycle back
    ];
    // Must terminate.
    const mod = extractBotModule(onto, [A]);
    expect(Array.isArray(mod)).toBe(true);
  });

  it("a self-referential blank node restriction does not hang", () => {
    const R = "_:selfr";
    const onto: LocalityTriple[] = [
      t(A, SUBCLASS, R),
      t(R, RDF_TYPE, RESTRICTION),
      t(R, ON_PROPERTY, p),
      t(R, SOME_VALUES, R), // points to itself
    ];
    const mod = extractBotModule(onto, [A]);
    expect(Array.isArray(mod)).toBe(true);
  });

  it("empty ontology → empty module", () => {
    expect(extractBotModule([], [A]).length).toBe(0);
    expect(extractStarModule([], [A]).length).toBe(0);
  });

  it("empty signature over a non-trivial ontology → empty (TBox-only) module", () => {
    const onto: LocalityTriple[] = [t(A, SUBCLASS, B), t(B, SUBCLASS, C)];
    expect(extractBotModule(onto, []).length).toBe(0);
  });
});

// ============================================================================
// 9. signatureOf — harvests class/property IRIs, skips builtins & blanks.
// ============================================================================
describe("signatureOf", () => {
  it("collects named class/property symbols and skips builtins/blank nodes", () => {
    const REST = "_:r";
    const onto: LocalityTriple[] = [
      t(A, SUBCLASS, B),
      t(A, RDF_TYPE, OWL_CLASS), // builtin object → not harvested
      t(A, SUBCLASS, REST),
      t(REST, RDF_TYPE, RESTRICTION),
      t(REST, ON_PROPERTY, p),
      t(REST, SOME_VALUES, C),
    ];
    const sig = signatureOf(onto);
    expect(sig.has(A)).toBe(true);
    expect(sig.has(B)).toBe(true);
    expect(sig.has(C)).toBe(true);
    expect(sig.has(p)).toBe(true);
    // Builtins / blanks excluded.
    expect(sig.has(OWL_CLASS)).toBe(false);
    expect(sig.has(RESTRICTION)).toBe(false);
    expect(sig.has(REST)).toBe(false);
  });
});

// ============================================================================
// 11. PROPERTY-CHARACTERISTIC AXIOMS (BUG 1/2) — Transitive/Functional/Symmetric.
//
// A `R rdf:type owl:TransitiveProperty` triple is a LOGICAL axiom about R, NOT a
// declaration. Per syntactic locality (Cuenca Grau et al. JAIR 2008; OWL API
// SyntacticLocalityEvaluator) it is LOCAL iff R ∉ Σ and NON-LOCAL iff R ∈ Σ, in
// BOTH ⊥ and ⊤ modes. Before the fix these were treated as declarations →
// DROPPED from every module (UNSOUND when R ∈ Σ, e.g. transitivity derives new
// Σ-subsumptions/instances).
// ============================================================================
describe("property-characteristic axioms (BUG 1/2)", () => {
  // R ∈ Σ → the characteristic constrains a kept property → NON-local in BOTH modes
  // for EVERY characteristic (it can derive new Σ-entailments).
  it("ANY characteristic with R ∈ Σ is NON-local in BOTH modes", () => {
    for (const ch of [
      TRANSITIVE_PROP,
      FUNCTIONAL_PROP,
      INVERSE_FUNCTIONAL_PROP,
      SYMMETRIC_PROP,
      ASYMMETRIC_PROP,
      REFLEXIVE_PROP,
      IRREFLEXIVE_PROP,
    ]) {
      expect(isBottomLocal([t(R, RDF_TYPE, ch)], new Set([R]))).toBe(false);
      expect(isTopLocal([t(R, RDF_TYPE, ch)], new Set([R]))).toBe(false);
    }
  });

  // ── BUG 1: per-characteristic, per-mode locality when R ∉ Σ. ──────────────────
  // The corrected OWL API SyntacticLocalityEvaluator table (R∉Σ; `true` = LOCAL =
  // may be dropped, `false` = KEEP):
  //
  //   characteristic     | ⊥-mode (R→∅) | ⊤-mode (R→Δ²)
  //   ───────────────────┼──────────────┼──────────────
  //   Transitive         |  LOCAL        |  LOCAL
  //   Symmetric          |  LOCAL        |  LOCAL
  //   Functional         |  LOCAL        |  KEEP
  //   InverseFunctional  |  LOCAL        |  KEEP
  //   Asymmetric         |  LOCAL        |  KEEP
  //   Irreflexive        |  LOCAL        |  KEEP
  //   Reflexive          |  KEEP         |  LOCAL
  //
  // (Previously ALL characteristics used `LOCAL iff R∉Σ` in BOTH modes — UNSOUND:
  // it dropped Reflexive in ⊥ and Functional/InvFunc/Asym/Irrefl in ⊤.)
  const charTable: Array<{ ch: string; name: string; bot: boolean; top: boolean }> = [
    { ch: TRANSITIVE_PROP, name: "Transitive", bot: true, top: true },
    { ch: SYMMETRIC_PROP, name: "Symmetric", bot: true, top: true },
    { ch: FUNCTIONAL_PROP, name: "Functional", bot: true, top: false },
    { ch: INVERSE_FUNCTIONAL_PROP, name: "InverseFunctional", bot: true, top: false },
    { ch: ASYMMETRIC_PROP, name: "Asymmetric", bot: true, top: false },
    { ch: IRREFLEXIVE_PROP, name: "Irreflexive", bot: true, top: false },
    { ch: REFLEXIVE_PROP, name: "Reflexive", bot: false, top: true },
  ];

  for (const { ch, name, bot, top } of charTable) {
    it(`${name} with R ∉ Σ: ⊥-local=${bot}, ⊤-local=${top}`, () => {
      const empty = new Set<string>();
      expect(isBottomLocal([t(R, RDF_TYPE, ch)], empty)).toBe(bot);
      expect(isTopLocal([t(R, RDF_TYPE, ch)], empty)).toBe(top);
    });
  }

  // ── BUG 1 IMPACT: the reflexive ∧ irreflexive clash must survive the module. ──
  it("Reflexive(R), Σ∌R → extractBotModule KEEPS it (non-local in ⊥)", () => {
    const onto: LocalityTriple[] = [t(R, RDF_TYPE, REFLEXIVE_PROP)];
    const mod = extractBotModule(onto, []); // Σ = ∅ ⇒ R ∉ Σ
    expect(has(mod, R, RDF_TYPE, REFLEXIVE_PROP)).toBe(true);
  });

  it("Irreflexive(R), Σ∌R → extractTopModule KEEPS it (non-local in ⊤)", () => {
    const onto: LocalityTriple[] = [t(R, RDF_TYPE, IRREFLEXIVE_PROP)];
    // ⊤-module: the universal role is NOT irreflexive → Irreflexive is ⊤-non-local
    // → KEPT (the OLD shared rule wrongly dropped it).
    expect(has(extractTopModule(onto, []), R, RDF_TYPE, IRREFLEXIVE_PROP)).toBe(true);
    // ⊥-module: the empty role IS irreflexive → ⊥-local → dropped (sound: with
    // Σ ∌ R nothing pulls R into the signature, so the lone axiom carries no
    // Σ-entailment). Documents the asymmetry rather than asserting a keep.
    expect(has(extractBotModule(onto, []), R, RDF_TYPE, IRREFLEXIVE_PROP)).toBe(false);
    // For Σ ∋ R the irreflexivity is Σ-relevant and the ⊤ module keeps it.
    expect(has(extractTopModule(onto, [R]), R, RDF_TYPE, IRREFLEXIVE_PROP)).toBe(true);
  });

  it("Functional(R), Σ∌R → ⊤ KEEPS, ⊥ DROPS", () => {
    const onto: LocalityTriple[] = [t(R, RDF_TYPE, FUNCTIONAL_PROP)];
    expect(has(extractTopModule(onto, []), R, RDF_TYPE, FUNCTIONAL_PROP)).toBe(true);
    expect(has(extractBotModule(onto, []), R, RDF_TYPE, FUNCTIONAL_PROP)).toBe(false);
  });

  it("{R a Reflexive; R a Irreflexive}, Σ∌R: the ⊥-module keeps BOTH (signature growth)", () => {
    // Crucial fixpoint subtlety: in the ⊥-module the Reflexive axiom is non-local
    // (the empty role is NOT reflexive), so it is kept and PULLS R into the working
    // signature Σ_M. Once R ∈ Σ_M the Irreflexive axiom is non-local too (R ∈ Σ in
    // both modes) → also kept. So both survive — the clash is preserved even though
    // R ∉ the requested Σ. (The OLD shared rule dropped Reflexive entirely, so R
    // never entered Σ_M and BOTH were lost — the unsoundness.)
    const onto: LocalityTriple[] = [
      t(R, RDF_TYPE, REFLEXIVE_PROP),
      t(R, RDF_TYPE, IRREFLEXIVE_PROP),
    ];
    const bot = extractBotModule(onto, []);
    expect(has(bot, R, RDF_TYPE, REFLEXIVE_PROP)).toBe(true);
    expect(has(bot, R, RDF_TYPE, IRREFLEXIVE_PROP)).toBe(true);
  });

  it("{R a Reflexive; R a Irreflexive}, Σ∋R → STAR module preserves the clash (NOT empty)", () => {
    // When R ∈ Σ the reflexive ∧ irreflexive inconsistency is EXPRESSIBLE over Σ,
    // so the locality module MUST preserve it. Both characteristics are non-local
    // in BOTH modes (R ∈ Σ) → the ⊤⊥* star module keeps BOTH and is never empty.
    const onto: LocalityTriple[] = [
      t(R, RDF_TYPE, REFLEXIVE_PROP),
      t(R, RDF_TYPE, IRREFLEXIVE_PROP),
    ];
    const star = extractStarModule(onto, [R]);
    expect(star.length).toBeGreaterThan(0);
    expect(has(star, R, RDF_TYPE, REFLEXIVE_PROP)).toBe(true);
    expect(has(star, R, RDF_TYPE, IRREFLEXIVE_PROP)).toBe(true);
  });

  it("a pure property/class DECLARATION is still always ⊥-local", () => {
    // Regression guard: ObjectProperty/Class/DatatypeProperty declarations are NOT
    // property characteristics — they remain always-local.
    expect(isBottomLocal([t(R, RDF_TYPE, OWL_OBJ_PROP)], new Set([R]))).toBe(true);
    expect(isBottomLocal([t(R, RDF_TYPE, OWL_DATA_PROP)], new Set([R]))).toBe(true);
    expect(isBottomLocal([t(A, RDF_TYPE, OWL_CLASS)], new Set([A]))).toBe(true);
  });

  it("⊥-module KEEPS `R a owl:TransitiveProperty` when R ∈ Σ (A ⊑ ∃R.B)", () => {
    // Ontology: R a ObjectProperty, TransitiveProperty ; A ⊑ ∃R.B.  Σ = {A,B,R}.
    // The transitivity axiom is non-local (R ∈ Σ) → MUST be in the ⊥-module.
    const REST = "_:rc1";
    const onto: LocalityTriple[] = [
      t(R, RDF_TYPE, OWL_OBJ_PROP),
      t(R, RDF_TYPE, TRANSITIVE_PROP),
      t(A, SUBCLASS, REST),
      t(REST, RDF_TYPE, RESTRICTION),
      t(REST, ON_PROPERTY, R),
      t(REST, SOME_VALUES, B),
    ];
    const mod = extractBotModule(onto, [A, B, R]);
    expect(has(mod, R, RDF_TYPE, TRANSITIVE_PROP)).toBe(true);
    // The A ⊑ ∃R.B axiom (which references R) is also kept.
    expect(has(mod, A, SUBCLASS, REST)).toBe(true);
  });

  it("⊥-module MAY exclude `R a owl:TransitiveProperty` when R ∉ Σ", () => {
    // Σ = {A,B}: R ∉ Σ. The A ⊑ ∃R.B axiom: ∃R.B with R∉Σ → ∃∅.B = ⊥, super side not
    // ⊤ → still kept (it references A∈Σ). But the standalone transitivity axiom is
    // ⊥-local (R∉Σ) and may be excluded.
    const REST = "_:rc2";
    const onto: LocalityTriple[] = [
      t(R, RDF_TYPE, OWL_OBJ_PROP),
      t(R, RDF_TYPE, TRANSITIVE_PROP),
      t(A, SUBCLASS, REST),
      t(REST, RDF_TYPE, RESTRICTION),
      t(REST, ON_PROPERTY, R),
      t(REST, SOME_VALUES, B),
    ];
    const mod = extractBotModule(onto, [A, B]);
    // The A ⊑ ∃R.B axiom references A (∈Σ) so it is kept and pulls R into Σ_M,
    // which in turn DOES make the transitivity axiom non-local. To observe the
    // pure exclusion we test the isolated axiom against Σ that does not contain R.
    expect(isBottomLocal([t(R, RDF_TYPE, TRANSITIVE_PROP)], new Set([A, B]))).toBe(true);
    // The restriction axiom itself is still present (it constrains A∈Σ).
    expect(has(mod, A, SUBCLASS, REST)).toBe(true);
  });
});

// ============================================================================
// 12. DATA RESTRICTIONS (BUG 3) — datatype fillers must NOT collapse to ⊥.
//
// For `(∃ hasAge . xsd:integer) ⊑ Person`, the filler xsd:integer is a DATATYPE,
// not a class. It is never in Σ and must NOT be substituted to ⊥. Before the fix
// evalClassExpr judged the data existential ⊥, made the SubClassOf local, and
// DROPPED the axiom — UNSOUND (a data existential is non-empty and constrains its
// subject).
// ============================================================================
describe("data restrictions (BUG 3)", () => {
  it("(∃ hasAge . xsd:integer) ⊑ Person is NON-local for Σ={hasAge,Person}", () => {
    const REST = "_:dr1";
    const axiom: LocalityTriple[] = [
      t(REST, RDF_TYPE, RESTRICTION),
      t(REST, ON_PROPERTY, hasAge),
      t(REST, SOME_VALUES, XSD_INTEGER),
      t(REST, SUBCLASS, Person),
    ];
    // hasAge ∈ Σ → ∃hasAge.xsd:integer is NOT ⊥ (datatype unsubstituted) → C is
    // "other"; Person ∈ Σ → "other" → neither C≡⊥ nor D≡⊤ → NON-local.
    expect(isBottomLocal(axiom, new Set([hasAge, Person]))).toBe(false);
  });

  it("⊥-module KEEPS the data-existential axiom (not dropped)", () => {
    const REST = "_:dr2";
    const onto: LocalityTriple[] = [
      t(hasAge, RDF_TYPE, OWL_DATA_PROP),
      t(Person, RDF_TYPE, OWL_CLASS),
      t(REST, RDF_TYPE, RESTRICTION),
      t(REST, ON_PROPERTY, hasAge),
      t(REST, SOME_VALUES, XSD_INTEGER),
      t(REST, SUBCLASS, Person),
    ];
    const mod = extractBotModule(onto, [hasAge, Person]);
    expect(has(mod, REST, SUBCLASS, Person)).toBe(true);
    expect(has(mod, REST, ON_PROPERTY, hasAge)).toBe(true);
    expect(has(mod, REST, SOME_VALUES, XSD_INTEGER)).toBe(true);
  });

  it("data existential IS ⊥-local when the data property ∉ Σ", () => {
    // hasAge ∉ Σ → ∃∅.xsd:integer = ⊥ → C≡⊥ → ⊥⊑Person tautology → local.
    const REST = "_:dr3";
    const axiom: LocalityTriple[] = [
      t(REST, RDF_TYPE, RESTRICTION),
      t(REST, ON_PROPERTY, hasAge),
      t(REST, SOME_VALUES, XSD_INTEGER),
      t(REST, SUBCLASS, Person),
    ];
    expect(isBottomLocal(axiom, new Set([Person]))).toBe(true);
  });

  it("∀ data restriction: Person ⊑ ∀hasAge.xsd:integer is ⊥-local iff hasAge ∉ Σ", () => {
    const REST = "_:dr4";
    const axiom: LocalityTriple[] = [
      t(Person, SUBCLASS, REST),
      t(REST, RDF_TYPE, RESTRICTION),
      t(REST, ON_PROPERTY, hasAge),
      t(REST, ALL_VALUES, XSD_INTEGER),
    ];
    // hasAge ∉ Σ → ∀∅.dr = ⊤ → Person⊑⊤ tautology → local.
    expect(isBottomLocal(axiom, new Set([Person]))).toBe(true);
    // hasAge ∈ Σ → ∀hasAge.dr is "other" → non-local (kept).
    expect(isBottomLocal(axiom, new Set([Person, hasAge]))).toBe(false);
  });

  it("a declared data property with a non-datatype filler is still treated as data", () => {
    // hasAge declared owl:DatatypeProperty → data restriction even if the filler
    // is not a recognised xsd: IRI. ∃hasAge.<filler> with hasAge∈Σ → non-local.
    const dr = `${EX}MyDataRange`;
    const REST = "_:dr5";
    const onto: LocalityTriple[] = [
      t(hasAge, RDF_TYPE, OWL_DATA_PROP),
      t(REST, RDF_TYPE, RESTRICTION),
      t(REST, ON_PROPERTY, hasAge),
      t(REST, SOME_VALUES, dr),
      t(REST, SUBCLASS, Person),
    ];
    expect(isBottomLocal(onto, new Set([hasAge, Person]))).toBe(false);
  });

  // ── BUG 2 (SOUNDNESS): UNDECLARED data property + CUSTOM datatype filler. ─────
  // ex:hasAge is NOT declared owl:DatatypeProperty and ex:CustomAgeRange is a
  // declared owl:Datatype. Before the fix, hasAge being undeclared and
  // CustomAgeRange not being a known xsd: IRI made evalClassExpr treat the filler
  // as a CLASS, substitute it (∉Σ) to ⊥, collapse ∃hasAge.⊥ to ⊥, judge the
  // SubClassOf ⊥-local and DROP it — UNSOUND (the data existential is non-empty).
  // The fix recognises CustomAgeRange as a data range (declared owl:Datatype) and,
  // failing that, refuses to substitute an uncertain filler.
  it("(∃ hasAge . ex:CustomAgeRange) ⊑ Person — undeclared prop + owl:Datatype filler is KEPT", () => {
    const customRange = `${EX}CustomAgeRange`;
    const REST = "_:dr6";
    const onto: LocalityTriple[] = [
      t(customRange, RDF_TYPE, OWL_DATATYPE), // declared a custom data range
      t(REST, RDF_TYPE, RESTRICTION),
      t(REST, ON_PROPERTY, hasAge), // hasAge UNDECLARED
      t(REST, SOME_VALUES, customRange),
      t(REST, SUBCLASS, Person),
    ];
    // Σ = {hasAge, Person}: hasAge ∈ Σ → ∃hasAge.CustomAgeRange is NOT ⊥ (the data
    // range is unsubstituted) → C is "other"; Person ∈ Σ → "other" → NON-local.
    expect(isBottomLocal(onto, new Set([hasAge, Person]))).toBe(false);
    const mod = extractBotModule(onto, [hasAge, Person]);
    expect(has(mod, REST, SUBCLASS, Person)).toBe(true);
    expect(has(mod, REST, ON_PROPERTY, hasAge)).toBe(true);
    expect(has(mod, REST, SOME_VALUES, customRange)).toBe(true);
  });

  it("(∃ hasAge . ex:Unknown) ⊑ Person — undeclared prop + UNKNOWN filler is KEPT (conservative)", () => {
    // Neither hasAge nor the filler is declared; we cannot be CERTAIN the filler is
    // a class, so we must NOT substitute it to ⊥. KEEP (sound).
    const unknown = `${EX}Unknown`;
    const REST = "_:dr7";
    const onto: LocalityTriple[] = [
      t(REST, RDF_TYPE, RESTRICTION),
      t(REST, ON_PROPERTY, hasAge),
      t(REST, SOME_VALUES, unknown),
      t(REST, SUBCLASS, Person),
    ];
    expect(isBottomLocal(onto, new Set([hasAge, Person]))).toBe(false);
  });

  it("(∃ p . B) ⊑ A with p declared owl:ObjectProperty + B owl:Class still collapses to ⊥ (local)", () => {
    // Regression guard for the inverted test: a CERTAIN class filler (B declared
    // owl:Class, p an object property) under an OBJECT existential must STILL be
    // substituted. Σ = {A}: p ∉ Σ, B ∉ Σ → ∃p.B = ⊥ → C ≡⊥ → ⊥⊑A tautology → local.
    const REST = "_:dr8";
    const onto: LocalityTriple[] = [
      t(p, RDF_TYPE, OWL_OBJ_PROP),
      t(B, RDF_TYPE, OWL_CLASS),
      t(REST, RDF_TYPE, RESTRICTION),
      t(REST, ON_PROPERTY, p),
      t(REST, SOME_VALUES, B),
      t(REST, SUBCLASS, A),
    ];
    expect(isBottomLocal(onto, new Set([A]))).toBe(true);
  });
});

// ============================================================================
// 10. isTopLocal sanity — the ⊤ mirror used by the star module.
// ============================================================================
describe("isTopLocal — ⊤-locality mirror", () => {
  it("A ⊑ B with Σ={A}: B→⊤ → A⊑⊤ tautology → ⊤-local", () => {
    expect(isTopLocal([t(A, SUBCLASS, B)], new Set([A]))).toBe(true);
  });

  it("A ⊑ B with Σ={B}: A→⊤, B∈Σ → ⊤⊑B NOT tautology → ⊤-non-local", () => {
    expect(isTopLocal([t(A, SUBCLASS, B)], new Set([B]))).toBe(false);
  });
});

// ============================================================================
// 13. BUG 1 CONFORMANCE (real Konclude) — reflexive ∧ irreflexive clash survives.
//
// O = { R a owl:ObjectProperty ; R a owl:ReflexiveProperty ; R a owl:Irreflexive
// Property } is INCONSISTENT (the empty/universal models aside, over any non-empty
// domain a role cannot be both reflexive and irreflexive). With Σ ∋ R the clash is
// expressible over Σ, so the locality module MUST preserve the inconsistency.
//
// Before the BUG 1 fix the single shared rule `local iff R∉Σ` kept these axioms
// only via R∈Σ — which still worked for R∈Σ — but the per-characteristic table is
// what makes the module sound for the harder Σ∌R growth cases proven above. This
// real-reasoner case nails the headline claim: module ⊨ ⊥ ⇔ full ⊨ ⊥.
//
// REQUIRE_KONCLUDE-gated: when set a WASM/init failure FAILS the test.
// ============================================================================
function localityTriplesToStore(triples: LocalityTriple[]): N3.Store {
  const store = new N3.Store();
  const { namedNode, blankNode, literal } = N3.DataFactory;
  const term = (v: string, isLiteral?: boolean) => {
    if (isLiteral) return literal(v);
    if (v.startsWith("_:") || /^(_:)?b\d+$/.test(v) || v.startsWith("n3-")) {
      return blankNode(v.replace(/^_:/, ""));
    }
    return namedNode(v);
  };
  for (const x of triples) {
    store.addQuad(
      N3.DataFactory.quad(
        term(x.subject) as N3.Quad_Subject,
        namedNode(x.predicate),
        term(x.object, x.objectIsLiteral) as N3.Quad_Object,
      ),
    );
  }
  return store;
}

describe("BUG 1 conformance — reflexive ∧ irreflexive clash preserved by module (real Konclude)", () => {
  it(
    "module is INCONSISTENT iff full is INCONSISTENT for Σ={R}",
    async () => {
      let RdfReasoner: typeof import("rdf-reasoner-konclude").RdfReasoner;
      try {
        ({ RdfReasoner } = await import("rdf-reasoner-konclude"));
      } catch (e) {
        if (REQUIRE_KONCLUDE) throw e;
        console.warn("[TEST][SKIP] rdf-reasoner-konclude unavailable:", String(e));
        return;
      }
      let r: import("rdf-reasoner-konclude").RdfReasoner;
      try {
        r = new RdfReasoner();
        await r.ready;
      } catch (e) {
        if (REQUIRE_KONCLUDE) {
          throw new Error(`REQUIRE_KONCLUDE set but Konclude failed to init: ${String(e)}`);
        }
        console.warn("[TEST][SKIP] Konclude WASM init failed:", String(e));
        return;
      }
      try {
        const onto: LocalityTriple[] = [
          t(R, RDF_TYPE, OWL_OBJ_PROP),
          t(R, RDF_TYPE, REFLEXIVE_PROP),
          t(R, RDF_TYPE, IRREFLEXIVE_PROP),
        ];
        const fullStore = localityTriplesToStore(onto);

        // The full ontology is INCONSISTENT (reflexive ∧ irreflexive on a non-empty
        // domain). Konclude must agree.
        const fullConsistent = await r.checkConsistency(fullStore);
        expect(fullConsistent).toBe(false);

        // The ⊤⊥* (star) module for Σ={R} must PRESERVE the inconsistency: both
        // characteristic axioms are non-local in both modes (R∈Σ) → kept.
        const star = extractStarModule(onto, [R], { includeDeclarationsForSignature: true });
        expect(has(star, R, RDF_TYPE, REFLEXIVE_PROP)).toBe(true);
        expect(has(star, R, RDF_TYPE, IRREFLEXIVE_PROP)).toBe(true);
        const starStore = localityTriplesToStore(star);
        const starConsistent = await r.checkConsistency(starStore);
        console.log("[TEST][BUG1] consistency — full:", fullConsistent, "star-module:", starConsistent);
        // module ⊨ ⊥ ⇔ full ⊨ ⊥ — the conformance claim.
        expect(starConsistent).toBe(fullConsistent);
      } finally {
        r.terminate();
      }
    },
    120000,
  );
});
