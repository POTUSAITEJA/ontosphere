// src/workers/__tests__/reasonIncremental.repro.test.ts
// @vitest-environment node
//
// ─────────────────────────────────────────────────────────────────────────────
// SOUNDNESS REPRO — retraction of a PREDICATE-position axiom must purge the
// stale inferred triple it backed (C1 + C2).
// ─────────────────────────────────────────────────────────────────────────────
// Drives the ACTUAL worker `reasonIncremental` command (via the runtime, exactly
// like reasonIncremental.unit.test.ts) with a node-compatible Konclude reasoner
// injected through setKoncludeReasonerFactoryForTest — so this exercises the REAL
// handleReasonIncremental splice, NOT a re-implementation.
//
// Trace:
//   Baseline:  p rdfs:subPropertyOf q ; a p b   (+ declarations).
//   Full run → infers `a q b`.  Establish baseline (mode:"full").
//   REMOVE `p rdfs:subPropertyOf q` via syncBatch, then reasonIncremental.
//   ASSERT urn:vg:inferred NO LONGER contains `a q b` (a full re-run would drop
//   it — incremental must agree).
//
// Against the PRE-FIX code this FAILS: Σ_Δ carried only the changed SUBJECT (p),
// the module's purge was keyed on subjects-in-module, and after removing the
// axiom `a` was no longer a module subject, so `a q b` was never purged.
// REQUIRE_KONCLUDE-gated: when set a WASM failure fails the test.
import { describe, it, expect, afterEach } from 'vitest';
import * as N3 from 'n3';
import { createRdfWorkerRuntime, setKoncludeReasonerFactoryForTest } from '../rdfManager.runtime';
import { createNodeKoncludeReasoner } from './koncludeNodeAdapter';
import { serializeQuad } from '../../utils/rdfSerialization';

const REQUIRE_KONCLUDE = !!process.env.REQUIRE_KONCLUDE;

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const RDFS_SUBPROPERTY_OF = 'http://www.w3.org/2000/01/rdf-schema#subPropertyOf';
const OWL_OBJECT_PROPERTY = 'http://www.w3.org/2002/07/owl#ObjectProperty';
const OWL_NAMED_INDIVIDUAL = 'http://www.w3.org/2002/07/owl#NamedIndividual';
const INFERRED = 'urn:vg:inferred';

const EX = 'http://example.org/repro/';
const C = (n: string) => `${EX}${n}`;

const DATA_GRAPH = 'urn:vg:data';
const nn = (v: string) => N3.DataFactory.namedNode(v);
const q = (s: string, p: string, o: string, g: string = DATA_GRAPH) =>
  N3.DataFactory.quad(nn(s), nn(p), nn(o), nn(g));

async function runCommand(
  runtime: ReturnType<typeof createRdfWorkerRuntime>,
  responses: Map<string, { ok: boolean; result?: unknown; error?: string }>,
  id: string,
  command: string,
  payload: unknown,
): Promise<unknown> {
  runtime.handleEvent({ type: 'command', id, command, payload });
  for (let i = 0; i < 2000; i++) {
    const r = responses.get(id);
    if (r) {
      if (!r.ok) throw new Error(`Command ${command} failed: ${r.error}`);
      return r.result;
    }
    await new Promise((res) => setTimeout(res, 15));
  }
  throw new Error(`No response captured for command ${command} (id=${id})`);
}

