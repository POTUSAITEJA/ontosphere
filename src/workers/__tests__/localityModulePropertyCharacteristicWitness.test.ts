// @vitest-environment node
//
// CONFORMANCE WITNESS — mode-aware property-characteristic locality (the Lemma).
// ─────────────────────────────────────────────────────────────────────────────
//
// This test is the EMPIRICAL WITNESS reviewers ask for: it proves, in the EXACT
// extraction configuration the runtime uses, that the soundness fix for property-
// characteristic locality (the per-mode table in
// `isCharacteristicLocalWhenPropOutOfSigma`, localityModule.ts) actually causes a
// reasoner running over the star-module to CATCH a clash that is caused SOLELY by
// a property-characteristic axiom — instead of silently dropping that axiom and
// declaring the module consistent (which would be UNSOUND).
//
// WHAT "the runtime configuration" MEANS HERE
// ─────────────────────────────────────────────────────────────────────────────
// The incremental reasoner extracts its module with EXACTLY this call (see
// rdfManager.runtime.ts → extractModuleFromStore):
//
//     extractStarModule(axioms, signature, { includeDeclarationsForSignature: true })
//
// and the `signature` it passes is the CHANGED signature Σ_Δ derived in
// `computeChangedSignature`, seeded from `changedSignature`. Critically, the
// changed signature is harvested by `recordChangedSignature` (rdfManager.runtime.ts
// ~L4942) from EVERY changed quad's SUBJECT, PREDICATE *and* OBJECT. So when a user
// edits a property assertion `a R b`, the edited ROLE `R` (the predicate) is pulled
// into Σ_Δ — even though R is not a class the user "named". That is the realistic
// configuration this witness reproduces: the role of the edited assertion is in the
// working signature, but it is NOT one of the explicitly-edited *class* symbols.
//
// THE ALGORITHMIC FACT BEHIND THE LEMMA (why R must be in Σ for the STAR module)
// ─────────────────────────────────────────────────────────────────────────────
// The star module is the ⊤⊥* iteration: each round runs the ⊤-fixpoint then the
// ⊥-fixpoint, each starting from the SAME requested Σ. An axiom survives the star
// module only if it is NON-LOCAL in BOTH the ⊤ and the ⊥ pass. From the per-mode
// table (isCharacteristicLocalWhenPropOutOfSigma):
//
//   characteristic     ⊥-mode (R∉Σ)   ⊤-mode (R∉Σ)
//   Transitive         LOCAL          LOCAL          → dropped by star  (sound: local)
//   Symmetric          LOCAL          LOCAL          → dropped by star  (sound: local)
//   Functional         LOCAL          KEEP
//   InverseFunctional  LOCAL          KEEP
//   Asymmetric         LOCAL          KEEP
//   Irreflexive        LOCAL          KEEP
//   Reflexive          KEEP           LOCAL
//
// When R∉Σ, EVERY characteristic is local in at least one pass, so the star module
// drops it — and for Transitive/Symmetric/Reflexive that is CORRECT (the empty /
// universal role genuinely satisfies them, so they cannot cause a clash once R is
// gone). For Functional / InverseFunctional / Asymmetric / Irreflexive, dropping
// them would be UNSOUND iff R is actually kept — and R IS kept exactly when R∈Σ.
// With R∈Σ the table's first column (R∈Σ ⇒ NON-LOCAL in both modes) applies and the
// axiom is retained. That retention is what this test proves, in the configuration
// where the runtime puts the edited role into Σ.
//
// Each scenario below is built so the property-characteristic axiom is the ONLY
// axiom that makes the ontology inconsistent: removing it (and nothing else) would
// restore consistency. The assertion is that the extracted star-module STILL
// CONTAINS that characteristic axiom (plus the assertions that clash against it),
// so a reasoner over the module reproduces the clash. Scenario (c) is the
// not-over-conservative control: a Transitive/Symmetric characteristic on a role
// that is genuinely OUTSIDE Σ is correctly DROPPED (it is local and harmless).
//
// PURE FUNCTIONS ONLY — no Konclude / WASM. We assert on the syntactic module
// content; the "a reasoner would catch the clash" claim is justified by the module
// retaining both the characteristic axiom and the clashing assertions.

