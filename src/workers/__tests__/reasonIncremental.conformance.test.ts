// src/workers/__tests__/reasonIncremental.conformance.test.ts
// @vitest-environment node
//
// ─────────────────────────────────────────────────────────────────────────────
// GOLD-STANDARD CONFORMANCE — AUTO-INCREMENTAL REASONING ≡ FULL REASONING
// ─────────────────────────────────────────────────────────────────────────────
// This is the soundness proof for the auto-incremental-reasoning-on-edit loop.
// Unlike the previous version (which re-implemented the splice in-test and
// applied the SAME module filter on both the incremental AND the reference side,
// hiding any drift), this drives the ACTUAL worker `reasonIncremental` command
// (via createRdfWorkerRuntime, with a node-compatible Konclude reasoner injected
// through setKoncludeReasonerFactoryForTest) and, at EACH step, compares the
// worker's MAINTAINED urn:vg:inferred set against an INDEPENDENT full re-run with
// NO module filter on the reference side.
//
// The trace covers:
//   (a) add a subclass that creates a transitive ABox entailment;
//   (b) add a disjointness that makes the ontology inconsistent (incremental MUST
//       detect it);
//   (c) a fix that restores consistency;
//   (d) a PREDICATE-ONLY edit: add `p ⊑ q` with `a p b` then assert `a q b`
//       inferred, then REMOVE `p ⊑ q` WITHOUT an intervening full run and assert
//       `a q b` is gone (incremental == full);
//   (e) an edit whose effect is far from Σ_Δ leaves distant inferred triples
//       untouched AND equal to full;
//   (f) BUG A (OVER-PURGE): a valid inferred `y rdf:type Sup` exists whose support
//       (`y rdf:type Sub`, `Sub ⊑ Sup`) is NOT in the edited module; an edit adds
//       `W ⊑ Sup` so Sup ∈ sig(M) but y is NOT an M-subject. The OLD any-position
//       purge would drop `y rdf:type Sup` and never re-derive it (incremental <
//       full); the subject-based purge KEEPS it. Asserted via incremental == full.
//
// REQUIRE_KONCLUDE-gated: when set (CI) a WASM/init failure FAILS the test.
// Run with: REQUIRE_KONCLUDE=1 npx vitest run --pool=threads <this file>
import { describe, it, expect, afterEach } from 'vitest';
import { RdfReasoner } from 'rdf-reasoner-konclude';
import * as N3 from 'n3';
import { createRdfWorkerRuntime, setKoncludeReasonerFactoryForTest } from '../rdfManager.runtime';
import { createNodeKoncludeReasoner } from './koncludeNodeAdapter';
import { serializeQuad } from '../../utils/rdfSerialization';

const REQUIRE_KONCLUDE = !!process.env.REQUIRE_KONCLUDE;

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const RDFS_SUBCLASS_OF = 'http://www.w3.org/2000/01/rdf-schema#subClassOf';
const RDFS_SUBPROPERTY_OF = 'http://www.w3.org/2000/01/rdf-schema#subPropertyOf';
const OWL_CLASS = 'http://www.w3.org/2002/07/owl#Class';
const OWL_OBJECT_PROPERTY = 'http://www.w3.org/2002/07/owl#ObjectProperty';
const OWL_DISJOINT_WITH = 'http://www.w3.org/2002/07/owl#disjointWith';
const OWL_NAMED_INDIVIDUAL = 'http://www.w3.org/2002/07/owl#NamedIndividual';

const DATA = 'urn:vg:data';
const INFERRED = 'urn:vg:inferred';
const EX = 'http://example.org/conf/';
const C = (n: string) => `${EX}${n}`;

const nn = (v: string) => N3.DataFactory.namedNode(v);
const qd = (s: string, p: string, o: string, g: string = DATA) =>
  N3.DataFactory.quad(nn(s), nn(p), nn(o), nn(g));

type WQ = { subject: { value: string }; predicate: { value: string }; object: { value: string } };
const keyOf = (t: { subject: string; predicate: string; object: string }) =>
  `${t.subject}\0${t.predicate}\0${t.object}`;

