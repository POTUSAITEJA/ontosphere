// @vitest-environment node
//
// Tests for laconic justifications (laconicJustification.ts).
//
// A LACONIC justification (Horridge, Parsia, Sattler, "Laconic and Precise
// Justifications in OWL", ISWC 2008) is a justification in which every axiom is
// as WEAK as possible and contains no superfluous parts. These tests use a MOCK
// entailment ORACLE (no real reasoner) to exercise:
//   • splitAxiom — the structural weakening / OPlus rules.
//   • computeLaconic — splitting a justification + re-minimising over the finer
//     parts, dropping superfluous conjuncts, and mapping parts back to sources.
//   • minimality, soundness (unsplittable axioms preserved), and determinism.

import { describe, it, expect } from "vitest";
import {
  splitAxiom,
  computeLaconic,
  axiomKey,
  type LaconicAxiom,
  type LaconicTriple,
} from "../laconicJustification.ts";

// ───────────────────────────── Vocabulary shortcuts ─────────────────────────
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const OWL = "http://www.w3.org/2002/07/owl#";

const RDF_TYPE = `${RDF}type`;
const RDF_FIRST = `${RDF}first`;
const RDF_REST = `${RDF}rest`;
const RDF_NIL = `${RDF}nil`;

const SUBCLASS = `${RDFS}subClassOf`;
const EQUIV_CLASS = `${OWL}equivalentClass`;
const RESTRICTION = `${OWL}Restriction`;
const ON_PROPERTY = `${OWL}onProperty`;
const SOME_VALUES = `${OWL}someValuesFrom`;
const INTERSECTION = `${OWL}intersectionOf`;

// Test namespace.
const EX = "http://example.org/";
const A = `${EX}A`;
const B = `${EX}B`;
const C = `${EX}C`;
const Bot = `${EX}BotCause`; // a class that, with B, forces inconsistency
const R = `${EX}R`;

// ───────────────────────────── Triple / axiom helpers ───────────────────────
function t(subject: string, predicate: string, object: string, objectIsLiteral = false): LaconicTriple {
  return { subject, predicate, object, objectIsLiteral };
}

/** A simple one-triple subClassOf axiom: `subject ⊑ object`. */
function sub(subject: string, object: string): LaconicAxiom {
  return [t(subject, SUBCLASS, object)];
}

/**
 * Build an `A ⊑ (m₁ ⊓ … ⊓ mₙ)` axiom: a subClassOf whose RHS is an anonymous
 * intersection class expressed via owl:intersectionOf + an rdf:List of `members`.
 */
function subIntersection(subject: string, members: string[], blankBase = "x"): LaconicAxiom {
  const inter = `_:${blankBase}-inter`;
  const triples: LaconicTriple[] = [
    t(subject, SUBCLASS, inter),
    t(inter, INTERSECTION, `_:${blankBase}-l0`),
  ];
  members.forEach((m, i) => {
    const cell = `_:${blankBase}-l${i}`;
    const next = i + 1 < members.length ? `_:${blankBase}-l${i + 1}` : RDF_NIL;
    triples.push(t(cell, RDF_FIRST, m));
    triples.push(t(cell, RDF_REST, next));
  });
  return triples;
}

/**
 * Build an `A ⊑ ∃R.(m₁ ⊓ … ⊓ mₙ)` axiom: a subClassOf whose RHS is a
 * someValuesFrom restriction on R whose filler is an intersection of `members`.
 */
function subSomeIntersection(subject: string, prop: string, members: string[], blankBase = "y"): LaconicAxiom {
  const restr = `_:${blankBase}-r`;
  const filler = `_:${blankBase}-f`;
  const triples: LaconicTriple[] = [
    t(subject, SUBCLASS, restr),
    t(restr, RDF_TYPE, RESTRICTION),
    t(restr, ON_PROPERTY, prop),
    t(restr, SOME_VALUES, filler),
    t(filler, INTERSECTION, `_:${blankBase}-l0`),
  ];
  members.forEach((m, i) => {
    const cell = `_:${blankBase}-l${i}`;
    const next = i + 1 < members.length ? `_:${blankBase}-l${i + 1}` : RDF_NIL;
    triples.push(t(cell, RDF_FIRST, m));
    triples.push(t(cell, RDF_REST, next));
  });
  return triples;
}

/** True iff the axiom set contains an `A ⊑ target` subClassOf part. */
function hasSub(axioms: LaconicAxiom[], subject: string, object: string): boolean {
  return axioms.some((ax) =>
    ax.some((tr) => tr.subject === subject && tr.predicate === SUBCLASS && tr.object === object),
  );
}