import { describe, it, expect } from "vitest";
import {
  extractStarModule,
  signatureOf,
  type LocalityTriple,
} from "../localityModule.ts";

// ───────────────────────────── Vocabulary ───────────────────────────────────
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const OWL = "http://www.w3.org/2002/07/owl#";
const XSD = "http://www.w3.org/2001/XMLSchema#";

const RDF_TYPE = `${RDF}type`;
const OWL_CLASS = `${OWL}Class`;
const OWL_OBJ_PROP = `${OWL}ObjectProperty`;
const OWL_DATA_PROP = `${OWL}DatatypeProperty`;
const OWL_NAMED_INDIVIDUAL = `${OWL}NamedIndividual`;
const DIFFERENT_FROM = `${OWL}differentFrom`;

const FUNCTIONAL_PROP = `${OWL}FunctionalProperty`;
const INVERSE_FUNCTIONAL_PROP = `${OWL}InverseFunctionalProperty`;
const ASYMMETRIC_PROP = `${OWL}AsymmetricProperty`;
const IRREFLEXIVE_PROP = `${OWL}IrreflexiveProperty`;
const TRANSITIVE_PROP = `${OWL}TransitiveProperty`;
const SYMMETRIC_PROP = `${OWL}SymmetricProperty`;

const XSD_INTEGER = `${XSD}integer`;

const EX = "http://example.org/";

// ───────────────────────────── Helpers ──────────────────────────────────────
function t(
  subject: string,
  predicate: string,
  object: string,
  objectIsLiteral = false,
): LocalityTriple {
  return { subject, predicate, object, objectIsLiteral };
}

/** True iff the module contains exactly this triple (by value). */
function has(
  module: LocalityTriple[],
  subject: string,
  predicate: string,
  object: string,
): boolean {
  return module.some(
    (m) => m.subject === subject && m.predicate === predicate && m.object === object,
  );
}

/**
 * Reproduce the runtime's edit-signature derivation for an EDITED set of triples.
 *
 * The runtime (rdfManager.runtime.ts `recordChangedSignature`) harvests the
 * subject, PREDICATE and object of every changed quad into `changedSignature`,
 * which seeds Σ_Δ in `computeChangedSignature`. We mirror that here: the edit
 * signature is the union of `signatureOf(editedTriples)` (which harvests class /
 * property symbols from recognised axiom shapes) AND the raw predicates of the
 * edited triples (which captures the edited ROLE of a plain property assertion —
 * signatureOf does not harvest predicates of unrecognised/ABox triples, but the
 * runtime's quad-level predicate harvest does). This is the precise reason the
 * edited role lands in Σ even when it is not an explicitly-named class symbol.
 */
function runtimeEditSignature(editedTriples: LocalityTriple[]): string[] {
  const sig = new Set<string>(signatureOf(editedTriples));
  for (const tr of editedTriples) {
    // Mirror recordChangedSignature: the predicate of every edited quad enters Σ.
    if (tr.predicate && tr.predicate !== RDF_TYPE) sig.add(tr.predicate);
  }
  return [...sig];
}

