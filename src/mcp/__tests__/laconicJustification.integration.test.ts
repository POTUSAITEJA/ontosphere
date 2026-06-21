// src/mcp/__tests__/laconicJustification.integration.test.ts
// @vitest-environment node
//
// LACONIC JUSTIFICATIONS — integration with the REAL Konclude reasoner.
//
// Wires the pure laconic module (src/workers/laconicJustification.ts) into the
// live inconsistency-explanation path exactly as the worker does, but driving the
// package `RdfReasoner` directly (the worker spawns a Web Worker unavailable under
// vitest/node — the same pattern computeRepairs.integration.test.ts uses).
//
// The worker's `explainInconsistencyLaconic` post-processes each MIPS by:
//   1. groupQuadsIntoLaconicAxioms — group the flat MIPS quads into logical axioms
//      (principal triple + blank-node closure), the shape splitAxiom consumes;
//   2. computeLaconicAsync — split each axiom into its weaker parts, then contract
//      the superfluous parts using the Konclude consistency oracle.
// This test exercises those SAME two helpers (imported from the worker runtime)
// against the real oracle (`r.checkConsistency`), proving that:
//   • a justification axiom with a superfluous conjunct `A ⊑ B ⊓ C` (where only
//     `A ⊑ B` participates in the clash) is sharpened to `A ⊑ B`, dropping `A ⊑ C`;
//   • the laconic part maps back to the original `A ⊑ B ⊓ C` axiom (source);
//   • the laconic justification is STILL inconsistent (the oracle accepts it) and
//     is a subset/weakening of the original;
//   • a justification with NO superfluous parts is returned unchanged.
//
// REQUIRE_KONCLUDE gating (M3): with the env var set (CI), a WASM/init failure
// FAILS the test. Without it (local dev) the reasoner assertions are skipped via a
// visible console.warn (never a silent green).
import { describe, it, expect } from 'vitest';
import { RdfReasoner } from 'rdf-reasoner-konclude';
import * as N3 from 'n3';
import {
  groupQuadsIntoLaconicAxioms,
  computeLaconicAsync,
  laconicAxiomToQuads,
} from '../../workers/rdfManager.runtime';
import {
  axiomKey,
  type LaconicAxiom,
} from '../../workers/laconicJustification';

const EX = 'http://example.org/';
const A = `${EX}A`;
const B = `${EX}B`;
const C = `${EX}C`;
const D = `${EX}D`;
const SUBCLASS = 'http://www.w3.org/2000/01/rdf-schema#subClassOf';

const REQUIRE_KONCLUDE = !!process.env.REQUIRE_KONCLUDE;

async function initReasonerOrSkip(): Promise<RdfReasoner | undefined> {
  try {
    const r = new RdfReasoner();
    await r.ready;
    return r;
  } catch (e) {
    if (REQUIRE_KONCLUDE) {
      throw new Error(
        `REQUIRE_KONCLUDE is set but the Konclude reasoner failed to initialise: ${String(e)}`,
      );
    }
    console.warn(
      '[TEST][SKIP] Konclude WASM unavailable and REQUIRE_KONCLUDE not set — skipping laconic reasoner assertions:',
      String(e),
    );
    return undefined;
  }
}

function parse(ttl: string): N3.Store {
  const store = new N3.Store();
  store.addQuads(new N3.Parser({ format: 'text/turtle' }).parse(ttl));
  return store;
}

/** The principal subClassOf object of an axiom whose subject is `subject`, if any. */
function subObject(axiom: LaconicAxiom, subject: string): string | undefined {
  const principal = axiom.find((t) => t.predicate === SUBCLASS && t.subject === subject);
  return principal?.object;
}

/** True iff some axiom is the part `subject ⊑ object`. */
function hasSub(axioms: LaconicAxiom[], subject: string, object: string): boolean {
  return axioms.some((ax) => subObject(ax, subject) === object);
}