/** True iff the axiom set contains a part that is `subject ⊑ ∃prop.filler`. */
function hasSomeValues(axioms: LaconicAxiom[], subject: string, prop: string, filler: string): boolean {
  return axioms.some((ax) => {
    const principal = ax.find((tr) => tr.predicate === SUBCLASS && tr.subject === subject);
    if (!principal) return false;
    const restr = principal.object;
    const onProp = ax.find((tr) => tr.subject === restr && tr.predicate === ON_PROPERTY);
    const some = ax.find((tr) => tr.subject === restr && tr.predicate === SOME_VALUES);
    return !!onProp && onProp.object === prop && !!some && some.object === filler;
  });
}

// ============================================================================
// 1. splitAxiom — structural weakening (OPlus) rules.
// ============================================================================
describe("splitAxiom — intersection RHS", () => {
  it("A ⊑ B ⊓ C  →  { A ⊑ B , A ⊑ C }", () => {
    const axiom = subIntersection(A, [B, C]);
    const parts = splitAxiom(axiom);
    expect(parts).toHaveLength(2);
    expect(hasSub(parts, A, B)).toBe(true);
    expect(hasSub(parts, A, C)).toBe(true);
    // Each part is a clean one-triple subClassOf (no leftover intersection).
    for (const part of parts) {
      expect(part).toHaveLength(1);
      expect(part[0].predicate).toBe(SUBCLASS);
    }
  });

  it("A ⊑ B ⊓ C ⊓ D  →  three parts, one per conjunct, in list order", () => {
    const D = `${EX}D`;
    const parts = splitAxiom(subIntersection(A, [B, C, D]));
    expect(parts).toHaveLength(3);
    expect(parts.map((p) => p[0].object)).toEqual([B, C, D]);
  });
});

describe("splitAxiom — someValuesFrom with intersection filler", () => {
  it("A ⊑ ∃R.(B ⊓ C)  →  { A ⊑ ∃R.B , A ⊑ ∃R.C }", () => {
    const axiom = subSomeIntersection(A, R, [B, C]);
    const parts = splitAxiom(axiom);
    expect(parts).toHaveLength(2);
    expect(hasSomeValues(parts, A, R, B)).toBe(true);
    expect(hasSomeValues(parts, A, R, C)).toBe(true);
    // No part still carries the intersection filler.
    for (const part of parts) {
      expect(part.some((tr) => tr.predicate === INTERSECTION)).toBe(false);
    }
  });
});

describe("splitAxiom — unsplittable axioms are preserved (soundness)", () => {
  it("a simple A ⊑ B is returned unchanged as a singleton", () => {
    const axiom = sub(A, B);
    const parts = splitAxiom(axiom);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe(axiom); // referential identity preserved
  });

  it("an intersection LHS (B ⊓ C ⊑ A) is kept whole (would be unsound to split)", () => {
    // B ⊓ C ⊑ A : the anonymous intersection is the SUBJECT, not the RHS.
    const inter = "_:lhs-inter";
    const axiom: LaconicAxiom = [
      t(inter, SUBCLASS, A),
      t(inter, INTERSECTION, "_:lhs-l0"),
      t("_:lhs-l0", RDF_FIRST, B),
      t("_:lhs-l0", RDF_REST, "_:lhs-l1"),
      t("_:lhs-l1", RDF_FIRST, C),
      t("_:lhs-l1", RDF_REST, RDF_NIL),
    ];
    const parts = splitAxiom(axiom);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe(axiom);
  });

  it("a property / non-class axiom is kept whole", () => {
    const axiom: LaconicAxiom = [t(R, RDF_TYPE, `${OWL}TransitiveProperty`)];
    const parts = splitAxiom(axiom);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe(axiom);
  });
});

describe("splitAxiom — equivalentClass resolves into weaker subsumptions", () => {
  it("A ≡ B ⊓ C  →  { A ⊑ B , A ⊑ C , (B ⊓ C) ⊑ A }", () => {
    // EquivalentClasses(A, B ⊓ C): A ≡ inter. Forward A ⊑ inter splits to A⊑B,A⊑C;
    // backward inter ⊑ A stays whole (intersection LHS).
    const inter = "_:eq-inter";
    const axiom: LaconicAxiom = [
      t(A, EQUIV_CLASS, inter),
      t(inter, INTERSECTION, "_:eq-l0"),
      t("_:eq-l0", RDF_FIRST, B),
      t("_:eq-l0", RDF_REST, "_:eq-l1"),
      t("_:eq-l1", RDF_FIRST, C),
      t("_:eq-l1", RDF_REST, RDF_NIL),
    ];
    const parts = splitAxiom(axiom);
    // A⊑B, A⊑C, and the backward inter⊑A.
    expect(hasSub(parts, A, B)).toBe(true);
    expect(hasSub(parts, A, C)).toBe(true);
    expect(hasSub(parts, inter, A)).toBe(true);
    expect(parts).toHaveLength(3);
  });
});

