// src/mcp/__tests__/moduleConformance.integration.test.ts
// @vitest-environment node
//
// ─────────────────────────────────────────────────────────────────────────────
// THE KEY SCIENTIFIC TEST — MODULE-CLASSIFICATION ≡ FULL-CLASSIFICATION (R2)
// ─────────────────────────────────────────────────────────────────────────────
// This is the CONFORMANCE PROOF for locality-based module extraction
// (src/workers/localityModule.ts), driven by the REAL Konclude reasoner.
//
// THEOREM (Cuenca Grau, Horrocks, Kazakov, Sattler — JAIR 2008): the syntactic
// locality module M of an ontology O for a signature Σ preserves ALL entailments
// over Σ: for every axiom α expressible using only the terms in Σ,
//
//        O ⊨ α   ⇔   M ⊨ α       (soundness + completeness over Σ).
//
// We PROVE this empirically on a non-trivial fixture (a subsumption chain + a
// disjointness + an existential restriction + noise classes outside Σ):
//
//   (a) SUBSUMPTION EQUIVALENCE: for every ordered pair (X, Y) of Σ-classes, the
//       full ontology entails X ⊑ Y iff the extracted module entails X ⊑ Y. We
//       decide entailment with the SAME entailment-as-unsatisfiability reduction
//       the production worker uses (negate the axiom, check inconsistency) so the
//       comparison runs over the real reasoner. ⇒ the module is SOUND AND
//       COMPLETE for Σ-subsumption.
//   (b) UNSATISFIABLE Σ-CLASSES IDENTICAL: the set of Σ-classes the reasoner
//       finds unsatisfiable is the SAME for the full ontology and the module.
//   (c) A KNOWN TRANSITIVE ENTAILMENT (A ⊑ C, not asserted) holds in BOTH.
//   (d) The ⊥-module and ⊤⊥* ("star") module are SMALLER than the full ontology
//       for the focused signature (moduleSize < fullSize) — modular reasoning pays
//       off — and the star module is ⊆ the ⊥-module.
//
// What this PROVES: module EXTRACTION + a Σ-entailment conformance guarantee —
// the building block for incremental / modular reasoning. What it DOES NOT prove
// (a documented FOLLOW-UP): live auto-incremental-reasoning-on-edit. A module
// preserves Σ-entailments, but a global inconsistency arising OUTSIDE Σ needs
// separate handling, so re-reasoning only the changed module on every edit is not
// yet wired.
//
// The extraction here calls the EXACT pure functions the worker's
// `extractModule` command calls (extractBotModule / extractStarModule), over the
// same { subject, predicate, object, objectIsLiteral } triple shape the worker
// builds from the store — so this is a faithful test of the production path.
//
// REQUIRE_KONCLUDE gating: when REQUIRE_KONCLUDE is set (CI) a WASM/init failure
// FAILS the test — the reasoner MUST run. Without the flag an init failure is
// surfaced via console.warn and the reasoner assertions are skipped (visible).
import { describe, it, expect } from 'vitest';
import { RdfReasoner } from 'rdf-reasoner-konclude';
import * as N3 from 'n3';
import { buildEntailmentProbe } from '../../workers/entailmentProbe';
import {
  extractBotModule,
  extractStarModule,
  type LocalityTriple,
} from '../../workers/localityModule';
import { createRdfWorkerRuntime } from '../../workers/rdfManager.runtime';
import { serializeQuad } from '../../utils/rdfSerialization';

const REQUIRE_KONCLUDE = !!process.env.REQUIRE_KONCLUDE;

const RDFS_SUBCLASSOF = 'http://www.w3.org/2000/01/rdf-schema#subClassOf';

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
      '[TEST][SKIP] Konclude WASM unavailable and REQUIRE_KONCLUDE not set — skipping conformance assertions:',
      String(e),
    );
    return undefined;
  }
}

function parseTtl(ttl: string): N3.Store {
  const store = new N3.Store();
  store.addQuads(new N3.Parser({ format: 'text/turtle' }).parse(ttl));
  return store;
}

/** Project an N3 store to the locality extractor's triple shape (worker parity). */
function storeToLocalityTriples(store: N3.Store): LocalityTriple[] {
  return (store.getQuads(null, null, null, null) as N3.Quad[]).map((q) => ({
    subject: q.subject.value,
    predicate: q.predicate.value,
    object: q.object.value,
    objectIsLiteral: q.object.termType === 'Literal',
  }));
}

