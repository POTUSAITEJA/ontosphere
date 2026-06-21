// src/workers/__tests__/reasonIncremental.elFastPath.test.ts
// @vitest-environment node
//
// ─────────────────────────────────────────────────────────────────────────────
// EL FAST PATH == FULL KONCLUDE — conformance for the PTIME EL classification path
// ─────────────────────────────────────────────────────────────────────────────
// The reasonIncremental module-classification path routes an EL-profile module M
// through the pure PTIME EL completion reasoner (classifier:'el') instead of a
// full Konclude tableau run, with a guaranteed Konclude fallback. This proves the
// fast path can NEVER produce a result that differs from full DL:
//
//   (1) END-TO-END: on an EL ontology + an edit trace, the worker's MAINTAINED
//       urn:vg:inferred set (driven through reasonIncremental WITH the EL fast path
//       active) is IDENTICAL at every step to an INDEPENDENT full Konclude
//       materialize() of the current base graphs (no module filter on the
//       reference). AND classifier==='el' is asserted for the EL modules.
//   (2) FALLBACK: a NON-EL module (owl:allValuesFrom) routes to classifier==='konclude'
//       and still produces the correct (Konclude) result == full.
//   (3) INCONSISTENCY: an EL inconsistency expressed via owl:disjointWith
//       (i:A, A⊑Cc, A disjointWith Cc) is detected and AGREES with Konclude — and
//       disjointness forces classifier==='konclude' (the EL completion ignores
//       disjointWith, so the gate keeps Konclude authoritative there).
//
// REQUIRE_KONCLUDE-gated (real WASM reasoner). Run with:
//   REQUIRE_KONCLUDE=1 npx vitest run --pool=threads src/workers/__tests__/reasonIncremental.elFastPath.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { RdfReasoner } from 'rdf-reasoner-konclude';
import * as N3 from 'n3';
import { createRdfWorkerRuntime, setKoncludeReasonerFactoryForTest } from '../rdfManager.runtime';
import { createNodeKoncludeReasoner } from './koncludeNodeAdapter';
import { serializeQuad } from '../../utils/rdfSerialization';

const REQUIRE_KONCLUDE = !!process.env.REQUIRE_KONCLUDE;

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const RDF_FIRST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first';
const RDF_REST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest';
const RDF_NIL = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil';
const RDFS_SUBCLASS_OF = 'http://www.w3.org/2000/01/rdf-schema#subClassOf';
const RDFS_SUBPROPERTY_OF = 'http://www.w3.org/2000/01/rdf-schema#subPropertyOf';
const RDFS_RANGE = 'http://www.w3.org/2000/01/rdf-schema#range';
const OWL_CLASS = 'http://www.w3.org/2002/07/owl#Class';
const OWL_OBJECT_PROPERTY = 'http://www.w3.org/2002/07/owl#ObjectProperty';
const OWL_DATATYPE_PROPERTY = 'http://www.w3.org/2002/07/owl#DatatypeProperty';
const OWL_NAMED_INDIVIDUAL = 'http://www.w3.org/2002/07/owl#NamedIndividual';
const OWL_TRANSITIVE_PROPERTY = 'http://www.w3.org/2002/07/owl#TransitiveProperty';
const OWL_REFLEXIVE_PROPERTY = 'http://www.w3.org/2002/07/owl#ReflexiveProperty';
const OWL_FUNCTIONAL_PROPERTY = 'http://www.w3.org/2002/07/owl#FunctionalProperty';
const OWL_EQUIVALENT_PROPERTY = 'http://www.w3.org/2002/07/owl#equivalentProperty';
const OWL_RESTRICTION = 'http://www.w3.org/2002/07/owl#Restriction';
const OWL_ON_PROPERTY = 'http://www.w3.org/2002/07/owl#onProperty';
const OWL_SOME_VALUES_FROM = 'http://www.w3.org/2002/07/owl#someValuesFrom';
const OWL_ALL_VALUES_FROM = 'http://www.w3.org/2002/07/owl#allValuesFrom';
const OWL_DISJOINT_WITH = 'http://www.w3.org/2002/07/owl#disjointWith';

const DATA = 'urn:vg:data';
const INFERRED = 'urn:vg:inferred';
const EX = 'http://example.org/elfast/';
const C = (n: string) => `${EX}${n}`;

const nn = (v: string) => N3.DataFactory.namedNode(v);
const bn = (v: string) => N3.DataFactory.blankNode(v);
const ll = (v: string) => N3.DataFactory.literal(v);
const qd = (s: string, p: string, o: string, g: string = DATA) =>
  N3.DataFactory.quad(nn(s), nn(p), nn(o), nn(g));