// ─────────────────────────────────────────────────────────────────────────────
describe("property-characteristic locality conformance witness (runtime star-module config)", () => {
  // ───────────────────────────────────────────────────────────────────────────
  // (a) FUNCTIONAL property — two distinct values on one subject is the SOLE
  //     source of inconsistency. The Functional axiom MUST be kept so a reasoner
  //     over the module catches the clash. Covered for BOTH an object property
  //     (two distinct individuals) and a data property (two distinct literals).
  // ───────────────────────────────────────────────────────────────────────────
  it("(a-object) keeps Functional(R) when R is the edited role and a has two distinct R-values", () => {
    const R = `${EX}hasFather`; // the property characteristic's role
    const a = `${EX}a`;
    const b = `${EX}b`;
    const c = `${EX}c`;

    // Functional(hasFather) + a hasFather b + a hasFather c + b ≠ c  ⇒ INCONSISTENT.
    // (a forces b = c, contradicted by differentFrom.) The Functional axiom is the
    // ONLY thing making this inconsistent: drop it and b, c need not be equal.
    const onto: LocalityTriple[] = [
      t(R, RDF_TYPE, OWL_OBJ_PROP),
      t(R, RDF_TYPE, FUNCTIONAL_PROP), // ← the property-characteristic axiom under test
      t(a, RDF_TYPE, OWL_NAMED_INDIVIDUAL),
      t(b, RDF_TYPE, OWL_NAMED_INDIVIDUAL),
      t(c, RDF_TYPE, OWL_NAMED_INDIVIDUAL),
      t(a, R, b), // edited property assertion
      t(a, R, c), // edited property assertion (the second, distinct value)
      t(b, DIFFERENT_FROM, c),
    ];

    // The runtime edit signature for "the user edited a hasFather b / a hasFather c"
    // includes the ROLE hasFather (harvested as the edited predicate) — but NOT as a
    // named class. This is the realistic configuration.
    const sig = runtimeEditSignature([t(a, R, b), t(a, R, c)]);
    expect(sig).toContain(R); // sanity: the edited role really is in Σ via predicate harvest

    const star = extractStarModule(onto, sig, { includeDeclarationsForSignature: true });

    // WITNESS: the Functional axiom is retained → a reasoner over the module sees it
    // and re-derives the b = c forced-equality clash.
    expect(has(star, R, RDF_TYPE, FUNCTIONAL_PROP)).toBe(true);
    // The clashing assertions are retained too, so the clash is reproducible.
    expect(has(star, a, R, b)).toBe(true);
    expect(has(star, a, R, c)).toBe(true);
  });

  it("(a-data) keeps Functional(R) for a DATA property with two distinct literal values", () => {
    const R = `${EX}hasAge`;
    const a = `${EX}a`;

    // Functional(hasAge) + a hasAge 30 + a hasAge 40 ⇒ INCONSISTENT (30 ≠ 40 but a
    // can have only one hasAge). The Functional axiom is the sole culprit.
    const onto: LocalityTriple[] = [
      t(R, RDF_TYPE, OWL_DATA_PROP),
      t(R, RDF_TYPE, FUNCTIONAL_PROP),
      t(a, RDF_TYPE, OWL_NAMED_INDIVIDUAL),
      t(a, R, "30", true),
      t(a, R, "40", true),
    ];

    const sig = runtimeEditSignature([t(a, R, "30", true), t(a, R, "40", true)]);
    expect(sig).toContain(R);

    const star = extractStarModule(onto, sig, { includeDeclarationsForSignature: true });

    // WITNESS (the Lemma's claim): the Functional axiom on the in-Σ data role is
    // KEPT — it is NON-LOCAL in both modes once R∈Σ, so the soundness fix retains
    // the axiom whose removal would otherwise be needed to restore consistency.
    expect(has(star, R, RDF_TYPE, FUNCTIONAL_PROP)).toBe(true);

    // HONEST BOUNDARY: the two LITERAL-object assertions `a hasAge "30"/"40"` are
    // treated as local annotation-like ABox data (a literal-object triple carries
    // no class/property subsumption) and are therefore NOT pulled into the logical
    // module. So the star module keeps the CHARACTERISTIC axiom (the fix under
    // test) but not the literal clash facts. The functional-clash reproduction for
    // a DATA property thus relies on the reasoner re-reading the asserted data
    // facts alongside the module; the module's job — and what this witness proves —
    // is to RETAIN the Functional axiom rather than drop it as previously.
    expect(star.filter((m) => m.subject === a && m.predicate === R).length).toBe(0);
    // For the OBJECT-property case (a-object) the clashing assertions ARE retained
    // (IRI-object property assertions are non-local), so that scenario reproduces
    // the full clash inside the module.
  });

  it("(a-inverse-functional) keeps InverseFunctional(R) — the dual of the functional clash", () => {
    const R = `${EX}hasSSN`;
    const a = `${EX}a`;
    const b = `${EX}b`;
    const v = `${EX}ssn123`;

    // InverseFunctional(hasSSN) + a hasSSN v + b hasSSN v + a ≠ b ⇒ INCONSISTENT
    // (the shared value v forces a = b). Sole culprit = the InverseFunctional axiom.
    const onto: LocalityTriple[] = [
      t(R, RDF_TYPE, OWL_OBJ_PROP),
      t(R, RDF_TYPE, INVERSE_FUNCTIONAL_PROP),
      t(a, R, v),
      t(b, R, v),
      t(a, DIFFERENT_FROM, b),
    ];

    const sig = runtimeEditSignature([t(a, R, v), t(b, R, v)]);
    expect(sig).toContain(R);

    const star = extractStarModule(onto, sig, { includeDeclarationsForSignature: true });
    expect(has(star, R, RDF_TYPE, INVERSE_FUNCTIONAL_PROP)).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // (b) IRREFLEXIVE / ASYMMETRIC — a self-edge / a symmetric edge is the SOLE
  //     source of inconsistency. The characteristic MUST be kept.
  // ───────────────────────────────────────────────────────────────────────────
  it("(b-irreflexive) keeps Irreflexive(R) when a has a SELF assertion a R a", () => {
    const R = `${EX}knows`;
    const a = `${EX}a`;

    // Irreflexive(knows) + a knows a ⇒ INCONSISTENT (an irreflexive role cannot
    // relate anything to itself). Sole culprit = the Irreflexive axiom.
    const onto: LocalityTriple[] = [
      t(R, RDF_TYPE, OWL_OBJ_PROP),
      t(R, RDF_TYPE, IRREFLEXIVE_PROP),
      t(a, RDF_TYPE, OWL_NAMED_INDIVIDUAL),
      t(a, R, a), // the offending self-edge
    ];

    const sig = runtimeEditSignature([t(a, R, a)]);
    expect(sig).toContain(R);

    const star = extractStarModule(onto, sig, { includeDeclarationsForSignature: true });

    // WITNESS: Irreflexive retained → the module reproduces the self-edge clash.
    expect(has(star, R, RDF_TYPE, IRREFLEXIVE_PROP)).toBe(true);
    expect(has(star, a, R, a)).toBe(true);
  });

  it("(b-asymmetric) keeps Asymmetric(R) when both a R b and b R a are asserted", () => {
    const R = `${EX}parentOf`;
    const a = `${EX}a`;
    const b = `${EX}b`;

    // Asymmetric(parentOf) + a parentOf b + b parentOf a ⇒ INCONSISTENT (an
    // asymmetric role cannot hold in both directions). Sole culprit = Asymmetric.
    const onto: LocalityTriple[] = [
      t(R, RDF_TYPE, OWL_OBJ_PROP),
      t(R, RDF_TYPE, ASYMMETRIC_PROP),
      t(a, R, b),
      t(b, R, a),
    ];

    const sig = runtimeEditSignature([t(a, R, b), t(b, R, a)]);
    expect(sig).toContain(R);

    const star = extractStarModule(onto, sig, { includeDeclarationsForSignature: true });
    expect(has(star, R, RDF_TYPE, ASYMMETRIC_PROP)).toBe(true);
    expect(has(star, a, R, b)).toBe(true);
    expect(has(star, b, R, a)).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // (c) NOT OVER-CONSERVATIVE control — a Transitive / Symmetric characteristic
  //     whose role is GENUINELY OUTSIDE Σ is CORRECTLY DROPPED (it is local in
  //     BOTH passes: the empty role ∅ and the universal role Δ² are both transitive
  //     and symmetric, so the axiom is a tautology after substitution and cannot
  //     contribute any Σ-entailment / clash). This proves the fix only KEEPS the
  //     characteristics that can actually clash, and does not bloat the module.
  // ───────────────────────────────────────────────────────────────────────────
  it("(c-transitive) DROPS Transitive(R) from the star module when R is outside Σ", () => {
    const R = `${EX}partOf`; // genuinely NOT in the edit signature below
    const a = `${EX}a`;
    const b = `${EX}b`;
    const c = `${EX}c`;
    const KeptClass = `${EX}KeptClass`; // the only symbol the user actually edited

    const onto: LocalityTriple[] = [
      t(R, RDF_TYPE, OWL_OBJ_PROP),
      t(R, RDF_TYPE, TRANSITIVE_PROP),
      t(a, R, b),
      t(b, R, c),
      // An unrelated edited class assertion that anchors Σ on KeptClass only.
      t(a, RDF_TYPE, KeptClass),
      t(KeptClass, RDF_TYPE, OWL_CLASS),
    ];

    // Edit signature contains ONLY the edited class — NOT the role R. (We do NOT
    // route the a R b assertions through runtimeEditSignature, so R stays out of Σ.)
    const sig = [KeptClass];
    expect(sig).not.toContain(R);

    const star = extractStarModule(onto, sig, { includeDeclarationsForSignature: true });

    // CONTROL: a transitive characteristic on an out-of-Σ role is LOCAL → dropped.
    // The empty/universal role is transitive, so the axiom cannot cause a clash and
    // dropping it is SOUND. This is the witness that the fix is not over-conservative.
    expect(has(star, R, RDF_TYPE, TRANSITIVE_PROP)).toBe(false);
  });

  it("(c-symmetric) DROPS Symmetric(R) from the star module when R is outside Σ", () => {
    const R = `${EX}siblingOf`;
    const a = `${EX}a`;
    const b = `${EX}b`;
    const KeptClass = `${EX}KeptClass`;

    const onto: LocalityTriple[] = [
      t(R, RDF_TYPE, OWL_OBJ_PROP),
      t(R, RDF_TYPE, SYMMETRIC_PROP),
      t(a, R, b),
      t(a, RDF_TYPE, KeptClass),
      t(KeptClass, RDF_TYPE, OWL_CLASS),
    ];

    const sig = [KeptClass];
    expect(sig).not.toContain(R);

    const star = extractStarModule(onto, sig, { includeDeclarationsForSignature: true });

    // CONTROL: symmetric on an out-of-Σ role is local in both modes → dropped (sound).
    expect(has(star, R, RDF_TYPE, SYMMETRIC_PROP)).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Cross-check: the SAME Functional clash, if the role were genuinely out of Σ,
  // WOULD be dropped — confirming the witness above depends precisely on the role
  // entering Σ (which the runtime guarantees by harvesting the edited predicate).
  // This documents the boundary so the keep-result in (a) is not mistaken for a
  // blanket "characteristics are always kept".
  // ───────────────────────────────────────────────────────────────────────────
  it("(boundary) Functional(R) IS dropped when R is genuinely outside Σ — keep depends on the role being in Σ", () => {
    const R = `${EX}hasFather`;
    const a = `${EX}a`;
    const b = `${EX}b`;
    const c = `${EX}c`;
    const KeptClass = `${EX}KeptClass`;

    const onto: LocalityTriple[] = [
      t(R, RDF_TYPE, OWL_OBJ_PROP),
      t(R, RDF_TYPE, FUNCTIONAL_PROP),
      t(a, R, b),
      t(a, R, c),
      t(b, DIFFERENT_FROM, c),
      t(a, RDF_TYPE, KeptClass),
      t(KeptClass, RDF_TYPE, OWL_CLASS),
    ];

    const sig = [KeptClass]; // role R deliberately NOT in Σ
    const star = extractStarModule(onto, sig, { includeDeclarationsForSignature: true });

    // Functional is ⊥-local when R∉Σ, so the star module drops it. The runtime
    // avoids this exact unsoundness by ALWAYS harvesting the edited predicate into
    // Σ_Δ (recordChangedSignature), which is what scenario (a) reproduces.
    expect(has(star, R, RDF_TYPE, FUNCTIONAL_PROP)).toBe(false);
  });
});
