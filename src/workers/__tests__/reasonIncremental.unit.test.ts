// src/workers/__tests__/reasonIncremental.unit.test.ts
// @vitest-environment node
//
// Unit tests for the auto-incremental reasoning Σ_Δ computation and the
// baseline / fallback LOGIC — independent of a running Konclude reasoner.
//
// Two layers:
//   1. PURE: the Σ_Δ derivation (changed subjects → conservative neighbour
//      expansion) and the ⊤⊥*-module it induces, asserted directly against
//      extractStarModule / signatureOf (the exact functions the worker calls).
//   2. RUNTIME: drive the ACTUAL worker runtime's `reasonIncremental` command in
//      node (where Konclude's SharedArrayBuffer is unavailable). With NO baseline
//      and after a BULK LOAD, the worker MUST FALL BACK to a full run — asserted
//      via the returned `mode:'full'`. This proves the precondition/fallback path
//      end-to-end without needing the WASM reasoner.
import { describe, it, expect } from 'vitest';
import * as N3 from 'n3';
import {
  extractStarModule,
  signatureOf,
  type LocalityTriple,
} from '../localityModule';
import { createRdfWorkerRuntime } from '../rdfManager.runtime';
import { serializeQuad } from '../../utils/rdfSerialization';

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const RDFS_SUBCLASS_OF = 'http://www.w3.org/2000/01/rdf-schema#subClassOf';
const OWL_CLASS = 'http://www.w3.org/2002/07/owl#Class';
const EX = 'http://example.org/u/';
const C = (n: string) => `${EX}${n}`;

/**
 * The worker's Σ_Δ derivation, reproduced for direct assertion. Mirrors
 * rdfManager.runtime.computeChangedSignature(base, changedSubjects, changedSignature):
 * the explicit changedSignature terms (subject + PREDICATE + OBJECT of every
 * added/removed axiom, the C2 plumbing) seed Σ_Δ directly, BEFORE the
 * changed-subject neighbour expansion.
 */
function computeChangedSignature(
  base: LocalityTriple[],
  changedSubjects: string[],
  changedSignature: string[] = [],
): Set<string> {
  const sigma = new Set<string>();
  for (const s of changedSignature) if (s) sigma.add(s);
  const seeds = new Set(changedSubjects.filter(Boolean));
  for (const s of seeds) sigma.add(s);
  if (seeds.size === 0) return sigma;
  // Batched signatureOf over the matching neighbour triples (one index build) —
  // identical to per-triple signatureOf([t]) because signatureOf harvests each
  // triple independently. Mirrors the runtime's Finding-3 implementation.
  const neighbours: LocalityTriple[] = [];
  for (const t of base) {
    if (seeds.has(t.subject) || (!t.objectIsLiteral && seeds.has(t.object))) {
      neighbours.push(t);
    }
  }
  if (neighbours.length > 0) {
    for (const sym of signatureOf(neighbours)) sigma.add(sym);
  }
  return sigma;
}

const BASE: LocalityTriple[] = [
  { subject: C('A'), predicate: RDF_TYPE, object: OWL_CLASS },
  { subject: C('B'), predicate: RDF_TYPE, object: OWL_CLASS },
  { subject: C('C'), predicate: RDF_TYPE, object: OWL_CLASS },
  { subject: C('X'), predicate: RDF_TYPE, object: OWL_CLASS },
  { subject: C('Y'), predicate: RDF_TYPE, object: OWL_CLASS },
  { subject: C('A'), predicate: RDFS_SUBCLASS_OF, object: C('B') },
  { subject: C('B'), predicate: RDFS_SUBCLASS_OF, object: C('C') },
  // A far, independent pair X ⊑ Y.
  { subject: C('X'), predicate: RDFS_SUBCLASS_OF, object: C('Y') },
];