async function runCommand(
  runtime: ReturnType<typeof createRdfWorkerRuntime>,
  responses: Map<string, { ok: boolean; result?: unknown; error?: string }>,
  id: string,
  command: string,
  payload: unknown,
): Promise<unknown> {
  runtime.handleEvent({ type: 'command', id, command, payload });
  for (let i = 0; i < 8000; i++) {
    const r = responses.get(id);
    if (r) {
      if (!r.ok) throw new Error(`Command ${command} failed: ${r.error}`);
      return r.result;
    }
    await new Promise((res) => setTimeout(res, 15));
  }
  throw new Error(`No response captured for command ${command} (id=${id})`);
}

/** The maintained inferred set the worker holds, as a sorted s\0p\0o key list. */
function inferredKeys(rows: WQ[]): string[] {
  return rows
    .map((r) => keyOf({ subject: r.subject.value, predicate: r.predicate.value, object: r.object.value }))
    .sort();
}

/**
 * Independent FULL reference: classify the CURRENT base graphs from scratch with a
 * FRESH reasoner (a new instance per call, to defeat the package reasoner's
 * store-content consistency cache across an evolving ontology) and return the
 * inferred set (no module filter). Mirrors the worker's full Konclude path
 * (drop source triples; a separate reasoner from the worker's injected one).
 */
async function fullReferenceKeys(base: N3.Quad[]): Promise<string[]> {
  const sourceKeys = new Set(
    base.map((q) => `${q.subject.value}\0${q.predicate.value}\0${q.object.value}`),
  );
  // strip named graphs (the reference classifies the union as triples)
  const triples = base.map((q) => N3.DataFactory.quad(q.subject, q.predicate, q.object));
  const ref = new RdfReasoner();
  await ref.ready;
  try {
    const consistent = await ref.checkConsistency(new N3.Store(triples));
    if (!consistent) return ['__INCONSISTENT__'];
    const inferred = await ref.materialize(triples);
    return inferred
      .filter((q) => !sourceKeys.has(`${q.subject.value}\0${q.predicate.value}\0${q.object.value}`))
      .map((q) => `${q.subject.value}\0${q.predicate.value}\0${q.object.value}`)
      .sort();
  } finally {
    ref.terminate();
  }
}