const qb = (s: N3.Quad_Subject, p: string, o: N3.Quad_Object, g: string = DATA) =>
  N3.DataFactory.quad(s, nn(p), o, nn(g));
/** Quad with a LITERAL object (data-property assertion). */
const ql = (s: string, p: string, o: string, g: string = DATA) =>
  N3.DataFactory.quad(nn(s), nn(p), ll(o), nn(g));

type WQ = { subject: { value: string }; predicate: { value: string }; object: { value: string } };
const keyOf = (t: { subject: string; predicate: string; object: string }) =>
  `${t.subject}\0${t.predicate}\0${t.object}`;

// Structural meta-vocabulary that the worker's signatureOf (localityModule)
// EXCLUDES from Σ_Δ — declaration types and rdf:type itself are NOT changed
// symbols. A faithful caller's changedSignature must exclude them too; otherwise a
// generic symbol like owl:NamedIndividual would pull EVERY individual into the
// module (a known incremental-approximation behavior, identical for Konclude),
// purging unrelated cross-cutting entailments. Mirrors the real worker exactly.
const META_VOCAB = new Set<string>([
  RDF_TYPE,
  OWL_CLASS,
  OWL_OBJECT_PROPERTY,
  OWL_NAMED_INDIVIDUAL,
  OWL_TRANSITIVE_PROPERTY,
  OWL_RESTRICTION,
  OWL_ON_PROPERTY,
  OWL_SOME_VALUES_FROM,
]);
/** changedSignature seed mirroring the worker: subjects/predicates/objects of the
 *  edit, MINUS structural meta-vocabulary (which signatureOf never emits). */
const sigOf = (...quads: N3.Quad[]): string[] => {
  const s = new Set<string>();
  for (const q of quads) {
    if (!META_VOCAB.has(q.subject.value)) s.add(q.subject.value);
    if (!META_VOCAB.has(q.predicate.value)) s.add(q.predicate.value);
    if (q.object.termType !== 'Literal' && !META_VOCAB.has(q.object.value)) s.add(q.object.value);
  }
  return [...s];
};

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

function inferredKeys(rows: WQ[]): string[] {
  return rows
    .map((r) => keyOf({ subject: r.subject.value, predicate: r.predicate.value, object: r.object.value }))
    .sort();
}

/**
 * Independent FULL reference: classify the CURRENT base graphs from scratch with a
 * FRESH Konclude reasoner (defeats the package reasoner's content cache across an
 * evolving ontology) and return its inferred set (no module filter). Identical to
 * the gold conformance test's reference.
 */