describe('reasonIncremental — Σ_Δ computation (pure)', () => {
  it('empty changed subjects ⇒ empty Σ_Δ (worker then falls back to full)', () => {
    expect(computeChangedSignature(BASE, []).size).toBe(0);
  });

  it('a changed subject expands Σ_Δ to its directly-referenced neighbours', () => {
    const sigma = computeChangedSignature(BASE, [C('B')]);
    // B's axioms: A ⊑ B and B ⊑ C → Σ_Δ ⊇ {A, B, C}.
    expect(sigma.has(C('A'))).toBe(true);
    expect(sigma.has(C('B'))).toBe(true);
    expect(sigma.has(C('C'))).toBe(true);
    // The far pair X/Y is NOT pulled in by editing B.
    expect(sigma.has(C('X'))).toBe(false);
    expect(sigma.has(C('Y'))).toBe(false);
  });

  it('C2: changedSignature seeds Σ_Δ with the predicate + object of a changed axiom', () => {
    const RDFS_SUBPROPERTY_OF = 'http://www.w3.org/2000/01/rdf-schema#subPropertyOf';
    // A predicate-position retraction of `p ⊑ q` reports changedSubjects=[p] but
    // ALSO changedSignature=[p, subPropertyOf, q]. Σ_Δ MUST carry q (the property
    // object) — not just the subject p — so the module covers q's assertions and
    // the splice can purge entailments q backed. This is the C2 fix: without the
    // explicit signature, q would be invisible to Σ_Δ.
    const sigma = computeChangedSignature(BASE, [C('B')], [C('p'), RDFS_SUBPROPERTY_OF, C('q')]);
    expect(sigma.has(C('p'))).toBe(true);
    expect(sigma.has(C('q'))).toBe(true);
    expect(sigma.has(RDFS_SUBPROPERTY_OF)).toBe(true);
    // The subject-neighbour expansion still applies on top of the explicit signature.
    expect(sigma.has(C('A'))).toBe(true);
    expect(sigma.has(C('C'))).toBe(true);
  });

  it('the ⊤⊥*-module for a focused Σ_Δ excludes the far, unrelated axioms', () => {
    const sigma = computeChangedSignature(BASE, [C('B')]);
    const moduleTriples = extractStarModule(BASE, [...sigma], {
      includeDeclarationsForSignature: true,
    });
    const blob = moduleTriples.map((t) => `${t.subject} ${t.predicate} ${t.object}`).join('\n');
    // The A/B/C subsumption axioms are retained.
    expect(blob).toContain(`${C('A')} ${RDFS_SUBCLASS_OF} ${C('B')}`);
    expect(blob).toContain(`${C('B')} ${RDFS_SUBCLASS_OF} ${C('C')}`);
    // The far X ⊑ Y axiom is dropped (locality) — module smaller than full.
    expect(blob).not.toContain(`${C('X')} ${RDFS_SUBCLASS_OF} ${C('Y')}`);
    expect(moduleTriples.length).toBeLessThan(BASE.length);
  });
});

/** Drive a runtime command and await its captured response (handles async). */
async function runCommand(
  runtime: ReturnType<typeof createRdfWorkerRuntime>,
  responses: Map<string, { ok: boolean; result?: unknown; error?: string }>,
  id: string,
  command: string,
  payload: unknown,
): Promise<unknown> {
  runtime.handleEvent({ type: 'command', id, command, payload });
  // reasonIncremental / runReasoning are async; poll for the response.
  for (let i = 0; i < 200; i++) {
    const r = responses.get(id);
    if (r) {
      if (!r.ok) throw new Error(`Command ${command} failed: ${r.error}`);
      return r.result;
    }
    await new Promise((res) => setTimeout(res, 25));
  }
  throw new Error(`No response captured for command ${command} (id=${id})`);
}

describe('reasonIncremental — baseline / fallback logic (real worker runtime, node)', () => {
  it(
    'NO baseline ⇒ reasonIncremental falls back to a FULL run (mode:"full")',
    async () => {
      const responses = new Map<string, { ok: boolean; result?: unknown; error?: string }>();
      const runtime = createRdfWorkerRuntime((message: unknown) => {
        const m = message as { type?: string; id?: string; ok?: boolean; result?: unknown; error?: string };
        if (m && m.type === 'response' && typeof m.id === 'string') {
          responses.set(m.id, { ok: !!m.ok, result: m.result, error: m.error });
        }
      });
      try {
        // Load a small graph (this ALSO invalidates any baseline → forces full).
        const store = new N3.Store(
          [
            [C('A'), RDF_TYPE, OWL_CLASS],
            [C('B'), RDF_TYPE, OWL_CLASS],
            [C('A'), RDFS_SUBCLASS_OF, C('B')],
          ].map(([s, p, o]) =>
            N3.DataFactory.quad(N3.DataFactory.namedNode(s), N3.DataFactory.namedNode(p), N3.DataFactory.namedNode(o)),
          ),
        );
        const quads = (store.getQuads(null, null, null, null) as N3.Quad[]).map((q) => serializeQuad(q));
        await runCommand(runtime, responses, 'load1', 'syncLoad', { graphName: 'urn:vg:data', quads });

        // No consistent baseline yet (no full run succeeded) ⇒ FALL BACK to full.
        const res = (await runCommand(runtime, responses, 'inc1', 'reasonIncremental', {
          changedSubjects: [C('A')],
        })) as { mode: string; isConsistent: boolean | null };
        expect(res.mode).toBe('full');
        // In node (no SharedArrayBuffer) the full run's reasoner is unavailable, so
        // the consistency verdict is null — but the FALLBACK decision is the point.
        expect(res.isConsistent === null || typeof res.isConsistent === 'boolean').toBe(true);
      } finally {
        runtime.terminate();
      }
    },
    60000,
  );

  it(
    'an empty Σ_Δ (no changed subjects/signature) ALSO falls back to a full run',
    async () => {
      const responses = new Map<string, { ok: boolean; result?: unknown; error?: string }>();
      const runtime = createRdfWorkerRuntime((message: unknown) => {
        const m = message as { type?: string; id?: string; ok?: boolean; result?: unknown; error?: string };
        if (m && m.type === 'response' && typeof m.id === 'string') {
          responses.set(m.id, { ok: !!m.ok, result: m.result, error: m.error });
        }
      });
      try {
        const res = (await runCommand(runtime, responses, 'inc-empty', 'reasonIncremental', {})) as {
          mode: string;
        };
        expect(res.mode).toBe('full');
      } finally {
        runtime.terminate();
      }
    },
    60000,
  );
});