// ============================================================================
// 2. computeLaconic — drop the superfluous conjunct, map parts to sources.
// ============================================================================
describe("computeLaconic — drops a superfluous conjunct", () => {
  // Regular justification: { A ⊑ B ⊓ C , B ⊑ BotCause }.
  // The mock oracle is INCONSISTENT iff BOTH `A ⊑ B` (the B conjunct/part) AND
  // `B ⊑ BotCause` are present. The `A ⊑ C` part is irrelevant.
  const interAxiom = subIntersection(A, [B, C]);
  const botAxiom = sub(B, Bot);
  const justification = [interAxiom, botAxiom];

  // Oracle: true iff the set entails η = inconsistency.
  const entails = (set: LaconicAxiom[]): boolean => {
    const hasAsubB = hasSub(set, A, B);
    const hasBsubBot = hasSub(set, B, Bot);
    return hasAsubB && hasBsubBot;
  };

  it("laconic = { A ⊑ B , B ⊑ BotCause }; the A ⊑ C part is dropped", () => {
    const { laconic } = computeLaconic(justification, entails);
    expect(hasSub(laconic, A, B)).toBe(true);
    expect(hasSub(laconic, B, Bot)).toBe(true);
    // The superfluous conjunct A ⊑ C is NOT in the laconic justification.
    expect(hasSub(laconic, A, C)).toBe(false);
    expect(laconic).toHaveLength(2);
  });

  it("sources maps the `A ⊑ B` part back to the original A ⊑ B ⊓ C axiom", () => {
    const { laconic, sources } = computeLaconic(justification, entails);
    const aSubB = laconic.find((ax) => hasSub([ax], A, B));
    expect(aSubB).toBeDefined();
    expect(sources.get(aSubB as LaconicAxiom)).toBe(interAxiom);

    const bSubBot = laconic.find((ax) => hasSub([ax], B, Bot));
    expect(bSubBot).toBeDefined();
    expect(sources.get(bSubBot as LaconicAxiom)).toBe(botAxiom);
  });
});

describe("computeLaconic — minimality (every part is necessary)", () => {
  const justification = [subIntersection(A, [B, C]), sub(B, Bot)];
  const entails = (set: LaconicAxiom[]): boolean => hasSub(set, A, B) && hasSub(set, B, Bot);

  it("removing any single laconic part makes the oracle FALSE", () => {
    const { laconic } = computeLaconic(justification, entails);
    expect(entails(laconic)).toBe(true);
    for (const part of laconic) {
      const without = laconic.filter((p) => p !== part);
      expect(entails(without)).toBe(false);
    }
  });
});

describe("computeLaconic — unsplittable justification preserved (soundness)", () => {
  // Both axioms are simple, unsplittable subsumptions; the laconic result must be
  // exactly the original justification.
  const j = [sub(A, B), sub(B, Bot)];
  const entails = (set: LaconicAxiom[]): boolean => hasSub(set, A, B) && hasSub(set, B, Bot);

  it("returns the original two axioms unchanged, both necessary", () => {
    const { laconic } = computeLaconic(j, entails);
    expect(laconic).toHaveLength(2);
    expect(hasSub(laconic, A, B)).toBe(true);
    expect(hasSub(laconic, B, Bot)).toBe(true);
    for (const part of laconic) {
      expect(entails(laconic.filter((p) => p !== part))).toBe(false);
    }
  });

  it("falls back to the original justification if the oracle rejects the split set", () => {
    // An oracle that is never satisfied by the split candidates (it demands the
    // WHOLE intersection axiom object, which the split removed). computeLaconic
    // must fall back to the original justification rather than return nothing.
    const interAxiom = subIntersection(A, [B, C]);
    const never = (): boolean => false;
    const { laconic, sources } = computeLaconic([interAxiom], never);
    expect(laconic).toHaveLength(1);
    expect(laconic[0]).toBe(interAxiom);
    expect(sources.get(interAxiom)).toBe(interAxiom);
  });
});

describe("computeLaconic — determinism", () => {
  const justification = [subIntersection(A, [B, C]), sub(B, Bot)];
  const entails = (set: LaconicAxiom[]): boolean => hasSub(set, A, B) && hasSub(set, B, Bot);

  it("identical input yields identical laconic keys across runs", () => {
    const r1 = computeLaconic(justification, entails);
    const r2 = computeLaconic(justification, entails);
    const keys1 = r1.laconic.map(axiomKey).sort();
    const keys2 = r2.laconic.map(axiomKey).sort();
    expect(keys1).toEqual(keys2);
  });
});
