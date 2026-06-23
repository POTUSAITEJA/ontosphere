// src/mcp/__tests__/computeRepairsMinimality.test.ts
// @vitest-environment node
//
// BOUNDED subset-minimality verification for DELETION repairs. These tests drive
// `verifyDeletionSetMinimality` / `annotateDeletionMinimality` through a
// DETERMINISTIC MOCK consistency oracle — no Konclude / WASM. The mock plays the
// role of rdfManager.verifyRepairDetailed: given a set of removals it simulates
// removing those axioms from a store COPY and reports whether the result is
// consistent, asserting along the way that it never mutates the author's graph.

import { describe, it, expect } from 'vitest';
import {
  computeRepairs,
  verifyDeletionSetMinimality,
  annotateDeletionMinimality,
  repairToDeletionRemoval,
  type DeletionRemoval,
  type ReasonerConsistencyCheck,
  type RepairSuggestion,
} from '../tools/computeRepairs';
import type { DiagnosticsData } from '../tools/diagnosticsBrief';

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const OWL_DISJOINT = 'http://www.w3.org/2002/07/owl#disjointWith';
const EX = 'http://ex/';
const ax = (s: string, p: string, o: string) => ({ subject: s, predicate: p, object: o });

function base(partial: Partial<DiagnosticsData>): DiagnosticsData {
  return {
    isConsistent: true,
    justifications: [],
    unsatisfiableClasses: [],
    profile: { owl2dl: true, violations: [] },
    shaclViolations: [],
    ...partial,
  };
}
const inconsistency = (
  justifications: DiagnosticsData['justifications'],
  rest: Partial<DiagnosticsData> = {},
) => base({ isConsistent: false, justifications, ...rest });

const rkey = (r: DeletionRemoval) => `${r.subject} ${r.predicate} ${r.object}`;

/**
 * Build a deterministic mock consistency oracle over a SIMULATED store.
 *
 * `clashes` is a family of "contradiction sets": each clash is a set of triple
 * keys, and the contradiction is relieved iff AT LEAST ONE of its members is
 * removed (exactly the MIPS semantics). The ontology is consistent iff every
 * clash has at least one removed member. The oracle works on a COPY of the
 * store (it never touches `store`), proving the read-only verification contract.
 */
function makeOracle(
  store: Set<string>,
  clashes: string[][],
): { check: ReasonerConsistencyCheck; storeSnapshot: string[] } {
  const storeSnapshot = [...store].sort();
  const check: ReasonerConsistencyCheck = async (removals) => {
    // Operate on a COPY — never mutate the author's `store`.
    const working = new Set(store);
    for (const r of removals) working.delete(rkey(r));
    // Consistent iff every clash lost at least one member.
    const consistent = clashes.every((clash) => clash.some((m) => !working.has(m)));
    return consistent;
  };
  return { check, storeSnapshot };
}

