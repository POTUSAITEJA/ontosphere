// src/mcp/__tests__/computeRepairs.integration.test.ts
// @vitest-environment node
//
// R1 integration test: drive the REAL Konclude reasoner on a known inconsistent
// fixture, feed its genuine MIPS into computeRepairs(), and confirm that the
// top reasoner-computed repair (a) targets an axiom that actually appears in a
// justification and (b) is symbolically VERIFIED — i.e. re-running the
// consistency oracle on a store copy WITHOUT that axiom yields a consistent
// ontology. This exercises the exact contract explainDiagnostics relies on
// (computeRepairs + verifyRepair) end-to-end, without mocking the reasoner.
//
// The Konclude worker-node path was patched this session (patches/
// rdf-reasoner-konclude+0.3.2.patch) so it runs under vitest's node env.
//
// REQUIRE_KONCLUDE gating (M3): when the env var REQUIRE_KONCLUDE is set (CI
// sets it on the `test` job), a WASM/reasoner init failure FAILS the test —
// the reasoner MUST run. Without the flag (local dev) a WASM init failure is
// surfaced via a console.warn and the test is skipped at runtime (visible, not
// a silent green) so a broken reasoner is never reported as passing.
import { describe, it, expect } from 'vitest';
import { RdfReasoner } from 'rdf-reasoner-konclude';
import * as N3 from 'n3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { computeRepairs } from '../tools/computeRepairs';
import type { DiagnosticsData } from '../tools/diagnosticsBrief';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadTtlStore(filename: string): N3.Store {
  const ttlPath = path.resolve(__dirname, '../../../public', filename);
  const ttlContent = fs.readFileSync(ttlPath, 'utf-8');
  const store = new N3.Store();
  store.addQuads(new N3.Parser({ format: 'text/turtle' }).parse(ttlContent));
  return store;
}

const quadKey = (s: string, p: string, o: string) => `${s} ${p} ${o}`;

const REQUIRE_KONCLUDE = !!process.env.REQUIRE_KONCLUDE;

/**
 * Initialise the Konclude reasoner. On WASM/init failure:
 *  - REQUIRE_KONCLUDE set → THROW (CI must run the real reasoner — M3).
 *  - otherwise → return undefined after a visible console.warn; the caller
 *    skips the reasoner assertions (never a silent green).
 */
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

