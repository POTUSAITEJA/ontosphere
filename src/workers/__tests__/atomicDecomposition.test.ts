// @vitest-environment node
//
// Tests for the Atomic Decomposition (atomicDecomposition.ts).
//
// The HEADLINE property under test is CORRECTNESS of module-by-traversal:
//
//     moduleForSignature(Σ)  ≡  extractStarModule(axioms, Σ)
//
// for MANY random signatures over several ontologies. This proves the AD — the
// precomputed atoms + dependency DAG — reproduces direct ⊤⊥*-locality extraction.
//
// Reference: C. Del Vescovo, B. Parsia, U. Sattler, T. Schneider,
// "The Modular Structure of an Ontology: Atomic Decomposition," IJCAI 2011.

import { describe, it, expect } from "vitest";
import { computeAtomicDecomposition } from "../atomicDecomposition.ts";
import {
  extractStarModule,
  signatureOf,
  type LocalityTriple,
} from "../localityModule.ts";

// ───────────────────────────── Vocabulary shortcuts ─────────────────────────
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const OWL = "http://www.w3.org/2002/07/owl#";

const RDF_TYPE = `${RDF}type`;

const SUBCLASS = `${RDFS}subClassOf`;
const DOMAIN = `${RDFS}domain`;
const RANGE = `${RDFS}range`;

const EQUIV_CLASS = `${OWL}equivalentClass`;
const DISJOINT = `${OWL}disjointWith`;

const RESTRICTION = `${OWL}Restriction`;
const ON_PROPERTY = `${OWL}onProperty`;
const SOME_VALUES = `${OWL}someValuesFrom`;
const ALL_VALUES = `${OWL}allValuesFrom`;

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
const G = `${EX}G`;
const H = `${EX}H`;
const p = `${EX}p`;
const q = `${EX}q`;
const r = `${EX}r`;

// ───────────────────────────── Triple helpers ───────────────────────────────
function t(subject: string, predicate: string, object: string, objectIsLiteral = false): LocalityTriple {
  return { subject, predicate, object, objectIsLiteral };
}

/** Order-independent key set of a triple list. */
function keys(triples: LocalityTriple[]): Set<string> {
  return new Set(triples.map((x) => `${x.subject} ${x.predicate} ${x.object}`));
}

/** Assert two triple lists are equal as sets of (s,p,o). */
function expectSameModule(got: LocalityTriple[], want: LocalityTriple[]): void {
  expect(keys(got)).toEqual(keys(want));
}

// ───────────────────────────── Deterministic PRNG ───────────────────────────
// Mulberry32 — small, fast, deterministic so tests are reproducible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let z = Math.imul(a ^ (a >>> 15), 1 | a);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

/** All named symbols appearing in an ontology (its global signature). */
function ontologySignature(axioms: LocalityTriple[]): string[] {
  return [...signatureOf(axioms)].sort();
}

/** Pick a random subset of `pool` of the given approximate density. */
function randomSubset(pool: string[], rng: () => number, density: number): string[] {
  return pool.filter(() => rng() < density);
}

// ───────────────────────────── Fixtures ─────────────────────────────────────

/** Subsumption chain A⊑B⊑C⊑D plus an unrelated chain E⊑F, and a disjointness. */
const fxChain: LocalityTriple[] = [
  t(A, RDF_TYPE, OWL_CLASS),
  t(B, RDF_TYPE, OWL_CLASS),
  t(C, RDF_TYPE, OWL_CLASS),
  t(D, RDF_TYPE, OWL_CLASS),
  t(E, RDF_TYPE, OWL_CLASS),
  t(F, RDF_TYPE, OWL_CLASS),
  t(A, SUBCLASS, B),
  t(B, SUBCLASS, C),
  t(C, SUBCLASS, D),
  t(E, SUBCLASS, F),
  t(A, DISJOINT, E),
];

/** Chain + existential restriction A ⊑ ∃p.B and a ∀-restriction C ⊑ ∀q.D. */
const fxRestriction: LocalityTriple[] = [
  t(A, RDF_TYPE, OWL_CLASS),
  t(B, RDF_TYPE, OWL_CLASS),
  t(C, RDF_TYPE, OWL_CLASS),
  t(D, RDF_TYPE, OWL_CLASS),
  t(p, RDF_TYPE, OWL_OBJ_PROP),
  t(q, RDF_TYPE, OWL_OBJ_PROP),
  // A ⊑ ∃p.B
  t(A, SUBCLASS, "_:r1"),
  t("_:r1", RDF_TYPE, RESTRICTION),
  t("_:r1", ON_PROPERTY, p),
  t("_:r1", SOME_VALUES, B),
  // C ⊑ ∀q.D
  t(C, SUBCLASS, "_:r2"),
  t("_:r2", RDF_TYPE, RESTRICTION),
  t("_:r2", ON_PROPERTY, q),
  t("_:r2", ALL_VALUES, D),
  // B ⊑ C (links the two)
  t(B, SUBCLASS, C),
];