describe('verifyDeletionSetMinimality — bounded search finds the true minimum', () => {
  it('finds a SMALLER set than the greedy pick when a single shared axiom hits both clashes', async () => {
    // Two clashes that BOTH contain a shared axiom `shared`. The true minimum
    // hitting set is {shared} (size 1). Simulate a greedy pick that chose three
    // axioms (one per clash plus the shared one) — the bounded search must find
    // {shared} alone restores consistency.
    const aX = `${EX}a ${RDF_TYPE} ${EX}X`;
    const bY = `${EX}b ${RDF_TYPE} ${EX}Y`;
    const shared = `${EX}Employee ${OWL_DISJOINT} ${EX}Contractor`;
    const store = new Set([aX, bY, shared]);
    const clashes = [
      [aX, shared],
      [bY, shared],
    ];
    const { check } = makeOracle(store, clashes);

    const removals: DeletionRemoval[] = [aX, bY, shared].map((k) => {
      const [subject, predicate, object] = k.split(' ');
      return { subject, predicate, object };
    });

    const result = await verifyDeletionSetMinimality(removals, check, { bound: 4 });
    expect(result.minimalityVerified).toBe(true);
    // The minimal verified set is exactly the single shared axiom.
    expect(result.minimalDeletionSet.map(rkey)).toEqual([shared]);
  });

  it('finds a 2-element minimum for two DISJOINT clashes (cannot be done with one)', async () => {
    // Disjoint clashes: each needs its own removal — minimum cardinality is 2.
    const aX = `${EX}a ${RDF_TYPE} ${EX}X`;
    const aY = `${EX}a ${RDF_TYPE} ${EX}Y`;
    const bP = `${EX}b ${RDF_TYPE} ${EX}P`;
    const bQ = `${EX}b ${RDF_TYPE} ${EX}Q`;
    const store = new Set([aX, aY, bP, bQ]);
    const clashes = [
      [aX, aY],
      [bP, bQ],
    ];
    const { check } = makeOracle(store, clashes);
    const removals: DeletionRemoval[] = [aX, bP].map((k) => {
      const [subject, predicate, object] = k.split(' ');
      return { subject, predicate, object };
    });
    const result = await verifyDeletionSetMinimality(removals, check, { bound: 4 });
    expect(result.minimalityVerified).toBe(true);
    expect(result.minimalDeletionSet).toHaveLength(2);
    // Neither alone restores consistency (each leaves the other clash unhit).
    const m = result.minimalDeletionSet.map(rkey).sort();
    expect(m).toEqual([aX, bP].sort());
  });

  it('integrates with computeRepairs: a 2-MIPS overlap collapses to 1 verified-minimal removal', async () => {
    // The shared disjointWith axiom hits both MIPS. computeRepairs already
    // collapses this to one repair; the bounded search VERIFIES that 1 is minimal.
    const shared = ax(`${EX}Employee`, OWL_DISJOINT, `${EX}Contractor`);
    const mips = [
      [ax(`${EX}frank`, RDF_TYPE, `${EX}Employee`), ax(`${EX}frank`, RDF_TYPE, `${EX}Contractor`), shared],
      [ax(`${EX}gina`, RDF_TYPE, `${EX}Employee`), ax(`${EX}gina`, RDF_TYPE, `${EX}Contractor`), shared],
    ];
    const repairs = computeRepairs(inconsistency(mips));
    const removalKeys = new Set(
      repairs
        .filter((r) => r.issue === 'inconsistency' && !r.needsManualReview)
        .map((r) => repairToDeletionRemoval(r))
        .map(rkey),
    );
    // Oracle: consistent iff the shared axiom is removed.
    const sharedKey = `${shared.subject} ${shared.predicate} ${shared.object}`;
    const check: ReasonerConsistencyCheck = async (removals) =>
      removals.some((r) => rkey(r) === sharedKey);

    const result = await annotateDeletionMinimality(repairs, check, { bound: 4 });
    expect(result.minimalityVerified).toBe(true);
    expect(result.minimalDeletionSet.map(rkey)).toEqual([sharedKey]);
    // The deletion repair was annotated in place.
    const del = repairs.filter((r) => r.issue === 'inconsistency' && !r.needsManualReview);
    for (const r of del) expect(r.minimalityVerified).toBe(true);
    // (sanity) the greedy repair set already targeted the shared axiom.
    expect(removalKeys.has(sharedKey)).toBe(true);
  });
});

describe('verifyDeletionSetMinimality — bound fallback flag', () => {
  it('skips the search and flags minimalityVerified:false when the set exceeds the bound', async () => {
    // Five disjoint removals with bound 4: search must be skipped.
    const removals: DeletionRemoval[] = Array.from({ length: 5 }, (_, i) => ({
      subject: `${EX}s${i}`,
      predicate: RDF_TYPE,
      object: `${EX}C${i}`,
    }));
    let called = 0;
    const check: ReasonerConsistencyCheck = async () => {
      called += 1;
      return true;
    };
    const result = await verifyDeletionSetMinimality(removals, check, { bound: 4 });
    expect(result.minimalityVerified).toBe(false);
    expect(result.checksPerformed).toBe(0);
    expect(called).toBe(0); // oracle never consulted above the bound
    // Falls back to the full irredundant set.
    expect(result.minimalDeletionSet).toHaveLength(5);
  });

  it('runs the search exactly at the bound (n === bound)', async () => {
    const aX = `${EX}a ${RDF_TYPE} ${EX}X`;
    const bY = `${EX}b ${RDF_TYPE} ${EX}Y`;
    const store = new Set([aX, bY]);
    const { check } = makeOracle(store, [[aX, bY]]); // single clash, either removal fixes it
    const removals: DeletionRemoval[] = [aX, bY].map((k) => {
      const [subject, predicate, object] = k.split(' ');
      return { subject, predicate, object };
    });
    const result = await verifyDeletionSetMinimality(removals, check, { bound: 2 });
    expect(result.minimalityVerified).toBe(true);
    // Single-clash: minimum is 1 (the lexicographically-first member tried).
    expect(result.minimalDeletionSet).toHaveLength(1);
    expect(result.minimalDeletionSet.map(rkey)).toEqual([aX]);
  });

  it('default bound is 4', async () => {
    const removals: DeletionRemoval[] = Array.from({ length: 5 }, (_, i) => ({
      subject: `${EX}s${i}`,
      predicate: RDF_TYPE,
      object: `${EX}C${i}`,
    }));
    const check: ReasonerConsistencyCheck = async () => true;
    const result = await verifyDeletionSetMinimality(removals, check); // no options
    expect(result.bound).toBe(4);
    expect(result.minimalityVerified).toBe(false); // 5 > 4
  });
});