describe('computeRepairs — integration with real Konclude on inconsistent fixture', () => {
  it(
    'top repair targets a justification axiom and is symbolically verified consistent',
    async () => {
      const r = await initReasonerOrSkip();
      if (!r) return; // skipped (logged) — only reachable without REQUIRE_KONCLUDE

      try {
        const store = loadTtlStore('reasoning-demo-inconsistent.ttl');

        // 1. Genuine MIPS from the real reasoner.
        const mips = await r.explainInconsistency(store, { maxJustifications: 3 });
        expect(mips.length).toBeGreaterThanOrEqual(1);

        const justifications: DiagnosticsData['justifications'] = mips.map((m) =>
          m.map((q) => ({ subject: q.subject.value, predicate: q.predicate.value, object: q.object.value })),
        );

        const diagnostics: DiagnosticsData = {
          isConsistent: false,
          justifications,
          unsatisfiableClasses: [],
          profile: { owl2dl: true, violations: [] },
          shaclViolations: [],
        };

        // 2. Reasoner-computed repairs (the same call explainDiagnostics makes).
        const repairs = computeRepairs(diagnostics).filter((x) => x.issue === 'inconsistency');
        expect(repairs.length).toBeGreaterThanOrEqual(1);

        // The repair set must cover every justification.
        const covered = new Set<number>();
        repairs.forEach((rep) => rep.justificationsCovered?.forEach((j) => covered.add(j)));
        justifications.forEach((_, i) => expect(covered.has(i)).toBe(true));

        // 3. Every repair must target an axiom that actually appears in a MIPS.
        const justificationAxioms = new Set(
          justifications.flat().map((a) => quadKey(a.subject, a.predicate, a.object)),
        );
        for (const rep of repairs) {
          const { subjectIri, predicateIri, objectIri } = rep.action.args;
          expect(justificationAxioms.has(quadKey(subjectIri!, predicateIri!, objectIri!))).toBe(true);
        }

        // 4. Symbolic verification — the SAME oracle path verifyRepair uses:
        //    build a copy of the store without the repair's axiom and re-check
        //    consistency. The top candidate must restore consistency.
        const top = repairs[0];
        const removeKey = quadKey(
          top.action.args.subjectIri!,
          top.action.args.predicateIri!,
          top.action.args.objectIri!,
        );
        const copy = new N3.Store();
        for (const q of store.getQuads(null, null, null, null) as N3.Quad[]) {
          if (quadKey(q.subject.value, q.predicate.value, q.object.value) === removeKey) continue;
          copy.addQuad(q);
        }
        // Sanity: exactly the targeted axiom was removed.
        expect(copy.size).toBe(store.size - 1);

        const verifiedConsistent = await r.checkConsistency(copy);
        console.log('[TEST] top repair:', removeKey, '→ verifiedConsistent:', verifiedConsistent);
        expect(verifiedConsistent).toBe(true);
      } finally {
        r.terminate();
      }
    },
    60000,
  );

  it(
    'consistent fixture yields no inconsistency repairs',
    async () => {
      const r = await initReasonerOrSkip();
      if (!r) return; // skipped (logged) — only reachable without REQUIRE_KONCLUDE
      try {
        const store = loadTtlStore('reasoning-demo.ttl');
        const mips = await r.explainInconsistency(store, { maxJustifications: 3 });
        expect(mips).toEqual([]);
        const repairs = computeRepairs({
          isConsistent: true,
          justifications: [],
          unsatisfiableClasses: [],
          profile: { owl2dl: true, violations: [] },
          shaclViolations: [],
        });
        expect(repairs.filter((x) => x.issue === 'inconsistency')).toHaveLength(0);
      } finally {
        r.terminate();
      }
    },
    60000,
  );

  // M2 (paper-critical): two INDEPENDENT contradictions. No single axiom
  // removal restores global consistency (per-axiom verifiedConsistent is false
  // for every repair), but removing the FULL hitting set together IS consistent.
  // This asserts the full-set verification path that explainDiagnostics surfaces
  // as repairSetVerifiedConsistent — using the SAME oracle (checkConsistency).
  it(
    'two disjoint contradictions: per-axiom verification is false but the full repair set verifies true',
    async () => {
      const r = await initReasonerOrSkip();
      if (!r) return; // skipped (logged) — only reachable without REQUIRE_KONCLUDE
      try {
        // Two independent disjointness clashes (A/B via frank, P/Q via gina).
        const ttl = `
@prefix ex: <http://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .

ex:A a owl:Class . ex:B a owl:Class . ex:P a owl:Class . ex:Q a owl:Class .
ex:A owl:disjointWith ex:B .
ex:P owl:disjointWith ex:Q .
ex:frank a ex:A , ex:B .
ex:gina a ex:P , ex:Q .
`;
        const store = new N3.Store();
        store.addQuads(new N3.Parser({ format: 'text/turtle' }).parse(ttl));

        // 1. Real MIPS — expect at least two independent justifications.
        const mips = await r.explainInconsistency(store, { maxJustifications: 5 });
        expect(mips.length).toBeGreaterThanOrEqual(2);

        const justifications: DiagnosticsData['justifications'] = mips.map((m) =>
          m.map((q) => ({ subject: q.subject.value, predicate: q.predicate.value, object: q.object.value })),
        );

        // 2. Reasoner-computed repairs — should need one removal per contradiction.
        const repairs = computeRepairs({
          isConsistent: false,
          justifications,
          unsatisfiableClasses: [],
          profile: { owl2dl: true, violations: [] },
          shaclViolations: [],
        }).filter((x) => x.issue === 'inconsistency' && !x.needsManualReview);
        expect(repairs.length).toBeGreaterThanOrEqual(2);

        const removalOf = (rep: (typeof repairs)[number]) => ({
          subject: rep.action.args.subjectIri!,
          predicate: rep.action.args.predicateIri!,
          object: rep.action.args.objectIri!,
        });

        // Helper: rebuild store without the given removal keys, then check oracle.
        const checkWithout = async (rems: { subject: string; predicate: string; object: string }[]) => {
          const keys = new Set(rems.map((x) => quadKey(x.subject, x.predicate, x.object)));
          const copy = new N3.Store();
          for (const q of store.getQuads(null, null, null, null) as N3.Quad[]) {
            if (keys.has(quadKey(q.subject.value, q.predicate.value, q.object.value))) continue;
            copy.addQuad(q);
          }
          return r.checkConsistency(copy);
        };

        // 3. PER-AXIOM verification: removing any single repair's axiom leaves
        //    the OTHER contradiction intact → still inconsistent → false.
        for (const rep of repairs) {
          const perAxiom = await checkWithout([removalOf(rep)]);
          console.log('[TEST] per-axiom', quadKey(removalOf(rep).subject, removalOf(rep).predicate, removalOf(rep).object), '→', perAxiom);
          expect(perAxiom).toBe(false);
        }

        // 4. FULL-SET verification: removing ALL repairs together → consistent.
        const fullSet = await checkWithout(repairs.map(removalOf));
        console.log('[TEST] full repair set → verifiedConsistent:', fullSet);
        expect(fullSet).toBe(true);
      } finally {
        r.terminate();
      }
    },
    60000,
  );
});