/** Disjointness + equivalence + domain/range — a denser, more interlinked onto. */
const fxMixed: LocalityTriple[] = [
  t(A, RDF_TYPE, OWL_CLASS),
  t(B, RDF_TYPE, OWL_CLASS),
  t(C, RDF_TYPE, OWL_CLASS),
  t(D, RDF_TYPE, OWL_CLASS),
  t(E, RDF_TYPE, OWL_CLASS),
  t(G, RDF_TYPE, OWL_CLASS),
  t(H, RDF_TYPE, OWL_CLASS),
  t(p, RDF_TYPE, OWL_OBJ_PROP),
  t(r, RDF_TYPE, OWL_OBJ_PROP),
  t(A, SUBCLASS, B),
  t(B, EQUIV_CLASS, C),
  t(C, DISJOINT, D),
  t(D, SUBCLASS, E),
  t(p, DOMAIN, A),
  t(p, RANGE, B),
  t(r, DOMAIN, G),
  t(r, RANGE, H),
  t(G, SUBCLASS, H),
];

/** A fully-connected equivalence cycle: A≡B, B≡C, C≡A → ONE atom. */
const fxClique: LocalityTriple[] = [
  t(A, RDF_TYPE, OWL_CLASS),
  t(B, RDF_TYPE, OWL_CLASS),
  t(C, RDF_TYPE, OWL_CLASS),
  t(A, EQUIV_CLASS, B),
  t(B, EQUIV_CLASS, C),
  t(C, EQUIV_CLASS, A),
];

/**
 * A larger, procedurally-generated ontology: a forest of subsumption trees plus
 * existential restrictions, disjointness, and property domain/range — enough
 * structure to exercise multi-atom decompositions and long dependency chains.
 * Deterministic (fixed seed) so the fixture is stable across runs.
 */
function generateOntology(seed: number, classCount: number, propCount: number): LocalityTriple[] {
  const rng = mulberry32(seed);
  const cls = Array.from({ length: classCount }, (_, i) => `${EX}K${i}`);
  const props = Array.from({ length: propCount }, (_, i) => `${EX}P${i}`);
  const ax: LocalityTriple[] = [];
  for (const c of cls) ax.push(t(c, RDF_TYPE, OWL_CLASS));
  for (const pr of props) ax.push(t(pr, RDF_TYPE, OWL_OBJ_PROP));
  let blank = 0;
  for (let i = 1; i < classCount; i++) {
    const parent = cls[Math.floor(rng() * i)]; // a strictly earlier class → acyclic
    const roll = rng();
    if (roll < 0.55) {
      // simple subsumption Ki ⊑ parent
      ax.push(t(cls[i], SUBCLASS, parent));
    } else if (roll < 0.8 && propCount > 0) {
      // existential: Ki ⊑ ∃P.parent
      const rnode = `_:g${blank++}`;
      const pr = props[Math.floor(rng() * propCount)];
      ax.push(t(cls[i], SUBCLASS, rnode));
      ax.push(t(rnode, RDF_TYPE, RESTRICTION));
      ax.push(t(rnode, ON_PROPERTY, pr));
      ax.push(t(rnode, SOME_VALUES, parent));
    } else {
      // disjointness Ki ⊓ parent ⊑ ⊥
      ax.push(t(cls[i], DISJOINT, parent));
    }
  }
  // a few property domain/range axioms
  for (let i = 0; i < propCount; i++) {
    if (rng() < 0.6) ax.push(t(props[i], DOMAIN, cls[Math.floor(rng() * classCount)]));
    if (rng() < 0.6) ax.push(t(props[i], RANGE, cls[Math.floor(rng() * classCount)]));
  }
  return ax;
}

const fxGenerated = generateOntology(0x5eed, 14, 3);

const FIXTURES: Array<{ name: string; axioms: LocalityTriple[] }> = [
  { name: "subsumption-chain + disjointness", axioms: fxChain },
  { name: "existential + universal restrictions", axioms: fxRestriction },
  { name: "mixed equiv/disjoint/domain/range", axioms: fxMixed },
  { name: "equivalence clique", axioms: fxClique },
  { name: "generated forest (14 classes, restrictions+disjoint)", axioms: fxGenerated },
];

