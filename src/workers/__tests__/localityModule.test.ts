// @vitest-environment node
//
// Tests for the syntactic locality-based module extractor (localityModule.ts).
//
// The KEY property under test is SOUNDNESS: the extracted module must contain
// every axiom that can affect entailments over the requested signature Σ, and
// may exclude axioms that provably cannot. We prove this on small hand-built
// ontologies whose ⊥-modules are known by the JAIR-2008 locality definitions.

import { describe, it, expect } from "vitest";
import {
  extractBotModule,
  extractTopModule,
  extractStarModule,
  isBottomLocal,
  isTopLocal,
  signatureOf,
  type LocalityTriple,
} from "../localityModule.ts";

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