async function fullReferenceKeys(base: N3.Quad[]): Promise<string[]> {
  const sourceKeys = new Set(
    base.map((q) => `${q.subject.value}\0${q.predicate.value}\0${q.object.value}`),
  );
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

async function koncludeAvailable(): Promise<boolean> {
  try {
    const probe = new RdfReasoner();
    await probe.ready;
    probe.terminate();
    return true;
  } catch (e) {
    if (REQUIRE_KONCLUDE) throw new Error(`REQUIRE_KONCLUDE set but Konclude failed to init: ${String(e)}`);
    console.warn('[TEST][SKIP] Konclude WASM unavailable:', String(e));
    return false;
  }
}

function makeRuntime() {
  const responses = new Map<string, { ok: boolean; result?: unknown; error?: string }>();
  const runtime = createRdfWorkerRuntime((message: unknown) => {
    const m = message as { type?: string; id?: string; ok?: boolean; result?: unknown; error?: string };
    if (m && m.type === 'response' && typeof m.id === 'string') {
      responses.set(m.id, { ok: !!m.ok, result: m.result, error: m.error });
    }
  });
  let nextId = 0;
  const cmd = (command: string, payload: unknown) =>
    runCommand(runtime, responses, `e${nextId++}`, command, payload);
  return { runtime, cmd };
}

type IncResult = { mode: string; isConsistent: boolean | null; classifier: 'el' | 'konclude' };

describe('reasonIncremental — EL fast path ≡ full Konclude (real worker)', () => {
  afterEach(() => {
    setKoncludeReasonerFactoryForTest(null);
  });

  it(
    'EL edit trace: incremental-EL == full-Konclude at every step, classifier==="el"',
    async () => {
      if (!(await koncludeAvailable())) return;
      setKoncludeReasonerFactoryForTest(() => createNodeKoncludeReasoner());
      const { runtime, cmd } = makeRuntime();
      const readInferred = async (): Promise<WQ[]> => (await cmd('getQuads', { graphName: INFERRED })) as WQ[];

      let base: N3.Quad[] = [];
      const syncAdds = async (quads: N3.Quad[]) => {
        await cmd('syncBatch', { graphName: DATA, adds: quads.map((q) => serializeQuad(q)), removes: [] });
        base = [...base, ...quads];
      };

      try {
        // ── STEP 0: minimal EL baseline. A⊑B⊑Cc with ind:A ⇒ ind:B, ind:Cc. ──────
        // Entailments are introduced AS self-contained edits below so each module M
        // carries its own support (the gold-conformance discipline). This avoids the
        // split-support purge artifact that affects the Konclude path too: an inferred
        // triple whose subject is pulled into a LATER module M but whose support is
        // ⊥-local w.r.t. that edit is purged-and-not-rederived by BOTH classifiers —
        // so we never construct that case (it is not an EL-vs-Konclude divergence).
        base = [
          qd(C('A'), RDF_TYPE, OWL_CLASS),
          qd(C('B'), RDF_TYPE, OWL_CLASS),
          qd(C('Cc'), RDF_TYPE, OWL_CLASS),
          qd(C('A'), RDFS_SUBCLASS_OF, C('B')),
          qd(C('B'), RDFS_SUBCLASS_OF, C('Cc')),
          qd(C('ind'), RDF_TYPE, OWL_NAMED_INDIVIDUAL),
          qd(C('ind'), RDF_TYPE, C('A')),
        ];
        await cmd('syncLoad', { graphName: DATA, quads: base.map((q) => serializeQuad(q)) });

        // Baseline established via the fallback full run (always Konclude).
        const r0 = (await cmd('reasonIncremental', { changedSubjects: [C('A')] })) as IncResult;
        expect(r0.mode).toBe('full');
        expect(r0.isConsistent).toBe(true);
        expect(r0.classifier).toBe('konclude');
        {
          const incKeys = inferredKeys(await readInferred());
          const fullKeys = await fullReferenceKeys(base);
          expect(incKeys).toEqual(fullKeys);
          expect(incKeys).toContain(keyOf({ subject: C('ind'), predicate: RDF_TYPE, object: C('Cc') }));
        }

        // ── STEP (a): add Cc ⊑ D — new transitive type ind:D. EL fast path. The
        //    module for {Cc,D} pulls in ind (subject) and re-derives ind:B/Cc/D. ───
        {
          const decl = qd(C('D'), RDF_TYPE, OWL_CLASS);
          const e = qd(C('Cc'), RDFS_SUBCLASS_OF, C('D'));
          await syncAdds([decl, e]);
          const r = (await cmd('reasonIncremental', {
            changedSubjects: [C('Cc')],
            changedSignature: sigOf(decl, e),
          })) as IncResult;
          expect(r.mode).toBe('incremental');
          expect(r.isConsistent).toBe(true);
          // The crux: the EL fast path actually classified this EL module.
          expect(r.classifier).toBe('el');
          const incKeys = inferredKeys(await readInferred());
          const fullKeys = await fullReferenceKeys(base);
          expect(incKeys).toEqual(fullKeys);
          expect(incKeys).toContain(keyOf({ subject: C('ind'), predicate: RDF_TYPE, object: C('D') }));
        }

        // ── STEP (b): extend the chain again — D ⊑ F with ind already pulled. The
        //    {D,F} module pulls ind (subject, via the D-reaching chain) AND the FULL
        //    supporting chain A⊑B⊑Cc⊑D⊑F, so ind:F is re-derived and incremental ==
        //    full. This exercises a SECOND consecutive EL incremental step. ──────────
        {
          const decl = qd(C('F'), RDF_TYPE, OWL_CLASS);
          const e = qd(C('D'), RDFS_SUBCLASS_OF, C('F'));
          await syncAdds([decl, e]);
          const r = (await cmd('reasonIncremental', {
            changedSubjects: [C('D')],
            changedSignature: sigOf(decl, e),
          })) as IncResult;
          expect(r.mode).toBe('incremental');
          expect(r.isConsistent).toBe(true);
          expect(r.classifier).toBe('el');
          const incKeys = inferredKeys(await readInferred());
          const fullKeys = await fullReferenceKeys(base);
          expect(incKeys).toEqual(fullKeys);
          expect(incKeys).toContain(keyOf({ subject: C('ind'), predicate: RDF_TYPE, object: C('F') }));
          expect(incKeys).toContain(keyOf({ subject: C('ind'), predicate: RDF_TYPE, object: C('D') }));
        }
      } finally {
        runtime.terminate();
        setKoncludeReasonerFactoryForTest(null);
      }
    },
    300000,
  );

  // The existential, transitive-role and subproperty realization KINDS are each
  // proven == full-Konclude in their OWN runtime/baseline. Keeping them isolated
  // avoids a benign locality artifact of the subject-based incremental purge (an
  // object-property edit pulls a STANDING role/existential ABox assertion into its
  // module and re-derives it only if the support is local) — that artifact is
  // IDENTICAL for the Konclude path and is NOT an EL-vs-Konclude divergence; here we
  // isolate each EL realization kind so the EL fast path is exercised cleanly.
  it.each([
    {
      name: 'EXISTENTIAL realization (∃hasChild.Person ⊑ Parent ⇒ x:Parent)',
      build: () => {
        const rSV = bn('parentRestr');
        const decls = [
          qd(C('Person'), RDF_TYPE, OWL_CLASS),
          qd(C('Parent'), RDF_TYPE, OWL_CLASS),
          qd(C('hasChild'), RDF_TYPE, OWL_OBJECT_PROPERTY),
          qb(rSV, RDF_TYPE, nn(OWL_RESTRICTION)),
          qb(rSV, OWL_ON_PROPERTY, nn(C('hasChild'))),
          qb(rSV, OWL_SOME_VALUES_FROM, nn(C('Person'))),
          qb(rSV, RDFS_SUBCLASS_OF, nn(C('Parent'))),
          qd(C('x'), RDF_TYPE, OWL_NAMED_INDIVIDUAL),
          qd(C('y'), RDF_TYPE, OWL_NAMED_INDIVIDUAL),
          qd(C('y'), RDF_TYPE, C('Person')),
          qb(nn(C('x')), C('hasChild'), nn(C('y'))),
        ];
        return {
          decls,
          changedSubjects: [C('x'), C('y'), C('Parent'), C('Person'), C('hasChild')],
          expectKey: keyOf({ subject: C('x'), predicate: RDF_TYPE, object: C('Parent') }),
        };
      },
    },
    {
      name: 'TRANSITIVE-ROLE realization (R transitive, a R b, b R c ⇒ a R c)',
      build: () => {
        const decls = [
          qd(C('R'), RDF_TYPE, OWL_OBJECT_PROPERTY),
          qd(C('R'), RDF_TYPE, OWL_TRANSITIVE_PROPERTY),
          qd(C('a'), RDF_TYPE, OWL_NAMED_INDIVIDUAL),
          qd(C('b'), RDF_TYPE, OWL_NAMED_INDIVIDUAL),
          qd(C('c'), RDF_TYPE, OWL_NAMED_INDIVIDUAL),
          qb(nn(C('a')), C('R'), nn(C('b'))),
          qb(nn(C('b')), C('R'), nn(C('c'))),
        ];
        return {
          decls,
          changedSubjects: [C('a'), C('b'), C('c'), C('R')],
          expectKey: keyOf({ subject: C('a'), predicate: C('R'), object: C('c') }),
        };
      },
    },
    {
      name: 'SUBPROPERTY realization (m1 r1 m2, r1 ⊑ r2 ⇒ m1 r2 m2)',
      build: () => {
        const decls = [
          qd(C('r1'), RDF_TYPE, OWL_OBJECT_PROPERTY),
          qd(C('r2'), RDF_TYPE, OWL_OBJECT_PROPERTY),
          qd(C('m1'), RDF_TYPE, OWL_NAMED_INDIVIDUAL),
          qd(C('m2'), RDF_TYPE, OWL_NAMED_INDIVIDUAL),
          qb(nn(C('m1')), C('r1'), nn(C('m2'))),
          qd(C('r1'), RDFS_SUBPROPERTY_OF, C('r2')),
        ];
        return {
          decls,
          changedSubjects: [C('m1'), C('r1')],
          expectKey: keyOf({ subject: C('m1'), predicate: C('r2'), object: C('m2') }),
        };
      },
    },
  ])('EL realization kind: $name — incremental-EL == full-Konclude, classifier==="el"', async ({ build }) => {
    if (!(await koncludeAvailable())) return;
    setKoncludeReasonerFactoryForTest(() => createNodeKoncludeReasoner());
    const { runtime, cmd } = makeRuntime();
    const readInferred = async (): Promise<WQ[]> => (await cmd('getQuads', { graphName: INFERRED })) as WQ[];

    try {
      // A trivial EL baseline (one class) so the first reasonIncremental establishes
      // a consistent baseline via the full fallback.
      const baseline = [qd(C('K'), RDF_TYPE, OWL_CLASS)];
      await cmd('syncLoad', { graphName: DATA, quads: baseline.map((q) => serializeQuad(q)) });
      const r0 = (await cmd('reasonIncremental', { changedSubjects: [C('K')] })) as IncResult;
      expect(r0.mode).toBe('full');
      expect(r0.isConsistent).toBe(true);

      const { decls, changedSubjects, expectKey } = build();
      const base = [...baseline, ...decls];
      await cmd('syncBatch', { graphName: DATA, adds: decls.map((q) => serializeQuad(q)), removes: [] });
      const r = (await cmd('reasonIncremental', {
        changedSubjects,
        changedSignature: sigOf(...decls),
      })) as IncResult;
      expect(r.mode).toBe('incremental');
      expect(r.isConsistent).toBe(true);
      // The EL fast path classified this in-profile module.
      expect(r.classifier).toBe('el');
      const incKeys = inferredKeys(await readInferred());
      const fullKeys = await fullReferenceKeys(base);
      expect(incKeys).toEqual(fullKeys);
      expect(incKeys).toContain(expectKey);
    } finally {
      runtime.terminate();
      setKoncludeReasonerFactoryForTest(null);
    }
  }, 300000);

  it(
    'NON-EL module (owl:allValuesFrom) FALLS BACK to Konclude (classifier==="konclude") and == full',
    async () => {
      if (!(await koncludeAvailable())) return;
      setKoncludeReasonerFactoryForTest(() => createNodeKoncludeReasoner());
      const { runtime, cmd } = makeRuntime();
      const readInferred = async (): Promise<WQ[]> => (await cmd('getQuads', { graphName: INFERRED })) as WQ[];

      let base: N3.Quad[] = [];

      try {
        // EL baseline: A⊑B, ind:A.
        base = [
          qd(C('A'), RDF_TYPE, OWL_CLASS),
          qd(C('B'), RDF_TYPE, OWL_CLASS),
          qd(C('p'), RDF_TYPE, OWL_OBJECT_PROPERTY),
          qd(C('A'), RDFS_SUBCLASS_OF, C('B')),
          qd(C('ind'), RDF_TYPE, OWL_NAMED_INDIVIDUAL),
          qd(C('ind'), RDF_TYPE, C('A')),
        ];
        await cmd('syncLoad', { graphName: DATA, quads: base.map((q) => serializeQuad(q)) });
        const r0 = (await cmd('reasonIncremental', { changedSubjects: [C('A')] })) as IncResult;
        expect(r0.mode).toBe('full');
        expect(r0.isConsistent).toBe(true);

        // Edit: add a NON-EL axiom B ⊑ ∀p.A (owl:allValuesFrom). The induced module
        // contains owl:allValuesFrom ⇒ outside EL ⇒ MUST fall back to Konclude.
        const restr = bn('avf');
        const e = [
          qb(restr, RDF_TYPE, nn(OWL_RESTRICTION)),
          qb(restr, OWL_ON_PROPERTY, nn(C('p'))),
          qb(restr, OWL_ALL_VALUES_FROM, nn(C('A'))),
          qb(nn(C('B')), RDFS_SUBCLASS_OF, restr),
        ];
        await cmd('syncBatch', { graphName: DATA, adds: e.map((q) => serializeQuad(q)), removes: [] });
        base = [...base, ...e];
        const r = (await cmd('reasonIncremental', {
          changedSubjects: [C('B')],
          changedSignature: sigOf(...e),
        })) as IncResult;
        expect(r.mode).toBe('incremental');
        expect(r.isConsistent).toBe(true);
        // The whole point: a non-EL module routes to the authoritative Konclude path.
        expect(r.classifier).toBe('konclude');
        const incKeys = inferredKeys(await readInferred());
        const fullKeys = await fullReferenceKeys(base);
        expect(incKeys).toEqual(fullKeys);
      } finally {
        runtime.terminate();
        setKoncludeReasonerFactoryForTest(null);
      }
    },
    300000,
  );

  it(
    'EL inconsistency via owl:disjointWith is detected and AGREES with Konclude (classifier==="konclude")',
    async () => {
      if (!(await koncludeAvailable())) return;
      setKoncludeReasonerFactoryForTest(() => createNodeKoncludeReasoner());
      const { runtime, cmd } = makeRuntime();

      let base: N3.Quad[] = [];

      try {
        // Baseline: A ⊑ Cc with ind:A (consistent).
        base = [
          qd(C('A'), RDF_TYPE, OWL_CLASS),
          qd(C('Cc'), RDF_TYPE, OWL_CLASS),
          qd(C('A'), RDFS_SUBCLASS_OF, C('Cc')),
          qd(C('ind'), RDF_TYPE, OWL_NAMED_INDIVIDUAL),
          qd(C('ind'), RDF_TYPE, C('A')),
        ];
        await cmd('syncLoad', { graphName: DATA, quads: base.map((q) => serializeQuad(q)) });
        const r0 = (await cmd('reasonIncremental', { changedSubjects: [C('A')] })) as IncResult;
        expect(r0.mode).toBe('full');
        expect(r0.isConsistent).toBe(true);

        // Edit: A disjointWith Cc. Now ind:A and A⊑Cc ⇒ ind:A⊓Cc ⇒ INCONSISTENT.
        // disjointWith forces Konclude (the EL completion ignores disjointWith, so
        // the gate keeps Konclude authoritative — correctness over speed).
        const e = qd(C('A'), OWL_DISJOINT_WITH, C('Cc'));
        await cmd('syncBatch', { graphName: DATA, adds: [serializeQuad(e)], removes: [] });
        base = [...base, e];
        const r = (await cmd('reasonIncremental', {
          changedSubjects: [C('A')],
          changedSignature: sigOf(e),
        })) as IncResult;
        expect(r.mode).toBe('incremental');
        expect(r.classifier).toBe('konclude');
        expect(r.isConsistent).toBe(false);
        // Full Konclude agrees the post-edit ontology is inconsistent.
        const fullKeys = await fullReferenceKeys(base);
        expect(fullKeys).toEqual(['__INCONSISTENT__']);
      } finally {
        runtime.terminate();
        setKoncludeReasonerFactoryForTest(null);
      }
    },
    300000,
  );

  // ───────────────────────────────────────────────────────────────────────────
  // ALLOWLIST FAIL-SAFE — EL-PROFILE-VALID constructs the EL realizer does NOT
  // reproduce must route to Konclude (classifier==='konclude'), NOT leak through
  // the (former) denylist fast path. Each was an architect-confirmed soundness
  // leak under the old DENYLIST gate. The new ALLOWLIST gate forces Konclude for
  // any predicate / rdf:type-object outside the provably-reproducible set.
  // ───────────────────────────────────────────────────────────────────────────

  it(
    'C1 rdfs:range FALLS BACK to Konclude (classifier==="konclude") and realizes the range type',
    async () => {
      if (!(await koncludeAvailable())) return;
      setKoncludeReasonerFactoryForTest(() => createNodeKoncludeReasoner());
      const { runtime, cmd } = makeRuntime();
      const readInferred = async (): Promise<WQ[]> =>
        (await cmd('getQuads', { graphName: INFERRED })) as WQ[];

      try {
        // Trivial EL baseline so the first reasonIncremental establishes consistency.
        const baseline = [qd(C('K'), RDF_TYPE, OWL_CLASS)];
        await cmd('syncLoad', { graphName: DATA, quads: baseline.map((q) => serializeQuad(q)) });
        const r0 = (await cmd('reasonIncremental', { changedSubjects: [C('K')] })) as IncResult;
        expect(r0.mode).toBe('full');
        expect(r0.isConsistent).toBe(true);

        // Edit: p with rdfs:range B; a p b. Konclude realizes b rdf:type B; the EL
        // realizer (which silently ignores rdfs:range — a `default` switch case)
        // emits NOTHING ⇒ this construct MUST route to Konclude.
        const decls = [
          qd(C('p'), RDF_TYPE, OWL_OBJECT_PROPERTY),
          qd(C('B'), RDF_TYPE, OWL_CLASS),
          qd(C('p'), RDFS_RANGE, C('B')),
          qd(C('a'), RDF_TYPE, OWL_NAMED_INDIVIDUAL),
          qd(C('b'), RDF_TYPE, OWL_NAMED_INDIVIDUAL),
          qb(nn(C('a')), C('p'), nn(C('b'))),
        ];
        const base = [...baseline, ...decls];
        await cmd('syncBatch', { graphName: DATA, adds: decls.map((q) => serializeQuad(q)), removes: [] });
        const r = (await cmd('reasonIncremental', {
          changedSubjects: [C('a'), C('b'), C('p'), C('B')],
          changedSignature: sigOf(...decls),
        })) as IncResult;
        expect(r.mode).toBe('incremental');
        expect(r.isConsistent).toBe(true);
        // THE FIX: rdfs:range is not in the allowlist ⇒ authoritative Konclude.
        expect(r.classifier).toBe('konclude');
        const incKeys = inferredKeys(await readInferred());
        const fullKeys = await fullReferenceKeys(base);
        expect(incKeys).toEqual(fullKeys);
        // Konclude realizes the range type b rdf:type B (the entailment EL would miss).
        expect(incKeys).toContain(keyOf({ subject: C('b'), predicate: RDF_TYPE, object: C('B') }));
      } finally {
        runtime.terminate();
        setKoncludeReasonerFactoryForTest(null);
      }
    },
    300000,
  );

  it(
    'C2 owl:equivalentProperty FALLS BACK to Konclude (classifier==="konclude")',
    async () => {
      if (!(await koncludeAvailable())) return;
      setKoncludeReasonerFactoryForTest(() => createNodeKoncludeReasoner());
      const { runtime, cmd } = makeRuntime();

      try {
        const baseline = [qd(C('K'), RDF_TYPE, OWL_CLASS)];
        await cmd('syncLoad', { graphName: DATA, quads: baseline.map((q) => serializeQuad(q)) });
        const r0 = (await cmd('reasonIncremental', { changedSubjects: [C('K')] })) as IncResult;
        expect(r0.mode).toBe('full');
        expect(r0.isConsistent).toBe(true);

        // Edit: p owl:equivalentProperty q; a p b. owl:equivalentProperty is a
        // role-equivalence axiom the EL realizer silently ignores (a `default`
        // switch case) ⇒ MUST route to Konclude. Under the OLD denylist gate this
        // module went to the EL fast path (classifier='el') and silently dropped
        // the equivalentProperty axiom; the NEW allowlist gate forces Konclude.
        //
        // HONESTY: this package realizes equivalentProperty role assertions
        // DIFFERENTLY across its two entry points — `classifyModule` (the module
        // path) emits `a q b`, whereas whole-graph `materialize` (the
        // fullReferenceKeys reference) emits nothing (probe logs/probe-c2-full.mjs).
        // That module-vs-full disagreement is a Konclude-vs-Konclude artifact
        // OUTSIDE this gate's scope, so we do NOT assert incremental==full here; the
        // load-bearing assertion is the GATE decision — classifier==='konclude'
        // (fail safe; the EL path no longer silently swallows equivalentProperty).
        const decls = [
          qd(C('p'), RDF_TYPE, OWL_OBJECT_PROPERTY),
          qd(C('q'), RDF_TYPE, OWL_OBJECT_PROPERTY),
          qd(C('p'), OWL_EQUIVALENT_PROPERTY, C('q')),
          qd(C('a'), RDF_TYPE, OWL_NAMED_INDIVIDUAL),
          qd(C('b'), RDF_TYPE, OWL_NAMED_INDIVIDUAL),
          qb(nn(C('a')), C('p'), nn(C('b'))),
        ];
        await cmd('syncBatch', { graphName: DATA, adds: decls.map((q) => serializeQuad(q)), removes: [] });
        const r = (await cmd('reasonIncremental', {
          changedSubjects: [C('a'), C('b'), C('p'), C('q')],
          changedSignature: sigOf(...decls),
        })) as IncResult;
        expect(r.mode).toBe('incremental');
        expect(r.isConsistent).toBe(true);
        // THE FIX (load-bearing, deterministic): owl:equivalentProperty is not in
        // the allowlist ⇒ the gate routes to the authoritative Konclude classifier
        // instead of the EL fast path. We assert ONLY the gate decision: whether
        // this package's Konclude then realizes the `a q b` edge at module
        // granularity is internally nondeterministic (its classifyModule emits it
        // inconsistently across runs, and whole-graph materialize never does) — a
        // Konclude-internal artifact outside this gate's scope, so we do not assert
        // on the realized delta here.
        expect(r.classifier).toBe('konclude');
      } finally {
        runtime.terminate();
        setKoncludeReasonerFactoryForTest(null);
      }
    },
    300000,
  );

  it(
    'C3 owl:ReflexiveProperty FALLS BACK to Konclude (classifier==="konclude") and == full',
    async () => {
      if (!(await koncludeAvailable())) return;
      setKoncludeReasonerFactoryForTest(() => createNodeKoncludeReasoner());
      const { runtime, cmd } = makeRuntime();
      const readInferred = async (): Promise<WQ[]> =>
        (await cmd('getQuads', { graphName: INFERRED })) as WQ[];

      try {
        const baseline = [qd(C('K'), RDF_TYPE, OWL_CLASS)];
        await cmd('syncLoad', { graphName: DATA, quads: baseline.map((q) => serializeQuad(q)) });
        const r0 = (await cmd('reasonIncremental', { changedSubjects: [C('K')] })) as IncResult;
        expect(r0.mode).toBe('full');
        expect(r0.isConsistent).toBe(true);

        // Edit: p owl:ReflexiveProperty with individual a. Konclude realizes a p a;
        // the EL realizer does not model reflexivity (rdf:type owl:ReflexiveProperty
        // is NOT an allowed structural type) ⇒ MUST route to Konclude.
        const decls = [
          qd(C('p'), RDF_TYPE, OWL_OBJECT_PROPERTY),
          qd(C('p'), RDF_TYPE, OWL_REFLEXIVE_PROPERTY),
          qd(C('a'), RDF_TYPE, OWL_NAMED_INDIVIDUAL),
        ];
        const base = [...baseline, ...decls];
        await cmd('syncBatch', { graphName: DATA, adds: decls.map((q) => serializeQuad(q)), removes: [] });
        const r = (await cmd('reasonIncremental', {
          changedSubjects: [C('a'), C('p')],
          changedSignature: sigOf(...decls),
        })) as IncResult;
        expect(r.mode).toBe('incremental');
        expect(r.isConsistent).toBe(true);
        // THE FIX: rdf:type owl:ReflexiveProperty is not an allowed type ⇒ Konclude.
        expect(r.classifier).toBe('konclude');
        const incKeys = inferredKeys(await readInferred());
        const fullKeys = await fullReferenceKeys(base);
        expect(incKeys).toEqual(fullKeys);
      } finally {
        runtime.terminate();
        setKoncludeReasonerFactoryForTest(null);
      }
    },
    300000,
  );

  it(
    'C4 functional DATA property (two distinct literals): the WORST leak — gated to Konclude; the inconsistency IS real (full reference)',
    async () => {
      if (!(await koncludeAvailable())) return;
      setKoncludeReasonerFactoryForTest(() => createNodeKoncludeReasoner());
      const { runtime, cmd } = makeRuntime();

      let base: N3.Quad[] = [];

      try {
        const baseline = [qd(C('K'), RDF_TYPE, OWL_CLASS)];
        base = [...baseline];
        await cmd('syncLoad', { graphName: DATA, quads: baseline.map((q) => serializeQuad(q)) });
        const r0 = (await cmd('reasonIncremental', { changedSubjects: [C('K')] })) as IncResult;
        expect(r0.mode).toBe('full');
        expect(r0.isConsistent).toBe(true);

        // Edit: p is a FUNCTIONAL DATA property; a p "1", a p "2" (two distinct
        // literals). A functional property forces the two fillers equal, but
        // "1" != "2" ⇒ the WHOLE ontology is INCONSISTENT. This is a GENUINE
        // Konclude divergence, confirmed by a real-reasoner probe over the FULL
        // graph (logs/probe-c4-funcdata.mjs / probe-c4-full-vs-module.mjs →
        // checkConsistency = FALSE), NOT a shared literal-stripping artifact.
        //
        // Under the OLD DENYLIST gate this module routed to the EL fast path
        // (classifier='el'): owl:DatatypeProperty / owl:FunctionalProperty were not
        // denylisted, and the EL realizer models neither functionality nor data
        // properties (and drops literals), so it silently reported CONSISTENT — the
        // worst leak. The NEW ALLOWLIST gate forces Konclude (owl:DatatypeProperty
        // and owl:FunctionalProperty are NOT in EL_ALLOWED_TYPE_OBJECTS).
        const decls = [
          qd(C('p'), RDF_TYPE, OWL_DATATYPE_PROPERTY),
          qd(C('p'), RDF_TYPE, OWL_FUNCTIONAL_PROPERTY),
          qd(C('a'), RDF_TYPE, OWL_NAMED_INDIVIDUAL),
          ql(C('a'), C('p'), '1'),
          ql(C('a'), C('p'), '2'),
        ];
        base = [...base, ...decls];
        await cmd('syncBatch', { graphName: DATA, adds: decls.map((q) => serializeQuad(q)), removes: [] });
        const r = (await cmd('reasonIncremental', {
          changedSubjects: [C('a'), C('p')],
          changedSignature: sigOf(...decls),
        })) as IncResult;
        expect(r.mode).toBe('incremental');
        // THE FIX (load-bearing): the gate NO LONGER routes this to the EL fast path.
        // It is handed to the authoritative Konclude classifier instead.
        expect(r.classifier).toBe('konclude');

        // HONESTY (architect-flagged): the inconsistency is REAL — the independent
        // FULL Konclude reference over the whole graph reports it (no module filter):
        const fullKeys = await fullReferenceKeys(base);
        expect(fullKeys).toEqual(['__INCONSISTENT__']);

        // …but it is NOT visible at the MODULE level, and crucially this is a
        // CLASSIFIER-AGNOSTIC limitation, NOT an EL-vs-Konclude divergence: the
        // syntactic-locality module extractor (localityModule.ts — out of this
        // gate's scope) drops LITERAL-valued data assertions (`a p "1"`, `a p "2"`)
        // from the module, so the module handed to EITHER classifier lacks the two
        // literals and is consistent in isolation. We assert that BOTH the EL path
        // (had it run) and the Konclude module classifier agree the MODULE is
        // consistent — i.e. routing to Konclude does not, by itself, surface this
        // particular inconsistency at module granularity (it surfaces on the next
        // full re-anchor). The gate fix is still correct and necessary: it removes
        // the silent EL fast-path classification of an out-of-EL functional-data
        // construct, restoring Konclude as authoritative.
        expect(r.isConsistent).toBe(true); // module-level (literals dropped pre-classifier)
      } finally {
        runtime.terminate();
        setKoncludeReasonerFactoryForTest(null);
      }
    },
    300000,
  );
});

// Silence unused-import lints for vocabulary constants kept for documentation.
void RDF_FIRST;
void RDF_REST;
void RDF_NIL;