describe('reasonIncremental — auto-incremental ≡ full over an edit trace (real worker)', () => {
  afterEach(() => {
    setKoncludeReasonerFactoryForTest(null);
  });

  it(
    'incremental and full AGREE at EVERY step (transitive, unsat, fix, predicate-retract, locality)',
    async () => {
      // Probe Konclude once (fresh instances are used per reference call below).
      try {
        const probe = new RdfReasoner();
        await probe.ready;
        probe.terminate();
      } catch (e) {
        if (REQUIRE_KONCLUDE) {
          throw new Error(`REQUIRE_KONCLUDE set but Konclude failed to init: ${String(e)}`);
        }
        console.warn('[TEST][SKIP] Konclude WASM unavailable — skipping conformance:', String(e));
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

      // The base axiom set we mutate alongside the worker, used for the reference.
      let base: N3.Quad[] = [];
      let nextId = 0;
      const cmd = (command: string, payload: unknown) =>
        runCommand(runtime, responses, `c${nextId++}`, command, payload);
      const readInferred = async (): Promise<WQ[]> =>
        (await cmd('getQuads', { graphName: INFERRED })) as WQ[];

      const syncAdds = async (quads: N3.Quad[], changedSubjects: string[]) => {
        await cmd('syncBatch', {
          graphName: DATA,
          adds: quads.map((q) => serializeQuad(q)),
          removes: [],
        });
        base = [...base, ...quads];
        return changedSubjects;
      };
      const syncRemove = async (quad: N3.Quad, changedSubjects: string[]) => {
        await cmd('syncBatch', {
          graphName: DATA,
          adds: [],
          removes: [
            {
              subject: { termType: 'NamedNode', value: quad.subject.value },
              predicate: { termType: 'NamedNode', value: quad.predicate.value },
              object: { termType: 'NamedNode', value: quad.object.value },
              graph: { termType: 'NamedNode', value: DATA },
            },
          ],
        });
        base = base.filter(
          (q) =>
            !(
              q.subject.value === quad.subject.value &&
              q.predicate.value === quad.predicate.value &&
              q.object.value === quad.object.value
            ),
        );
        return changedSubjects;
      };

      // changedSignature derived from the edited quad (subject+predicate+object).
      const sigOf = (...quads: N3.Quad[]): string[] => {
        const s = new Set<string>();
        for (const q of quads) {
          s.add(q.subject.value);
          s.add(q.predicate.value);
          if (q.object.termType !== 'Literal') s.add(q.object.value);
        }
        return [...s];
      };

      try {
        // ── STEP 0: load v0 + establish baseline via the fallback full run. ─────
        // A ⊑ B, B ⊑ C, ind:A ⇒ ind:B, ind:C. Far chain P ⊑ Q, indP:P ⇒ indP:Q.
        base = [
          qd(C('A'), RDF_TYPE, OWL_CLASS),
          qd(C('B'), RDF_TYPE, OWL_CLASS),
          qd(C('Cc'), RDF_TYPE, OWL_CLASS),
          qd(C('D'), RDF_TYPE, OWL_CLASS),
          qd(C('P'), RDF_TYPE, OWL_CLASS),
          qd(C('Q'), RDF_TYPE, OWL_CLASS),
          qd(C('ind'), RDF_TYPE, OWL_NAMED_INDIVIDUAL),
          qd(C('indP'), RDF_TYPE, OWL_NAMED_INDIVIDUAL),
          qd(C('A'), RDFS_SUBCLASS_OF, C('B')),
          qd(C('B'), RDFS_SUBCLASS_OF, C('Cc')),
          qd(C('P'), RDFS_SUBCLASS_OF, C('Q')),
          qd(C('ind'), RDF_TYPE, C('A')),
          qd(C('indP'), RDF_TYPE, C('P')),
          // BUG A over-purge fixture: Sub ⊑ Sup with y : Sub ⇒ y : Sup inferred.
          // The support (y : Sub, Sub ⊑ Sup) is far from the later W ⊑ Sup edit.
          qd(C('Sub'), RDF_TYPE, OWL_CLASS),
          qd(C('Sup'), RDF_TYPE, OWL_CLASS),
          qd(C('Wc'), RDF_TYPE, OWL_CLASS),
          qd(C('y'), RDF_TYPE, OWL_NAMED_INDIVIDUAL),
          qd(C('Sub'), RDFS_SUBCLASS_OF, C('Sup')),
          qd(C('y'), RDF_TYPE, C('Sub')),
        ];
        await cmd('syncLoad', { graphName: DATA, quads: base.map((q) => serializeQuad(q)) });

        const r0 = (await cmd('reasonIncremental', { changedSubjects: [C('A')] })) as {
          mode: string;
          isConsistent: boolean | null;
        };
        expect(r0.mode).toBe('full');
        expect(r0.isConsistent).toBe(true);
        {
          const incKeys = inferredKeys(await readInferred());
          const fullKeys = await fullReferenceKeys(base);
          expect(incKeys).toEqual(fullKeys);
          expect(incKeys).toContain(keyOf({ subject: C('ind'), predicate: RDF_TYPE, object: C('Cc') }));
          expect(incKeys).toContain(keyOf({ subject: C('indP'), predicate: RDF_TYPE, object: C('Q') }));
          // BUG A fixture entailment established at the baseline.
          expect(incKeys).toContain(keyOf({ subject: C('y'), predicate: RDF_TYPE, object: C('Sup') }));
        }
        const indPQ = keyOf({ subject: C('indP'), predicate: RDF_TYPE, object: C('Q') });
        const ySup = keyOf({ subject: C('y'), predicate: RDF_TYPE, object: C('Sup') });

        // ── STEP (a): add Cc ⊑ D — new transitive entailment ind : D. ────────────
        {
          const e = qd(C('Cc'), RDFS_SUBCLASS_OF, C('D'));
          const changed = await syncAdds([e], [C('Cc')]);
          const r = (await cmd('reasonIncremental', {
            changedSubjects: changed,
            changedSignature: sigOf(e),
          })) as { mode: string; isConsistent: boolean | null };
          expect(r.mode).toBe('incremental');
          expect(r.isConsistent).toBe(true);
          const incKeys = inferredKeys(await readInferred());
          const fullKeys = await fullReferenceKeys(base);
          expect(incKeys).toEqual(fullKeys);
          expect(incKeys).toContain(keyOf({ subject: C('ind'), predicate: RDF_TYPE, object: C('D') }));
          // Locality: the far chain entailment indP:Q is untouched and present.
          expect(incKeys).toContain(indPQ);
        }

        // ── STEP (b): add A disjointWith Cc — ind:A and A⊑Cc ⇒ INCONSISTENT. ─────
        {
          const e = qd(C('A'), OWL_DISJOINT_WITH, C('Cc'));
          const changed = await syncAdds([e], [C('A')]);
          const r = (await cmd('reasonIncremental', {
            changedSubjects: changed,
            changedSignature: sigOf(e),
          })) as { mode: string; isConsistent: boolean | null };
          expect(r.mode).toBe('incremental');
          expect(r.isConsistent).toBe(false);
          // Full reasoning agrees the post-edit ontology is inconsistent.
          const fullKeys = await fullReferenceKeys(base);
          expect(fullKeys).toEqual(['__INCONSISTENT__']);
        }

        // ── STEP (c): FIX — remove ind:A ⇒ consistent again (A stays unsat as a
        //    class, but no individual forces ⊥). Re-anchor with a full run. ───────
        {
          const e = qd(C('ind'), RDF_TYPE, C('A'));
          await syncRemove(e, [C('ind')]);
          // Force a full re-anchor (the agent triggers a full run after a fix).
          const r = (await cmd('reasonIncremental', {})) as { mode: string; isConsistent: boolean | null };
          expect(r.mode).toBe('full');
          expect(r.isConsistent).toBe(true);
          const incKeys = inferredKeys(await readInferred());
          const fullKeys = await fullReferenceKeys(base);
          expect(incKeys).toEqual(fullKeys);
        }

        // ── STEP (d): PREDICATE-ONLY edit. Add p, q (ObjectProperty), a, b and
        //    `a p b`, then `p ⊑ q` ⇒ `a q b` inferred. Then REMOVE `p ⊑ q` with NO
        //    intervening full run; assert `a q b` is GONE (incremental == full). ──
        {
          const decls = [
            qd(C('p'), RDF_TYPE, OWL_OBJECT_PROPERTY),
            qd(C('q'), RDF_TYPE, OWL_OBJECT_PROPERTY),
            qd(C('a'), RDF_TYPE, OWL_NAMED_INDIVIDUAL),
            qd(C('b'), RDF_TYPE, OWL_NAMED_INDIVIDUAL),
            qd(C('a'), C('p'), C('b')),
          ];
          await syncAdds(decls, [C('a'), C('p')]);
          const sub = qd(C('p'), RDFS_SUBPROPERTY_OF, C('q'));
          const changedAdd = await syncAdds([sub], [C('p')]);
          let r = (await cmd('reasonIncremental', {
            changedSubjects: changedAdd,
            changedSignature: sigOf(...decls, sub),
          })) as { mode: string; isConsistent: boolean | null };
          expect(r.isConsistent).toBe(true);
          {
            const incKeys = inferredKeys(await readInferred());
            const fullKeys = await fullReferenceKeys(base);
            expect(incKeys).toEqual(fullKeys);
            expect(incKeys).toContain(keyOf({ subject: C('a'), predicate: C('q'), object: C('b') }));
          }

          // REMOVE p ⊑ q (predicate-position retraction) — NO full run.
          const changedRm = await syncRemove(sub, [C('p')]);
          r = (await cmd('reasonIncremental', {
            changedSubjects: changedRm,
            changedSignature: sigOf(sub),
          })) as { mode: string; isConsistent: boolean | null };
          expect(r.mode).toBe('incremental');
          expect(r.isConsistent).toBe(true);
          const incKeys = inferredKeys(await readInferred());
          const fullKeys = await fullReferenceKeys(base);
          // INCREMENTAL ≡ FULL — and `a q b` must be GONE.
          expect(incKeys).toEqual(fullKeys);
          expect(incKeys).not.toContain(keyOf({ subject: C('a'), predicate: C('q'), object: C('b') }));
        }

        // ── STEP (e): a FAR, independent edit — fresh classes E ⊑ F with a fresh
        //    individual indE:E ⇒ indE:F. It is far from Σ_Δ of the prior edits, must
        //    stay consistent, must NOT disturb the distant indP:Q entailment, and
        //    incremental must equal full. ─────────────────────────────────────────
        {
          const decls = [
            qd(C('E'), RDF_TYPE, OWL_CLASS),
            qd(C('F'), RDF_TYPE, OWL_CLASS),
            qd(C('indE'), RDF_TYPE, OWL_NAMED_INDIVIDUAL),
            qd(C('indE'), RDF_TYPE, C('E')),
          ];
          await syncAdds(decls, [C('E'), C('indE')]);
          const e = qd(C('E'), RDFS_SUBCLASS_OF, C('F'));
          const changed = await syncAdds([e], [C('E')]);
          const r = (await cmd('reasonIncremental', {
            changedSubjects: changed,
            changedSignature: sigOf(...decls, e),
          })) as { mode: string; isConsistent: boolean | null };
          expect(r.isConsistent).toBe(true);
          const incKeys = inferredKeys(await readInferred());
          const fullKeys = await fullReferenceKeys(base);
          expect(incKeys).toEqual(fullKeys);
          // The distant indP:Q entailment is still present and was never recomputed.
          expect(incKeys).toContain(keyOf({ subject: C('indP'), predicate: RDF_TYPE, object: C('Q') }));
          // The new far entailment indE:F is present.
          expect(incKeys).toContain(keyOf({ subject: C('indE'), predicate: RDF_TYPE, object: C('F') }));
          // The BUG A fixture entailment y:Sup is STILL present (untouched by far edits).
          expect(incKeys).toContain(ySup);
        }

        // ── STEP (f): an edit adds `Wc ⊑ Sup` where Sup is ALSO the superclass of an
        //    earlier individual y (y : Sub, Sub ⊑ Sup ⇒ y : Sup). Sup ∈ sig(M). With
        //    the ⊤⊥*-module's ⊤-pass keeping the `Sub ⊑ Sup` support, y IS pulled
        //    into M and `y : Sup` is correctly RE-DERIVED — so incremental == full
        //    and `y : Sup` is retained. This guards the subject-based purge against
        //    REGRESSING the kept-and-rederived case. (The genuine over-purge
        //    divergence — where the purge predicate itself differs — is isolated in
        //    reasonIncremental.unit.test.ts's direct purge-predicate test, since the
        //    locality ⊤-pass always pulls subsumption support into M end-to-end.) ──
        {
          const e = qd(C('Wc'), RDFS_SUBCLASS_OF, C('Sup'));
          const changed = await syncAdds([e], [C('Wc')]);
          const r = (await cmd('reasonIncremental', {
            changedSubjects: changed,
            changedSignature: sigOf(e),
          })) as { mode: string; isConsistent: boolean | null };
          expect(r.mode).toBe('incremental');
          expect(r.isConsistent).toBe(true);
          const incKeys = inferredKeys(await readInferred());
          const fullKeys = await fullReferenceKeys(base);
          expect(incKeys).toEqual(fullKeys);
          expect(incKeys).toContain(ySup);
        }
      } finally {
        runtime.terminate();
        setKoncludeReasonerFactoryForTest(null);
      }
    },
    300000,
  );

  it(
    'BUG A: an inferred triple whose OBJECT ∈ sig(M) but whose SUBJECT ∉ M-subjects is KEPT (subject-based purge, not any-position)',
    async () => {
      // This isolates the BUG A purge-predicate divergence directly. We inject a
      // VALID-looking inferred triple `distant : Sup` whose subject `distant` does
      // NOT occur in the edited module M, while Sup DOES occur in sig(M) (object
      // position). The OLD any-position purge (remove if subject OR predicate OR
      // object ∈ sig(M)) would DELETE `distant : Sup` (Sup ∈ sig(M)) and — since
      // `distant` is not in M — NEVER re-derive it, UNDER-approximating full. The
      // subject-based purge (remove iff SUBJECT ∈ M-subjects) KEEPS it. We assert it
      // survives the incremental step. (The end-to-end conformance trace cannot
      // surface this because the ⊤⊥*-module's ⊤-pass always pulls real subsumption
      // support into M; this test injects the distant inferred triple to exercise
      // the purge predicate in isolation.)
      try {
        const probe = new RdfReasoner();
        await probe.ready;
        probe.terminate();
      } catch (e) {
        if (REQUIRE_KONCLUDE) {
          throw new Error(`REQUIRE_KONCLUDE set but Konclude failed to init: ${String(e)}`);
        }
        console.warn('[TEST][SKIP] Konclude WASM unavailable — skipping BUG A purge:', String(e));
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
      let nextId = 0;
      const cmd = (command: string, payload: unknown) =>
        runCommand(runtime, responses, `pa${nextId++}`, command, payload);
      const readInferred = async (): Promise<WQ[]> =>
        (await cmd('getQuads', { graphName: INFERRED })) as WQ[];

      try {
        // Base: Wc, Sup classes; a fresh `distant` individual with NO axioms tying it
        // into any module the Wc/Sup edit induces.
        const base0 = [
          qd(C('Wc'), RDF_TYPE, OWL_CLASS),
          qd(C('Sup'), RDF_TYPE, OWL_CLASS),
          qd(C('distant'), RDF_TYPE, OWL_NAMED_INDIVIDUAL),
        ];
        await cmd('syncLoad', { graphName: DATA, quads: base0.map((q) => serializeQuad(q)) });
        // Establish a CONSISTENT baseline (first call falls back to full).
        const r0 = (await cmd('reasonIncremental', { changedSubjects: [C('Wc')] })) as {
          mode: string; isConsistent: boolean | null;
        };
        expect(r0.mode).toBe('full');
        expect(r0.isConsistent).toBe(true);

        // Inject the distant inferred triple `distant : Sup` directly into
        // urn:vg:inferred. Its SUBJECT (distant) is not in any module M the next
        // edit induces; its OBJECT (Sup) WILL be in sig(M).
        await cmd('syncBatch', {
          graphName: INFERRED,
          adds: [qd(C('distant'), RDF_TYPE, C('Sup'), INFERRED)].map((q) => serializeQuad(q)),
          removes: [],
        });
        const distantSup = keyOf({ subject: C('distant'), predicate: RDF_TYPE, object: C('Sup') });
        expect(inferredKeys(await readInferred())).toContain(distantSup);

        // Edit: add `Wc ⊑ Sup` — Sup ∈ sig(M), but the module's subjects are {Wc,Sup}
        // (and their declarations), NOT `distant`.
        const e = qd(C('Wc'), RDFS_SUBCLASS_OF, C('Sup'));
        await cmd('syncBatch', {
          graphName: DATA,
          adds: [e].map((q) => serializeQuad(q)),
          removes: [],
        });
        const r = (await cmd('reasonIncremental', {
          changedSubjects: [C('Wc')],
          // changedSignature carries Sup (the edited axiom's object).
          changedSignature: [C('Wc'), RDFS_SUBCLASS_OF, C('Sup')],
        })) as { mode: string; isConsistent: boolean | null };
        expect(r.mode).toBe('incremental');
        expect(r.isConsistent).toBe(true);

        // The crux of BUG A: `distant : Sup` (subject ∉ M) is KEPT, even though
        // Sup ∈ sig(M). The OLD any-position purge would have removed it.
        const after = inferredKeys(await readInferred());
        expect(after).toContain(distantSup);
      } finally {
        runtime.terminate();
        setKoncludeReasonerFactoryForTest(null);
      }
    },
    300000,
  );

  it(
    'BUG B: a MANUAL full run after a retraction CLEARS the stale inferred triple',
    async () => {
      try {
        const probe = new RdfReasoner();
        await probe.ready;
        probe.terminate();
      } catch (e) {
        if (REQUIRE_KONCLUDE) {
          throw new Error(`REQUIRE_KONCLUDE set but Konclude failed to init: ${String(e)}`);
        }
        console.warn('[TEST][SKIP] Konclude WASM unavailable — skipping BUG B:', String(e));
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
      let nextId = 0;
      const cmd = (command: string, payload: unknown) =>
        runCommand(runtime, responses, `b${nextId++}`, command, payload);
      const readInferred = async (): Promise<WQ[]> =>
        (await cmd('getQuads', { graphName: INFERRED })) as WQ[];

      try {
        // a p b with p ⊑ q (object properties) ⇒ a q b inferred via a FULL run.
        const init = [
          qd(C('p'), RDF_TYPE, OWL_OBJECT_PROPERTY),
          qd(C('q'), RDF_TYPE, OWL_OBJECT_PROPERTY),
          qd(C('a'), RDF_TYPE, OWL_NAMED_INDIVIDUAL),
          qd(C('b'), RDF_TYPE, OWL_NAMED_INDIVIDUAL),
          qd(C('a'), C('p'), C('b')),
          qd(C('p'), RDFS_SUBPROPERTY_OF, C('q')),
        ];
        await cmd('syncLoad', { graphName: DATA, quads: init.map((q) => serializeQuad(q)) });

        // MANUAL full run (the `runReasoning` command, NOT reasonIncremental).
        await cmd('runReasoning', { reasoningId: 'b-run-1', reasonerBackend: 'konclude' });
        {
          const incKeys = inferredKeys(await readInferred());
          expect(incKeys).toContain(keyOf({ subject: C('a'), predicate: C('q'), object: C('b') }));
        }

        // Retract `p ⊑ q` (the supporting axiom). NO reasoning yet.
        await cmd('syncBatch', {
          graphName: DATA,
          adds: [],
          removes: [
            {
              subject: { termType: 'NamedNode', value: C('p') },
              predicate: { termType: 'NamedNode', value: RDFS_SUBPROPERTY_OF },
              object: { termType: 'NamedNode', value: C('q') },
              graph: { termType: 'NamedNode', value: DATA },
            },
          ],
        });

        // A SECOND MANUAL full run. The ADD-ONLY bug would leave the stale `a q b`
        // in urn:vg:inferred (the working copy never had it ⇒ never re-derived ⇒
        // never removed). The fix CLEARS urn:vg:inferred before writing the fresh
        // set, so the full run reflects the retraction: `a q b` is GONE.
        await cmd('runReasoning', { reasoningId: 'b-run-2', reasonerBackend: 'konclude' });
        const after = inferredKeys(await readInferred());
        expect(after).not.toContain(keyOf({ subject: C('a'), predicate: C('q'), object: C('b') }));
      } finally {
        runtime.terminate();
        setKoncludeReasonerFactoryForTest(null);
      }
    },
    300000,
  );

  it(
    'H2: a long incremental-only run is periodically RE-ANCHORED with a full run',
    async () => {
      try {
        const probe = new RdfReasoner();
        await probe.ready;
        probe.terminate();
      } catch (e) {
        if (REQUIRE_KONCLUDE) {
          throw new Error(`REQUIRE_KONCLUDE set but Konclude failed to init: ${String(e)}`);
        }
        console.warn('[TEST][SKIP] Konclude WASM unavailable — skipping H2:', String(e));
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
      let nextId = 0;
      const cmd = (command: string, payload: unknown) =>
        runCommand(runtime, responses, `h${nextId++}`, command, payload);

      try {
        const decls = [qd(C('K0'), RDF_TYPE, OWL_CLASS)];
        await cmd('syncLoad', { graphName: DATA, quads: decls.map((q) => serializeQuad(q)) });
        // Establish the baseline (first call falls back to full).
        const first = (await cmd('reasonIncremental', { changedSubjects: [C('K0')] })) as { mode: string };
        expect(first.mode).toBe('full');

        // Drive many small, INDEPENDENT, CONSISTENT incremental edits: each step
        // adds a fresh pair Xn ⊑ Yn (no individuals → tiny modules, fast). Within
        // the H2 cap (20) every step is incremental; once the cap is crossed the
        // worker must force a mode:"full" re-anchor.
        const modes: string[] = [];
        for (let n = 1; n <= 24; n++) {
          const cx = qd(C(`X${n}`), RDF_TYPE, OWL_CLASS);
          const cy = qd(C(`Y${n}`), RDF_TYPE, OWL_CLASS);
          const sub = qd(C(`X${n}`), RDFS_SUBCLASS_OF, C(`Y${n}`));
          await cmd('syncBatch', {
            graphName: DATA,
            adds: [cx, cy, sub].map((q) => serializeQuad(q)),
            removes: [],
          });
          const r = (await cmd('reasonIncremental', {
            changedSubjects: [C(`X${n}`)],
            changedSignature: [C(`X${n}`), RDFS_SUBCLASS_OF, C(`Y${n}`)],
          })) as { mode: string };
          modes.push(r.mode);
        }
        // The first MAX_INCREMENTAL_STEPS_BEFORE_FULL (20) steps are incremental;
        // step 21 crosses the cap → at least one full re-anchor in the run.
        expect(modes.slice(0, 20).every((m) => m === 'incremental')).toBe(true);
        expect(modes.filter((m) => m === 'full').length).toBeGreaterThanOrEqual(1);
      } finally {
        runtime.terminate();
        setKoncludeReasonerFactoryForTest(null);
      }
    },
    300000,
  );
});