describe('reasonIncremental — predicate-retraction soundness (real worker)', () => {
  afterEach(() => {
    setKoncludeReasonerFactoryForTest(null);
  });

  it(
    'removing `p ⊑ q` (with `a p b`) PURGES the stale inferred `a q b`',
    async () => {
      // Probe Konclude once; skip when unavailable and not required.
      try {
        const probe = createNodeKoncludeReasoner();
        await probe.ready;
        probe.terminate();
      } catch (e) {
        if (REQUIRE_KONCLUDE) {
          throw new Error(`REQUIRE_KONCLUDE set but Konclude failed to init: ${String(e)}`);
        }
        console.warn('[TEST][SKIP] Konclude WASM unavailable — skipping repro:', String(e));
        return;
      }

      setKoncludeReasonerFactoryForTest(() => createNodeKoncludeReasoner());

      const responses = new Map<string, { ok: boolean; result?: unknown; error?: string }>();
      const runtime = createRdfWorkerRuntime((message: unknown) => {
        const m = message as { type?: string; id?: string; ok?: boolean; result?: unknown; error?: string };
        if (m && m.type === 'response' && typeof m.id === 'string') {
          responses.set(m.id, { ok: !!m.ok, result: m.result, error: m.error });
        }
      });

      try {
        // ── Baseline: p ⊑ q ; a p b (+ declarations) loaded into urn:vg:data. ──
        const baseline = [
          q(C('p'), RDF_TYPE, OWL_OBJECT_PROPERTY),
          q(C('q'), RDF_TYPE, OWL_OBJECT_PROPERTY),
          q(C('a'), RDF_TYPE, OWL_NAMED_INDIVIDUAL),
          q(C('b'), RDF_TYPE, OWL_NAMED_INDIVIDUAL),
          q(C('p'), RDFS_SUBPROPERTY_OF, C('q')),
          q(C('a'), C('p'), C('b')),
        ];
        const quads = baseline.map((x) => serializeQuad(x));
        await runCommand(runtime, responses, 'load', 'syncLoad', {
          graphName: 'urn:vg:data',
          quads,
        });

        // ── FULL run establishes the baseline AND infers `a q b`. ──────────────
        // No baseline yet ⇒ reasonIncremental falls back to a full run.
        const full = (await runCommand(runtime, responses, 'inc-full', 'reasonIncremental', {
          changedSubjects: [C('p')],
        })) as { mode: string; isConsistent: boolean | null };
        expect(full.mode).toBe('full');
        expect(full.isConsistent).toBe(true);

        // urn:vg:inferred must now contain `a q b`.
        const inferredAfterFull = (await runCommand(runtime, responses, 'qf', 'getQuads', {
          graphName: INFERRED,
        })) as Array<{ subject: { value: string }; predicate: { value: string }; object: { value: string } }>;
        const hasAQB = (rows: typeof inferredAfterFull) =>
          rows.some(
            (r) =>
              r.subject.value === C('a') &&
              r.predicate.value === C('q') &&
              r.object.value === C('b'),
          );
        expect(hasAQB(inferredAfterFull)).toBe(true);

        // ── REMOVE `p ⊑ q` via syncBatch (carries the full changed signature). ──
        await runCommand(runtime, responses, 'rm', 'syncBatch', {
          graphName: 'urn:vg:data',
          adds: [],
          removes: [
            {
              subject: { termType: 'NamedNode', value: C('p') },
              predicate: { termType: 'NamedNode', value: RDFS_SUBPROPERTY_OF },
              object: { termType: 'NamedNode', value: C('q') },
              graph: { termType: 'NamedNode', value: 'urn:vg:data' },
            },
          ],
        });

        // ── INCREMENTAL step — must PURGE the stale `a q b`. ───────────────────
        // changedSignature carries the FULL signature of the retracted axiom
        // (subject p + predicate rdfs:subPropertyOf + object q) — exactly what the
        // C2 plumbing (syncBatch → emitSubjects meta → ReactodiaCanvas) forwards.
        // It pulls the property symbol q into Σ_Δ so the splice's purge (keyed on
        // sig(M)) removes the now-stale `a q b`.
        const inc = (await runCommand(runtime, responses, 'inc2', 'reasonIncremental', {
          changedSubjects: [C('p')],
          changedSignature: [C('p'), RDFS_SUBPROPERTY_OF, C('q')],
        })) as { mode: string; isConsistent: boolean | null };
        expect(inc.mode).toBe('incremental');
        expect(inc.isConsistent).toBe(true);

        const inferredAfterInc = (await runCommand(runtime, responses, 'qi', 'getQuads', {
          graphName: INFERRED,
        })) as typeof inferredAfterFull;
        // SOUNDNESS: `a q b` is no longer entailed (the supporting subproperty
        // axiom was retracted) → the maintained inferred set must drop it.
        expect(hasAQB(inferredAfterInc)).toBe(false);
      } finally {
        runtime.terminate();
        setKoncludeReasonerFactoryForTest(null);
      }
    },
    180000,
  );
});