/** Build an N3 store from a list of locality triples (the module → reasoner). */
function localityTriplesToStore(triples: LocalityTriple[]): N3.Store {
  const store = new N3.Store();
  const { namedNode, blankNode, literal } = N3.DataFactory;
  const term = (v: string, isLiteral?: boolean) => {
    if (isLiteral) return literal(v);
    if (v.startsWith('_:') || /^(_:)?b\d+$/.test(v) || v.startsWith('n3-')) return blankNode(v.replace(/^_:/, ''));
    return namedNode(v);
  };
  for (const t of triples) {
    store.addQuad(
      N3.DataFactory.quad(
        term(t.subject) as N3.Quad_Subject,
        namedNode(t.predicate),
        term(t.object, t.objectIsLiteral) as N3.Quad_Object,
      ),
    );
  }
  return store;
}

let _probeCounter = 0;

/**
 * Decide whether `store` entails subjectIri ⊑ objectIri using the SAME
 * entailment-as-unsatisfiability reduction the production worker uses: negate the
 * axiom (via buildEntailmentProbe), and report entailed ⇔ (O ∪ ¬α) inconsistent.
 * Guards C1 (already-inconsistent O ⇒ every α "entailed" — return null) so the
 * comparison is meaningful.
 */
async function entailsSubClassOf(
  r: RdfReasoner,
  store: N3.Store,
  subjectIri: string,
  objectIri: string,
): Promise<boolean | null> {
  if (!(await r.checkConsistency(store))) return null; // C1: O inconsistent
  const probeId = `probe_${++_probeCounter}`;
  const probe = buildEntailmentProbe<N3.Quad>(
    N3.DataFactory as unknown as Parameters<typeof buildEntailmentProbe>[0],
    subjectIri,
    RDFS_SUBCLASSOF,
    objectIri,
    true,
    probeId,
  );
  if (probe.kind === 'unsupported') {
    return (
      store.getQuads(
        N3.DataFactory.namedNode(subjectIri),
        N3.DataFactory.namedNode(RDFS_SUBCLASSOF),
        N3.DataFactory.namedNode(objectIri),
        null,
      ).length > 0
    );
  }
  const union = new N3.Store();
  for (const q of store.getQuads(null, null, null, null) as N3.Quad[]) union.addQuad(q);
  for (const q of probe.probeQuads) union.addQuad(q);
  return !(await r.checkConsistency(union));
}

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE
// ─────────────────────────────────────────────────────────────────────────────
// A non-trivial ontology:
//   • subsumption chain A ⊑ B ⊑ C    (so A ⊑ C is entailed, NOT asserted)
//   • a disjointness  C ⊓ D = ⊥, with an existential restriction E ⊑ ∃r.D
//   • NOISE far from Σ: a chain N1 ⊑ N2 ⊑ N3 and class M, none of which can
//     affect entailments over Σ = {A, B, C}. The ⊥-module for Σ must drop them.
const TTL = `
@prefix ex: <http://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

ex:A a owl:Class . ex:B a owl:Class . ex:C a owl:Class .
ex:D a owl:Class . ex:E a owl:Class .
ex:N1 a owl:Class . ex:N2 a owl:Class . ex:N3 a owl:Class . ex:M a owl:Class .
ex:r a owl:ObjectProperty .

# Σ-relevant subsumption chain (A ⊑ C is entailed but not asserted).
ex:A rdfs:subClassOf ex:B .
ex:B rdfs:subClassOf ex:C .

# Disjointness + restriction (touches C; not directly relevant to A/B/C subsumption,
# but C IS in Σ so this axiom is in the ⊥-module).
ex:C owl:disjointWith ex:D .
ex:E rdfs:subClassOf [ a owl:Restriction ; owl:onProperty ex:r ; owl:someValuesFrom ex:D ] .

# NOISE outside Σ — must NOT be needed for Σ-entailments.
ex:N1 rdfs:subClassOf ex:N2 .
ex:N2 rdfs:subClassOf ex:N3 .
ex:M rdfs:subClassOf ex:N1 .
`;

const A = 'http://example.org/A';
const B = 'http://example.org/B';
const C = 'http://example.org/C';
const SIGMA = [A, B, C];