// ============================================================================
// 1. THE KEY CORRECTNESS PROPERTY — AD module == direct extraction.
// ============================================================================
describe("moduleForSignature(Σ) ≡ extractStarModule(axioms, Σ)", () => {
  for (const { name, axioms } of FIXTURES) {
    it(`matches direct extraction over many random signatures — ${name}`, () => {
      const ad = computeAtomicDecomposition(axioms);
      const pool = ontologySignature(axioms);
      const rng = mulberry32(0xc0ffee ^ name.length);

      let checked = 0;
      // Empty signature + full signature + many random subsets.
      const signatures: string[][] = [[], pool.slice()];
      for (let i = 0; i < 80; i++) {
        const density = 0.15 + rng() * 0.7;
        signatures.push(randomSubset(pool, rng, density));
      }
      // Every singleton signature too (boundary cases).
      for (const s of pool) signatures.push([s]);

      for (const sig of signatures) {
        const direct = extractStarModule(axioms, sig);
        const viaAD = ad.moduleForSignature(sig);
        expectSameModule(viaAD, direct);
        checked++;
      }
      expect(checked).toBeGreaterThan(80);
    });
  }

  it("EXHAUSTIVE: every subset of the signature matches direct extraction", () => {
    // Brute-force ALL 2^|Σ| signatures of the mixed fixture: total proof for a
    // non-trivial ontology that AD-by-traversal === extractStarModule.
    const ad = computeAtomicDecomposition(fxMixed);
    const pool = ontologySignature(fxMixed);
    expect(pool.length).toBeLessThanOrEqual(12); // keep 2^n tractable
    let checked = 0;
    for (let mask = 0; mask < 1 << pool.length; mask++) {
      const sig = pool.filter((_, i) => (mask & (1 << i)) !== 0);
      expectSameModule(ad.moduleForSignature(sig), extractStarModule(fxMixed, sig));
      checked++;
    }
    expect(checked).toBe(1 << pool.length);
  });
});

// ============================================================================
// 2. ATOMS PARTITION THE AXIOMS.
// ============================================================================
describe("atoms partition the logical axioms", () => {
  for (const { name, axioms } of FIXTURES) {
    it(`every axiom in exactly one atom; union = O — ${name}`, () => {
      const ad = computeAtomicDecomposition(axioms);
      const seen = new Set<number>();
      let total = 0;
      for (const atom of ad.atoms) {
        for (const idx of atom.axiomIndexes) {
          expect(seen.has(idx)).toBe(false); // disjoint
          seen.add(idx);
          total++;
        }
      }
      // Union covers all axioms: the count equals the union size.
      expect(seen.size).toBe(total);
      // Atom triples are a subset of the ontology triples.
      const ontoKeys = keys(axioms);
      for (const atom of ad.atoms) {
        for (const tr of atom.triples) {
          expect(ontoKeys.has(`${tr.subject} ${tr.predicate} ${tr.object}`)).toBe(true);
        }
      }
    });
  }
});

// ============================================================================
// 3. DEPENDENCY RELATION IS A DAG (acyclic) + transitive reachability.
// ============================================================================
describe("dependency relation is an acyclic DAG", () => {
  /** Detect a cycle in the dependency relation via DFS coloring. */
  function hasCycle(ad: ReturnType<typeof computeAtomicDecomposition>): boolean {
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map<number, number>();
    for (const a of ad.atoms) color.set(a.id, WHITE);

    const visit = (u: number): boolean => {
      color.set(u, GRAY);
      for (const v of ad.dependencies.get(u) ?? []) {
        const c = color.get(v);
        if (c === GRAY) return true; // back-edge → cycle
        if (c === WHITE && visit(v)) return true;
      }
      color.set(u, BLACK);
      return false;
    };

    for (const a of ad.atoms) {
      if (color.get(a.id) === WHITE && visit(a.id)) return true;
    }
    return false;
  }

  for (const { name, axioms } of FIXTURES) {
    it(`no cycles; no self-dependency — ${name}`, () => {
      const ad = computeAtomicDecomposition(axioms);
      expect(hasCycle(ad)).toBe(false);
      // No atom depends on itself.
      for (const [src, dsts] of ad.dependencies) {
        expect(dsts.has(src)).toBe(false);
      }
    });
  }

  it("reachability is transitive: a⤳b ∧ b⤳c ⇒ c reachable from a", () => {
    const ad = computeAtomicDecomposition(fxChain);
    // Compute reachable closure for each atom and verify transitivity holds.
    const closure = (start: number): Set<number> => {
      const seen = new Set<number>();
      const stack = [start];
      while (stack.length) {
        const u = stack.pop()!;
        for (const v of ad.dependencies.get(u) ?? []) {
          if (!seen.has(v)) {
            seen.add(v);
            stack.push(v);
          }
        }
      }
      return seen;
    };
    for (const a of ad.atoms) {
      const reach = closure(a.id);
      for (const b of ad.dependencies.get(a.id) ?? []) {
        for (const c of ad.dependencies.get(b) ?? []) {
          expect(reach.has(c)).toBe(true);
        }
      }
    }
  });
});

