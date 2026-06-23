// src/mcp/__tests__/axiomWeakening.integration.test.ts
// @vitest-environment node
//
// Integration test for AXIOM WEAKENING (Troquard et al. AAAI 2018; Li & Lambrix
// ISWC 2024) against the REAL Konclude reasoner. Builds an inconsistency caused
// by `A ⊑ B` where B is disjoint with E and A is ALSO ⊑ E (so A is unsatisfiable
// and, with an instance, the ontology is inconsistent). The weakening that
// replaces `A ⊑ B` with `A ⊑ C` (C ⊒ B, C NOT disjoint with E) restores
// consistency AND preserves `A ⊑ C` — strictly more knowledge than deleting
// `A ⊑ B` outright. We assert:
//   1. computeRepairs + addWeakeningRepairs OFFERS the A ⊑ C weakening.
//   2. The real reasoner VERIFIES it (remove A⊑B + add A⊑C ⇒ consistent).
//   3. It preserves A ⊑ C (the post-weakening store still entails A ⊑ C),
//      which plain deletion of A⊑B does NOT.
//
// REQUIRE_KONCLUDE gating (M3): with the env var set (CI) a WASM/init failure
// FAILS the test; without it the reasoner assertions are skipped (visibly logged).
import { describe, it, expect } from 'vitest';
import { RdfReasoner } from 'rdf-reasoner-konclude';
import * as N3 from 'n3';
import { computeRepairs, addWeakeningRepairs } from '../tools/computeRepairs';
import {
  buildClassHierarchy,
  buildDirectEdgeMap,
  type ClassHierarchy,
} from '../tools/axiomWeakening';
import type { DiagnosticsData } from '../tools/diagnosticsBrief';

const EX = 'http://example.org/';
const A = `${EX}A`;
const B = `${EX}B`;
const C = `${EX}C`;
const E = `${EX}E`;
const RDFS_SUBCLASS_OF = 'http://www.w3.org/2000/01/rdf-schema#subClassOf';

const quadKey = (s: string, p: string, o: string) => `${s} ${p} ${o}`;
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
      '[TEST][SKIP] Konclude WASM unavailable and REQUIRE_KONCLUDE not set — skipping reasoner assertions:',
      String(e),
    );
    return undefined;
  }
}

// Ontology: A ⊑ B, A ⊑ E, B ⊑ C, E owl:disjointWith C? NO — we need B disjoint
// with E while C (B's superclass) is NOT disjoint with E, so weakening A⊑B to
// A⊑C removes the clash. Individual a:A makes A's unsatisfiability a global
// inconsistency.
const TTL = `
@prefix ex: <http://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

ex:A a owl:Class . ex:B a owl:Class . ex:C a owl:Class . ex:E a owl:Class .
ex:B rdfs:subClassOf ex:C .
ex:A rdfs:subClassOf ex:B .
ex:A rdfs:subClassOf ex:E .
ex:B owl:disjointWith ex:E .
ex:a a ex:A .
`;

function parseStore(ttl: string): N3.Store {
  const store = new N3.Store();
  store.addQuads(new N3.Parser({ format: 'text/turtle' }).parse(ttl));
  return store;
}

/** Build the class hierarchy from the asserted subClassOf edges in the store. */
function hierarchyFromStore(store: N3.Store): {
  hierarchy: ClassHierarchy;
  direct: Map<string, Set<string>>;
} {
  const edges: Array<{ sub: string; sup: string }> = [];
  for (const q of store.getQuads(null, N3.DataFactory.namedNode(RDFS_SUBCLASS_OF), null, null) as N3.Quad[]) {
    if (q.subject.termType === 'NamedNode' && q.object.termType === 'NamedNode') {
      edges.push({ sub: q.subject.value, sup: q.object.value });
    }
  }
  return { hierarchy: buildClassHierarchy(edges), direct: buildDirectEdgeMap(edges) };
}

/** Rebuild a store applying a weakening batch (remove A⊑B, add A⊑C). */
function applyBatch(
  store: N3.Store,
  removes: Array<{ subject: string; predicate: string; object: string }>,
  adds: Array<{ subject: string; predicate: string; object: string }>,
): N3.Store {
  const removeKeys = new Set(removes.map((t) => quadKey(t.subject, t.predicate, t.object)));
  const copy = new N3.Store();
  for (const q of store.getQuads(null, null, null, null) as N3.Quad[]) {
    if (removeKeys.has(quadKey(q.subject.value, q.predicate.value, q.object.value))) continue;
    copy.addQuad(q);
  }
  const { namedNode } = N3.DataFactory;
  for (const t of adds) copy.addQuad(namedNode(t.subject), namedNode(t.predicate), namedNode(t.object));
  return copy;
}