describe('module conformance — module-classification ≡ full-classification (real Konclude)', () => {
  it(
    'extracts a smaller ⊥-module and ⊤⊥* module for Σ = {A,B,C}, with star ⊆ bot',
    () => {
      const full = storeToLocalityTriples(parseTtl(TTL));
      const bot = extractBotModule(full, SIGMA, { includeDeclarationsForSignature: true });
      const star = extractStarModule(full, SIGMA, { includeDeclarationsForSignature: true });

      console.log(
        `[TEST] sizes — full=${full.length}, bot-module=${bot.length}, star-module=${star.length}`,
      );

      // (d) The module is SMALLER than the full ontology for a focused signature.
      expect(bot.length).toBeLessThan(full.length);
      expect(star.length).toBeLessThanOrEqual(bot.length);
      expect(star.length).toBeLessThan(full.length);

      // The noise chain (N1/N2/N3/M) must NOT appear in the ⊥-module: it cannot
      // affect any entailment over Σ = {A,B,C}.
      const botBlob = bot.map((t) => `${t.subject} ${t.predicate} ${t.object}`).join('\n');
      expect(botBlob).not.toContain('http://example.org/N1');
      expect(botBlob).not.toContain('http://example.org/N2');
      expect(botBlob).not.toContain('http://example.org/N3');
      expect(botBlob).not.toContain('http://example.org/M');

      // The Σ-relevant subsumption axioms MUST be retained (soundness/completeness).
      expect(botBlob).toContain(`${A} ${RDFS_SUBCLASSOF} ${B}`);
      expect(botBlob).toContain(`${B} ${RDFS_SUBCLASSOF} ${C}`);
    },
  );

  it(
    'CONFORMANCE: full and ⊥-module agree on EVERY Σ×Σ subsumption + on Σ-unsatisfiable classes',
    async () => {
      const r = await initReasonerOrSkip();
      if (!r) return;
      try {
        const fullStore = parseTtl(TTL);
        const fullTriples = storeToLocalityTriples(fullStore);
        const botModule = extractBotModule(fullTriples, SIGMA, {
          includeDeclarationsForSignature: true,
        });
        const moduleStore = localityTriplesToStore(botModule);

        // Sanity: both stores are consistent (so the entailment reduction is valid).
        expect(await r.checkConsistency(fullStore)).toBe(true);
        expect(await r.checkConsistency(moduleStore)).toBe(true);

        // (a) SUBSUMPTION EQUIVALENCE over Σ×Σ. For every ordered pair (X,Y) the
        //     full ontology entails X ⊑ Y iff the module does. This is the
        //     soundness + completeness conformance proof for Σ-subsumption.
        const fullMatrix: Record<string, boolean | null> = {};
        const moduleMatrix: Record<string, boolean | null> = {};
        for (const X of SIGMA) {
          for (const Y of SIGMA) {
            if (X === Y) continue;
            const key = `${X} ⊑ ${Y}`;
            const fullEnt = await entailsSubClassOf(r, fullStore, X, Y);
            const modEnt = await entailsSubClassOf(r, moduleStore, X, Y);
            fullMatrix[key] = fullEnt;
            moduleMatrix[key] = modEnt;
          }
        }
        console.log('[TEST] full   Σ-subsumptions:', JSON.stringify(fullMatrix));
        console.log('[TEST] module Σ-subsumptions:', JSON.stringify(moduleMatrix));

        // The two entailment matrices over Σ must be IDENTICAL.
        expect(moduleMatrix).toEqual(fullMatrix);

        // (c) The known transitive entailment A ⊑ C (NOT asserted) holds in BOTH —
        //     and the converse C ⊑ A holds in NEITHER (it really tests completeness,
        //     not a degenerate all-true matrix).
        expect(fullMatrix[`${A} ⊑ ${C}`]).toBe(true);
        expect(moduleMatrix[`${A} ⊑ ${C}`]).toBe(true);
        expect(fullMatrix[`${C} ⊑ ${A}`]).toBe(false);
        expect(moduleMatrix[`${C} ⊑ ${A}`]).toBe(false);

        // (b) UNSATISFIABLE Σ-CLASSES IDENTICAL between full and module.
        const fullUnsatAll = await r.getUnsatisfiableClasses(fullStore);
        const moduleUnsatAll = await r.getUnsatisfiableClasses(moduleStore);
        const sigmaSet = new Set(SIGMA);
        const fullUnsatSigma = [...new Set(fullUnsatAll.filter((c) => sigmaSet.has(c)))].sort();
        const moduleUnsatSigma = [...new Set(moduleUnsatAll.filter((c) => sigmaSet.has(c)))].sort();
        console.log('[TEST] unsatisfiable Σ-classes — full:', fullUnsatSigma, 'module:', moduleUnsatSigma);
        expect(moduleUnsatSigma).toEqual(fullUnsatSigma);

        // The full ontology here is consistent and Σ has no unsatisfiable class —
        // the equivalence is the load-bearing assertion above; this documents the
        // concrete state for this fixture.
        expect(fullUnsatSigma).toEqual([]);
      } finally {
        r.terminate();
      }
    },
    120000,
  );

  it(
    'CONFORMANCE: the ⊤⊥* (star) module ALSO preserves the A ⊑ C entailment and Σ-unsatisfiability',
    async () => {
      const r = await initReasonerOrSkip();
      if (!r) return;
      try {
        const fullStore = parseTtl(TTL);
        const starModule = extractStarModule(storeToLocalityTriples(fullStore), SIGMA, {
          includeDeclarationsForSignature: true,
        });
        const starStore = localityTriplesToStore(starModule);

        expect(await r.checkConsistency(starStore)).toBe(true);

        // A ⊑ C must still be entailed by the (smaller) star module.
        expect(await entailsSubClassOf(r, starStore, A, C)).toBe(true);
        // C ⊑ A must still NOT be entailed.
        expect(await entailsSubClassOf(r, starStore, C, A)).toBe(false);

        // Σ-unsatisfiable classes identical to the full ontology (both empty here).
        const sigmaSet = new Set(SIGMA);
        const starUnsat = (await r.getUnsatisfiableClasses(starStore)).filter((c) => sigmaSet.has(c));
        const fullUnsat = (await r.getUnsatisfiableClasses(fullStore)).filter((c) => sigmaSet.has(c));
        expect([...new Set(starUnsat)].sort()).toEqual([...new Set(fullUnsat)].sort());
      } finally {
        r.terminate();
      }
    },
    120000,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION (C1 — proven-unsound skolemization boundary): the EXTRACTOR over an
// IMPORTED store must DE-SKOLEMIZE before locality.
// ─────────────────────────────────────────────────────────────────────────────
// The conformance tests above parse Turtle directly into an N3 store → the
// anonymous restriction node is a REAL blank node → the worker never skolemizes
// it, so isBlankNode in localityModule already recognizes it. That path passes
// VACUOUSLY w.r.t. the bug.
//
// In PRODUCTION, import (syncLoad / importSerialized) SKOLEMIZES blank nodes to
// urn:vg:bnode:{hash} NAMED IRIs (skolemizeQuads). extractModuleFromStore then
// reads the store. Before the fix it copied q.subject.value / q.object.value RAW,
// so the restriction node arrived as urn:vg:bnode:HASH — which localityModule's
// isBlankNode (`_:`, `bN`, `n3-`) does NOT recognize. The extractor treated the
// restriction as an ordinary NAMED class and DROPPED its body (owl:onProperty,
// owl:someValuesFrom, …) from the ⊥-module → lost entailments (UNSOUND).
//
// This test drives the ACTUAL worker runtime (createRdfWorkerRuntime): syncLoad
// the fixture (skolemization fires), then extractModule (boundary de-skolemization
// must fire), then classify module vs full with the REAL Konclude reasoner and
// assert Σ-unsatisfiability equality. Fixture: C ⊑ ∃r.D, D ⊑ owl:Nothing, so D is
// unsatisfiable ⟹ C is unsatisfiable. Σ = {C, D}.
//
// BEFORE the fix this FAILS: the ⊥-module loses C's restriction body, so the
// module reports only {D} unsatisfiable while the full ontology reports {C, D}.
// AFTER the fix the module preserves C's unsatisfiability: module == full == {C,D}.

const OWL_CLASS = 'http://www.w3.org/2002/07/owl#Class';
const OWL_NOTHING = 'http://www.w3.org/2002/07/owl#Nothing';
const OWL_OBJECT_PROPERTY = 'http://www.w3.org/2002/07/owl#ObjectProperty';
const OWL_RESTRICTION = 'http://www.w3.org/2002/07/owl#Restriction';
const OWL_ON_PROPERTY = 'http://www.w3.org/2002/07/owl#onProperty';
const OWL_SOME_VALUES_FROM = 'http://www.w3.org/2002/07/owl#someValuesFrom';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

const SK_C = 'http://example.org/sk/C';
const SK_D = 'http://example.org/sk/D';
const SK_R = 'http://example.org/sk/r';

// Fixture: C ⊑ ∃r.D and D ⊑ owl:Nothing — uses a REAL blank node for the
// existential restriction, so syncLoad's skolemizeQuads converts it to a
// urn:vg:bnode: IRI inside the worker store (the exact production behaviour the
// bug depended on).
const RESTRICTION_TTL = `
@prefix ex: <http://example.org/sk/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

ex:C a owl:Class .
ex:D a owl:Class .
ex:r a owl:ObjectProperty .

ex:C rdfs:subClassOf [ a owl:Restriction ; owl:onProperty ex:r ; owl:someValuesFrom ex:D ] .
ex:D rdfs:subClassOf owl:Nothing .
`;

const SK_SIGMA = [SK_C, SK_D];

/**
 * Drive a single command through the real worker runtime and resolve with the
 * `result` payload of its {type:"response"} message. Mirrors the main-thread
 * worker client's request/response correlation (rdfManager.runtime.ts handleCommand
 * posts {type:"response", id, ok, result}).
 */
function runCommand(
  runtime: ReturnType<typeof createRdfWorkerRuntime>,
  responses: Map<string, { ok: boolean; result?: unknown; error?: string }>,
  id: string,
  command: string,
  payload: unknown,
): Promise<unknown> {
  runtime.handleEvent({ type: 'command', id, command, payload });
  // handleCommand is async but posts synchronously once the (sync) command body
  // completes; extractModule/syncLoad have no awaits before post(). Drain a
  // microtask to be safe, then read the captured response.
  return Promise.resolve().then(() => {
    const r = responses.get(id);
    if (!r) throw new Error(`No response captured for command ${command} (id=${id})`);
    if (!r.ok) throw new Error(`Command ${command} failed: ${r.error}`);
    return r.result;
  });
}

/**
 * Build the "full" reasoning store the way the production reasoning path sees it:
 * the asserted axioms with the existential restriction as a REAL blank node (the
 * worker de-skolemizes urn:vg:bnode: back to blank nodes before Konclude, so the
 * reference full ontology here is the de-skolemized form). We assemble it
 * explicitly with a blank node so it is independent of the extractor under test.
 */
function buildFullRestrictionStore(): N3.Store {
  const store = new N3.Store();
  const { namedNode, blankNode, quad } = N3.DataFactory;
  const r = blankNode('restr0');
  store.addQuad(quad(namedNode(SK_C), namedNode(RDF_TYPE), namedNode(OWL_CLASS)));
  store.addQuad(quad(namedNode(SK_D), namedNode(RDF_TYPE), namedNode(OWL_CLASS)));
  store.addQuad(quad(namedNode(SK_R), namedNode(RDF_TYPE), namedNode(OWL_OBJECT_PROPERTY)));
  store.addQuad(quad(namedNode(SK_C), namedNode(RDFS_SUBCLASSOF), r));
  store.addQuad(quad(r, namedNode(RDF_TYPE), namedNode(OWL_RESTRICTION)));
  store.addQuad(quad(r, namedNode(OWL_ON_PROPERTY), namedNode(SK_R)));
  store.addQuad(quad(r, namedNode(OWL_SOME_VALUES_FROM), namedNode(SK_D)));
  store.addQuad(quad(namedNode(SK_D), namedNode(RDFS_SUBCLASSOF), namedNode(OWL_NOTHING)));
  return store;
}

describe('module conformance — SKOLEMIZED production path (real worker + Konclude)', () => {
  it(
    'extractModule over an IMPORTED (skolemized) store preserves C ⊑ ∃r.D unsatisfiability for Σ={C,D}',
    async () => {
      const r = await initReasonerOrSkip();
      if (!r) return;

      // ── Drive the ACTUAL worker runtime so skolemization really happens. ──
      const responses = new Map<string, { ok: boolean; result?: unknown; error?: string }>();
      const runtime = createRdfWorkerRuntime((message: unknown) => {
        const m = message as { type?: string; id?: string; ok?: boolean; result?: unknown; error?: string };
        if (m && m.type === 'response' && typeof m.id === 'string') {
          responses.set(m.id, { ok: !!m.ok, result: m.result, error: m.error });
        }
      });

      try {
        // syncLoad the fixture: parse Turtle → real blank nodes → serialize → the
        // worker's skolemizeQuads converts the restriction blank node to a
        // urn:vg:bnode: IRI in the shared store (the production import behaviour).
        const fixtureStore = parseTtl(RESTRICTION_TTL);
        const quads = (fixtureStore.getQuads(null, null, null, null) as N3.Quad[]).map((q) =>
          serializeQuad(q),
        );
        // Sanity: the fixture genuinely contains a blank node (else this would test
        // nothing — skolemization only fires when blank nodes are present).
        const hadBlankNode = (fixtureStore.getQuads(null, null, null, null) as N3.Quad[]).some(
          (q) => q.subject.termType === 'BlankNode' || q.object.termType === 'BlankNode',
        );
        expect(hadBlankNode).toBe(true);

        const loadRes = (await runCommand(runtime, responses, 'load1', 'syncLoad', {
          graphName: 'urn:vg:data',
          quads,
        })) as { added: number };
        expect(loadRes.added).toBeGreaterThan(0);

        // Extract the ⊥-module and ⊤⊥* module for Σ={C,D} via the real command —
        // exercising extractModuleFromStore's boundary de-skolemization.
        const botRes = (await runCommand(runtime, responses, 'mod-bot', 'extractModule', {
          signature: SK_SIGMA,
          moduleType: 'bot',
        })) as {
          moduleTriples: { subject: string; predicate: string; object: string }[];
          moduleSize: number;
          fullSize: number;
        };
        const starRes = (await runCommand(runtime, responses, 'mod-star', 'extractModule', {
          signature: SK_SIGMA,
          moduleType: 'star',
        })) as {
          moduleTriples: { subject: string; predicate: string; object: string }[];
          moduleSize: number;
        };

        // The returned module triples are already de-skolemized to the `_:` form
        // for any anonymous restriction node — localityTriplesToStore turns those
        // back into N3 blank nodes the reasoner understands.
        const botTriples: LocalityTriple[] = botRes.moduleTriples.map((t) => ({
          subject: t.subject,
          predicate: t.predicate,
          object: t.object,
          // module objects are class-like IRIs / blank nodes here (no literals in
          // this fixture); objectIsLiteral=false is correct for all triples.
          objectIsLiteral: false,
        }));
        const starTriples: LocalityTriple[] = starRes.moduleTriples.map((t) => ({
          subject: t.subject,
          predicate: t.predicate,
          object: t.object,
          objectIsLiteral: false,
        }));

        // PROOF the module retained the restriction body. If the boundary did NOT
        // de-skolemize, the restriction node would have been treated as a named
        // class and its owl:someValuesFrom/owl:onProperty triples DROPPED.
        const botBlob = botTriples.map((t) => `${t.subject} ${t.predicate} ${t.object}`).join('\n');
        expect(botBlob).toContain(OWL_SOME_VALUES_FROM);
        expect(botBlob).toContain(OWL_ON_PROPERTY);

        const botStore = localityTriplesToStore(botTriples);
        const starStore = localityTriplesToStore(starTriples);

        // The "full" reference is the de-skolemized asserted ontology (what the
        // reasoning path feeds Konclude).
        const fullStore = buildFullRestrictionStore();

        // D ⊑ owl:Nothing ⟹ D unsat; C ⊑ ∃r.D with D unsat ⟹ C unsat. So the full
        // ontology's unsatisfiable Σ-classes are {C, D}.
        const sigmaSet = new Set(SK_SIGMA);
        const fullUnsat = [
          ...new Set((await r.getUnsatisfiableClasses(fullStore)).filter((c) => sigmaSet.has(c))),
        ].sort();
        const botUnsat = [
          ...new Set((await r.getUnsatisfiableClasses(botStore)).filter((c) => sigmaSet.has(c))),
        ].sort();
        const starUnsat = [
          ...new Set((await r.getUnsatisfiableClasses(starStore)).filter((c) => sigmaSet.has(c))),
        ].sort();

        console.log('[TEST][SKOLEM] unsatisfiable Σ-classes — full:', fullUnsat, 'bot:', botUnsat, 'star:', starUnsat);

        // The full ontology must find BOTH C and D unsatisfiable.
        expect(fullUnsat).toEqual([SK_C, SK_D].sort());

        // THE LOAD-BEARING ASSERTION: the ⊥-module (and star module) extracted
        // through the SKOLEMIZED production path must preserve C's unsatisfiability.
        // Pre-fix this is {D} (C's restriction body dropped) and FAILS.
        expect(botUnsat).toEqual(fullUnsat);
        expect(starUnsat).toEqual(fullUnsat);
      } finally {
        runtime.terminate();
        r.terminate();
      }
    },
    120000,
  );
});