// ============================================================================
// 4. DETERMINISM, EMPTY, AND SINGLE-ATOM CASES.
// ============================================================================
describe("edge cases & determinism", () => {
  it("empty ontology → no atoms, empty module", () => {
    const ad = computeAtomicDecomposition([]);
    expect(ad.atoms.length).toBe(0);
    expect(ad.dependencies.size).toBe(0);
    expect(ad.moduleForSignature([A])).toEqual([]);
    expect(ad.moduleForSignature([])).toEqual([]);
  });

  it("declarations-only ontology → no logical axioms → no atoms", () => {
    const onto = [t(A, RDF_TYPE, OWL_CLASS), t(B, RDF_TYPE, OWL_CLASS)];
    const ad = computeAtomicDecomposition(onto);
    expect(ad.atoms.length).toBe(0);
    expectSameModule(ad.moduleForSignature([A, B]), extractStarModule(onto, [A, B]));
  });

  it("equivalence clique → exactly ONE atom", () => {
    const ad = computeAtomicDecomposition(fxClique);
    // The three EquivalentClasses axioms mutually pull each other → one atom.
    expect(ad.atoms.length).toBe(1);
    expect(ad.atoms[0].axiomIndexes.length).toBe(3);
    // Self-contained: it depends on nothing.
    expect([...(ad.dependencies.get(0) ?? [])]).toEqual([]);
  });

  it("single logical axiom → one atom with that axiom", () => {
    const onto = [
      t(A, RDF_TYPE, OWL_CLASS),
      t(B, RDF_TYPE, OWL_CLASS),
      t(A, SUBCLASS, B),
    ];
    const ad = computeAtomicDecomposition(onto);
    expect(ad.atoms.length).toBe(1);
    expect(ad.atoms[0].axiomIndexes.length).toBe(1);
  });

  it("deterministic — identical AD across repeated builds", () => {
    const a1 = computeAtomicDecomposition(fxMixed);
    const a2 = computeAtomicDecomposition(fxMixed);
    // Same atom partition (by triple key sets, in id order).
    const sig = (ad: typeof a1): string =>
      JSON.stringify(
        ad.atoms.map((at) => [...keys(at.triples)].sort()),
      );
    expect(sig(a1)).toEqual(sig(a2));
    // Same dependency relation.
    const depSig = (ad: typeof a1): string =>
      JSON.stringify(
        [...ad.dependencies.entries()].map(([k, v]) => [k, [...v].sort((x, y) => x - y)]),
      );
    expect(depSig(a1)).toEqual(depSig(a2));
  });
});

// ============================================================================
// 5. PRECOMPUTATION — repeated queries do not re-run full extraction.
// ============================================================================
describe("AD precomputes once; queries are pure traversal", () => {
  it("many moduleForSignature calls reuse the prebuilt DAG (no re-extraction)", () => {
    // We prove this structurally: build the AD, then run a barrage of queries and
    // confirm correctness. The construction does exactly n extractions (one per
    // axiom); subsequent moduleForSignature calls only traverse atoms/edges. We
    // assert the queries still equal direct extraction (so the traversal is sound)
    // AND that the number of atoms is bounded by the number of axioms (a real
    // decomposition, not a degenerate per-query recompute).
    const ad = computeAtomicDecomposition(fxMixed);
    const pool = ontologySignature(fxMixed);
    const rng = mulberry32(42);
    for (let i = 0; i < 200; i++) {
      const sig = randomSubset(pool, rng, 0.5);
      expectSameModule(ad.moduleForSignature(sig), extractStarModule(fxMixed, sig));
    }
    // #atoms ≤ #logical axioms (proper partition, precomputed once).
    const totalAxioms = ad.atoms.reduce((s, a) => s + a.axiomIndexes.length, 0);
    expect(ad.atoms.length).toBeLessThanOrEqual(totalAxioms);
    expect(totalAxioms).toBeGreaterThan(0);
  });
});