describe('verifyDeletionSetMinimality — pure-path behaviour is unchanged', () => {
  it('computeRepairs leaves minimalityVerified UNDEFINED (no oracle supplied)', () => {
    const mips = [[ax(`${EX}a`, RDF_TYPE, `${EX}X`), ax(`${EX}a`, RDF_TYPE, `${EX}Y`)]];
    const repairs = computeRepairs(inconsistency(mips));
    for (const r of repairs) expect(r.minimalityVerified).toBeUndefined();
  });

  it('annotateDeletionMinimality is a no-op for an empty/non-actionable repair set', async () => {
    const check: ReasonerConsistencyCheck = async () => true;
    const result = await annotateDeletionMinimality([], check);
    expect(result.minimalityVerified).toBe(false);
    expect(result.minimalDeletionSet).toHaveLength(0);
  });

  it('returns minimalityVerified:false when even the full set never restores consistency', async () => {
    // An oracle that always reports inconsistent (e.g. removals matched nothing /
    // degenerate MIPS). The search exhausts all subsets and falls back honestly.
    const removals: DeletionRemoval[] = [
      { subject: `${EX}a`, predicate: RDF_TYPE, object: `${EX}X` },
      { subject: `${EX}b`, predicate: RDF_TYPE, object: `${EX}Y` },
    ];
    const check: ReasonerConsistencyCheck = async () => false;
    const result = await verifyDeletionSetMinimality(removals, check, { bound: 4 });
    expect(result.minimalityVerified).toBe(false);
    expect(result.minimalDeletionSet).toHaveLength(2); // full set fallback
    // Searched 1-subsets (2) + 2-subset (1) = 3 checks.
    expect(result.checksPerformed).toBe(3);
  });
});

describe('verifyDeletionSetMinimality — STORE IMMUTABILITY (read-only contract)', () => {
  it('the oracle operates on a COPY: the author store is byte-identical after verification', async () => {
    const aX = `${EX}a ${RDF_TYPE} ${EX}X`;
    const bY = `${EX}b ${RDF_TYPE} ${EX}Y`;
    const shared = `${EX}Employee ${OWL_DISJOINT} ${EX}Contractor`;
    const store = new Set([aX, bY, shared]);
    const { check, storeSnapshot } = makeOracle(store, [
      [aX, shared],
      [bY, shared],
    ]);
    const removals: DeletionRemoval[] = [aX, bY, shared].map((k) => {
      const [subject, predicate, object] = k.split(' ');
      return { subject, predicate, object };
    });

    await verifyDeletionSetMinimality(removals, check, { bound: 4 });

    // The author's store must be unchanged after the (many) verification calls.
    expect([...store].sort()).toEqual(storeSnapshot);
    expect(store.size).toBe(3);
  });

  it('the input removals array and its elements are not mutated by the search', async () => {
    const aX = `${EX}a ${RDF_TYPE} ${EX}X`;
    const bY = `${EX}b ${RDF_TYPE} ${EX}Y`;
    const store = new Set([aX, bY]);
    const { check } = makeOracle(store, [[aX, bY]]);
    const removals: DeletionRemoval[] = [aX, bY].map((k) => {
      const [subject, predicate, object] = k.split(' ');
      return { subject, predicate, object };
    });
    const before = JSON.stringify(removals);
    await verifyDeletionSetMinimality(removals, check, { bound: 4 });
    expect(JSON.stringify(removals)).toBe(before);
    expect(removals).toHaveLength(2);
  });

  it('annotateDeletionMinimality does not mutate fields other than minimalityVerified', async () => {
    const mips = [[ax(`${EX}a`, RDF_TYPE, `${EX}X`), ax(`${EX}a`, RDF_TYPE, `${EX}Y`)]];
    const repairs = computeRepairs(inconsistency(mips));
    const del = repairs.find((r) => r.issue === 'inconsistency' && !r.needsManualReview)!;
    const snapshot: RepairSuggestion = JSON.parse(JSON.stringify(del));
    const check: ReasonerConsistencyCheck = async () => true; // any single removal fixes it
    await annotateDeletionMinimality(repairs, check, { bound: 4 });
    // Only minimalityVerified was added; action/rationale/id untouched.
    expect(del.id).toBe(snapshot.id);
    expect(del.action).toEqual(snapshot.action);
    expect(del.rationale).toBe(snapshot.rationale);
    expect(del.minimalityVerified).toBe(true);
  });
});