describe('axiom weakening — integration with real Konclude', () => {
  it(
    'offers and verifies A ⊑ C weakening of A ⊑ B; it restores consistency and preserves A ⊑ C',
    async () => {
      const r = await initReasonerOrSkip();
      if (!r) return; // skipped (logged) without REQUIRE_KONCLUDE
      try {
        const store = parseStore(TTL);

        // 0. Sanity: the original ontology is inconsistent (A ⊑ B ⊓ E, B disj E, a:A).
        const consistent0 = await r.checkConsistency(store);
        expect(consistent0).toBe(false);

        // 1. Real MIPS → DiagnosticsData.
        const mips = await r.explainInconsistency(store, { maxJustifications: 5 });
        expect(mips.length).toBeGreaterThanOrEqual(1);
        const justifications: DiagnosticsData['justifications'] = mips.map((m) =>
          m.map((q) => ({ subject: q.subject.value, predicate: q.predicate.value, object: q.object.value })),
        );

        // 2. Deletion repairs + WEAKENING augmentation (the explainDiagnostics path).
        const { hierarchy, direct } = hierarchyFromStore(store);
        const deletionRepairs = computeRepairs({
          isConsistent: false,
          justifications,
          unsatisfiableClasses: [],
          profile: { owl2dl: true, violations: [] },
          shaclViolations: [],
        });
        const repairs = addWeakeningRepairs(deletionRepairs, { hierarchy, direct, justifications });

        const weakenings = repairs.filter((x) => x.kind === 'weaken');
        console.log(
          '[TEST] weakenings offered:',
          weakenings.map((w) => `${w.id} ${w.weakerThan} → add ${w.batch?.adds.map((a) => a.object).join(',') || '(none)'}`),
        );

        // 3. There must be a weakening that replaces A⊑B with A⊑C (the non-disjoint
        //    superclass). Find any weakening whose add is exactly A rdfs:subClassOf C.
        const acWeakening = weakenings.find(
          (w) =>
            w.batch?.removes.some((t) => t.subject === A && t.object === B) &&
            w.batch?.adds.some((t) => t.subject === A && t.predicate === RDFS_SUBCLASS_OF && t.object === C),
        );
        expect(acWeakening, 'expected an A ⊑ C weakening of the A ⊑ B culprit').toBeDefined();

        // 4. VERIFY with the real reasoner: applying the weakening batch
        //    (remove A⊑B, add A⊑C) restores consistency.
        const weakened = applyBatch(
          store,
          acWeakening!.batch!.removes.map((t) => ({ subject: t.subject, predicate: t.predicate, object: t.object })),
          acWeakening!.batch!.adds.map((t) => ({ subject: t.subject, predicate: t.predicate, object: t.object })),
        );
        const consistentAfter = await r.checkConsistency(weakened);
        console.log('[TEST] after A⊑C weakening → consistent:', consistentAfter);
        expect(consistentAfter).toBe(true);

        // 5. PRESERVATION: the weakened store still contains A ⊑ C (more knowledge
        //    than deletion of A ⊑ B, which would leave A with NO B-side superclass).
        const hasAC = weakened
          .getQuads(N3.DataFactory.namedNode(A), N3.DataFactory.namedNode(RDFS_SUBCLASS_OF), N3.DataFactory.namedNode(C), null)
          .length > 0;
        expect(hasAC).toBe(true);

        // 6. CONTRAST: plain deletion of A⊑B (no add) also restores consistency,
        //    but does NOT assert A ⊑ C — confirming weakening preserves strictly more.
        const deletedOnly = applyBatch(store, [{ subject: A, predicate: RDFS_SUBCLASS_OF, object: B }], []);
        const consistentDeleted = await r.checkConsistency(deletedOnly);
        expect(consistentDeleted).toBe(true);
        const deletedHasAC = deletedOnly
          .getQuads(N3.DataFactory.namedNode(A), N3.DataFactory.namedNode(RDFS_SUBCLASS_OF), N3.DataFactory.namedNode(C), null)
          .length > 0;
        expect(deletedHasAC).toBe(false);
      } finally {
        r.terminate();
      }
    },
    60000,
  );
});