describe('laconic justifications — integration with real Konclude', () => {
  // FIXTURE: `A ⊑ B ⊓ C` with only the `A ⊑ B` PART driving the clash.
  //   ex:A ⊑ (ex:B ⊓ ex:C)        — the superfluous-conjunct axiom
  //   ex:B owl:disjointWith ex:D  — B and D are disjoint
  //   ex:x a ex:A , ex:D          — x∈A ⇒ x∈B (via A⊑B) AND x∈D ⇒ B/D clash.
  // The `A ⊑ C` part plays no role: dropping it keeps the contradiction.
  const SUPERFLUOUS_TTL = `
@prefix ex: <http://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

ex:A a owl:Class . ex:B a owl:Class . ex:C a owl:Class . ex:D a owl:Class .
ex:A rdfs:subClassOf [ a owl:Class ; owl:intersectionOf ( ex:B ex:C ) ] .
ex:B owl:disjointWith ex:D .
ex:x a ex:A , ex:D .
`;

  it(
    'drops the superfluous A ⊑ C conjunct; laconic = A ⊑ B, mapped back to A ⊑ B ⊓ C',
    async () => {
      const r = await initReasonerOrSkip();
      if (!r) return;
      try {
        const store = parse(SUPERFLUOUS_TTL);

        // 1. Genuine MIPS from the real reasoner.
        const mips = await r.explainInconsistency(store, { maxJustifications: 1 });
        expect(mips.length).toBeGreaterThanOrEqual(1);
        const j = mips[0] as unknown as N3.Quad[];

        // 2. Group the flat MIPS quads into logical axioms (the worker's step 1).
        //    The blank-node closure is reconstructed from the FULL base (the quad
        //    MIPS minimiser prunes the superfluous list cell of the intersection),
        //    so the grouped axiom carries the COMPLETE `B ⊓ C` and laconic can
        //    genuinely drop the `A ⊑ C` part.
        const base = store.getQuads(null, null, null, null) as N3.Quad[];
        const { axioms, sourceQuads } = groupQuadsIntoLaconicAxioms(j, base);

        // The intersection axiom A ⊑ (B ⊓ C) must be present as ONE grouped axiom
        // (principal subClassOf-to-bnode triple + its intersectionOf/list closure).
        const isBnode = (v: string) => v.startsWith('_:') || /^b\d+$/.test(v) || v.startsWith('n3-');
        const interAxiom = axioms.find(
          (ax) => ax[0].subject === A && ax[0].predicate === SUBCLASS && isBnode(ax[0].object),
        );
        // Some reasoners realise the bnode differently; require it to exist.
        expect(interAxiom, 'grouped intersection axiom A ⊑ (B ⊓ C)').toBeDefined();
        // The grouped intersection axiom carries BOTH conjuncts (B and C).
        expect(interAxiom!.some((t) => t.object === B)).toBe(true);
        expect(interAxiom!.some((t) => t.object === C)).toBe(true);

        // 3. The async oracle: a set of laconic parts entails η (inconsistency)
        //    iff conjoining them is inconsistent. Reuse the ORIGINAL quads for an
        //    un-split source axiom; materialise split parts to fresh quads.
        const entails = async (parts: LaconicAxiom[]): Promise<boolean> => {
          const quads: N3.Quad[] = [];
          for (const p of parts) {
            const src = sourceQuads.get(axiomKey(p));
            quads.push(...(src ?? laconicAxiomToQuads(p)));
          }
          return !(await r.checkConsistency(new N3.Store(quads)));
        };

        // Sanity: the whole grouped justification is inconsistent.
        expect(await entails(axioms)).toBe(true);

        // 4. Compute the laconic justification (the worker's step 2).
        const { laconic, sources } = await computeLaconicAsync(axioms, entails);

        // The laconic justification contains the `A ⊑ B` PART …
        expect(hasSub(laconic, A, B)).toBe(true);
        // … but NOT the superfluous `A ⊑ C` part.
        expect(hasSub(laconic, A, C)).toBe(false);

        // The laconic justification is STILL inconsistent (the oracle accepts it).
        expect(await entails(laconic)).toBe(true);

        // Source mapping: the `A ⊑ B` part maps back to the original A ⊑ B ⊓ C axiom.
        const aSubB = laconic.find((ax) => subObject(ax, A) === B);
        expect(aSubB).toBeDefined();
        expect(sources.get(aSubB as LaconicAxiom)).toBe(interAxiom);

        // The laconic set is a subset/weakening of the original (fewer-or-equal
        // axioms, every part necessary — removing any breaks the entailment).
        expect(laconic.length).toBeLessThanOrEqual(axioms.length);
        for (const part of laconic) {
          const without = laconic.filter((p) => p !== part);
          expect(await entails(without)).toBe(false);
        }

        console.log(
          '[TEST] laconic parts:',
          laconic.map((ax) => `${ax[0].subject} ⊑ ${ax[0].object}`),
          '| original axioms:',
          axioms.length,
        );
      } finally {
        r.terminate();
      }
    },
    60000,
  );

  // FIXTURE: a justification with NO superfluous parts — a plain two-axiom clash.
  //   ex:A owl:disjointWith ex:B ; ex:x a ex:A , ex:B.
  // Every quad is its own un-splittable axiom; laconic == the original.
  const NO_SUPERFLUOUS_TTL = `
@prefix ex: <http://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .

ex:A a owl:Class . ex:B a owl:Class .
ex:A owl:disjointWith ex:B .
ex:x a ex:A , ex:B .
`;

  it(
    'a justification with no superfluous parts → laconic == original (unchanged)',
    async () => {
      const r = await initReasonerOrSkip();
      if (!r) return;
      try {
        const store = parse(NO_SUPERFLUOUS_TTL);
        const mips = await r.explainInconsistency(store, { maxJustifications: 1 });
        expect(mips.length).toBeGreaterThanOrEqual(1);
        const j = mips[0] as unknown as N3.Quad[];

        const { axioms, sourceQuads } = groupQuadsIntoLaconicAxioms(j);
        const entails = async (parts: LaconicAxiom[]): Promise<boolean> => {
          const quads: N3.Quad[] = [];
          for (const p of parts) {
            const src = sourceQuads.get(axiomKey(p));
            quads.push(...(src ?? laconicAxiomToQuads(p)));
          }
          return !(await r.checkConsistency(new N3.Store(quads)));
        };

        const { laconic } = await computeLaconicAsync(axioms, entails);

        // No axiom split into smaller parts ⇒ same count, same keys.
        expect(laconic).toHaveLength(axioms.length);
        const before = axioms.map(axiomKey).sort();
        const after = laconic.map(axiomKey).sort();
        expect(after).toEqual(before);
        // Still inconsistent and minimal.
        expect(await entails(laconic)).toBe(true);
      } finally {
        r.terminate();
      }
    },
    60000,
  );
});
