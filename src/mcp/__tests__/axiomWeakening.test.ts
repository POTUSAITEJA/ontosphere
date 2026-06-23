// src/mcp/__tests__/axiomWeakening.test.ts
// @vitest-environment node
//
// Pure unit tests for the axiom-weakening operators (Troquard et al. AAAI 2018;
// Li & Lambrix ISWC 2024). No reasoner needed — every assertion is deterministic
// over hand-built class hierarchies. Covers:
//   - GENERALISE: A ⊑ B with B ⊑ C ⊑ Thing → weakenings [A⊑C, A⊑Thing]
//   - ranking prefers the most-specific superclass
//   - DROP CONJUNCT: A ⊑ B ⊓ C → [A⊑B, A⊑C]
//   - the addWeakeningRepairs integration that augments deletion repairs
import { describe, it, expect } from 'vitest';
import {
  buildClassHierarchy,
  buildDirectEdgeMap,
  enumerateWeakenings,
  OWL_THING,
  RDFS_SUBCLASS_OF,
  type CulpritAxiom,
} from '../tools/axiomWeakening';
import { addWeakeningRepairs, type RepairSuggestion } from '../tools/computeRepairs';

const EX = 'http://ex/';
const A = `${EX}A`;
const B = `${EX}B`;
const C = `${EX}C`;
const D = `${EX}D`;

const culprit = (subject: string, object: string, extra: Partial<CulpritAxiom> = {}): CulpritAxiom => ({
  subject,
  predicate: RDFS_SUBCLASS_OF,
  object,
  ...extra,
});

describe('buildClassHierarchy — transitive closure of superclasses', () => {
  it('computes indirect superclasses (B ⊑ C, C ⊑ D ⇒ B ⊑ {C,D})', () => {
    const h = buildClassHierarchy([
      { sub: B, sup: C },
      { sub: C, sup: D },
    ]);
    expect([...(h.superclasses.get(B) ?? [])].sort()).toEqual([C, D].sort());
    expect([...(h.superclasses.get(C) ?? [])]).toEqual([D]);
  });

  it('excludes self-edges and owl:Thing from the stored superclass set', () => {
    const h = buildClassHierarchy([
      { sub: B, sup: B },
      { sub: B, sup: OWL_THING },
      { sub: B, sup: C },
    ]);
    const sups = h.superclasses.get(B) ?? new Set<string>();
    expect(sups.has(B)).toBe(false);
    expect(sups.has(OWL_THING)).toBe(false);
    expect(sups.has(C)).toBe(true);
  });

  it('handles cycles (mutually-asserted subclasses) without infinite recursion', () => {
    const h = buildClassHierarchy([
      { sub: B, sup: C },
      { sub: C, sup: B },
    ]);
    // each is a superclass of the other; self excluded.
    expect(h.superclasses.get(B)?.has(C)).toBe(true);
    expect(h.superclasses.get(B)?.has(B)).toBe(false);
  });
});

describe('enumerateWeakenings — GENERALISE the superclass', () => {
  // Hierarchy: B ⊑ C ⊑ Thing. Culprit: A ⊑ B.
  const edges = [{ sub: B, sup: C }];
  const hierarchy = buildClassHierarchy(edges);
  const direct = buildDirectEdgeMap(edges);

  it('produces [A⊑C, A⊑Thing] for A⊑B with B⊑C⊑Thing', () => {
    const ws = enumerateWeakenings(culprit(A, B), hierarchy, { direct });
    const targets = ws.map((w) => w.weakerTarget);
    expect(targets).toEqual([C, OWL_THING]);
  });

  it('the A⊑C weakening adds A rdfs:subClassOf C and removes A rdfs:subClassOf B', () => {
    const ws = enumerateWeakenings(culprit(A, B), hierarchy, { direct });
    const gen = ws.find((w) => w.weakerTarget === C)!;
    expect(gen.strategy).toBe('generalize');
    expect(gen.removes).toEqual([{ subject: A, predicate: RDFS_SUBCLASS_OF, object: B }]);
    expect(gen.adds).toEqual([{ subject: A, predicate: RDFS_SUBCLASS_OF, object: C }]);
  });

  it('the A⊑owl:Thing weakening adds NOTHING (≡ deletion)', () => {
    const ws = enumerateWeakenings(culprit(A, B), hierarchy, { direct });
    const thing = ws.find((w) => w.weakerTarget === OWL_THING)!;
    expect(thing.adds).toEqual([]);
    expect(thing.removes).toHaveLength(1);
  });

  it('can suppress the owl:Thing fallback (includeThing:false)', () => {
    const ws = enumerateWeakenings(culprit(A, B), hierarchy, { direct, includeThing: false });
    expect(ws.map((w) => w.weakerTarget)).toEqual([C]);
  });

  it('ranks the MOST-SPECIFIC superclass first (D⊑C⊑X: A⊑D weakens to C before X)', () => {
    const X = `${EX}X`;
    const chain = [
      { sub: D, sup: C },
      { sub: C, sup: X },
    ];
    const h = buildClassHierarchy(chain);
    const dm = buildDirectEdgeMap(chain);
    const ws = enumerateWeakenings(culprit(A, D), h, { direct: dm, includeThing: false });
    // C is 1 hop up, X is 2 hops up → C must come first (least weakening).
    expect(ws.map((w) => w.weakerTarget)).toEqual([C, X]);
    expect(ws[0].specificityRank).toBeLessThan(ws[1].specificityRank);
  });

  it('returns no weakenings for a non-subClassOf culprit', () => {
    const ws = enumerateWeakenings(
      { subject: A, predicate: `${EX}p`, object: B },
      hierarchy,
      { direct },
    );
    expect(ws).toEqual([]);
  });

  it('threads the source graph onto remove/add triples', () => {
    const ws = enumerateWeakenings(culprit(A, B, { graph: 'urn:vg:ontologies' }), hierarchy, {
      direct,
      includeThing: false,
    });
    expect(ws[0].removes[0].graph).toBe('urn:vg:ontologies');
    expect(ws[0].adds[0].graph).toBe('urn:vg:ontologies');
  });
});

describe('enumerateWeakenings — DROP A CONJUNCT', () => {
  it('A ⊑ B ⊓ C (owl:intersectionOf) → [A⊑B, A⊑C]', () => {
    const intersectionNode = '_:int1';
    const ws = enumerateWeakenings(
      culprit(A, intersectionNode, { intersectionMembers: [B, C] }),
      buildClassHierarchy([]),
    );
    const targets = ws.map((w) => w.weakerTarget).sort();
    expect(targets).toEqual([B, C].sort());
    for (const w of ws) {
      expect(w.strategy).toBe('dropConjunct');
      expect(w.removes).toEqual([{ subject: A, predicate: RDFS_SUBCLASS_OF, object: intersectionNode }]);
      expect(w.adds).toHaveLength(1);
    }
  });

  it('intersection weakening does NOT also generalise (object is not a named class)', () => {
    const ws = enumerateWeakenings(
      culprit(A, '_:int', { intersectionMembers: [B, C] }),
      buildClassHierarchy([{ sub: B, sup: D }]),
    );
    // Only dropConjunct candidates; no owl:Thing fallback, no generalisation of B/C.
    expect(ws.every((w) => w.strategy === 'dropConjunct')).toBe(true);
    expect(ws.map((w) => w.weakerTarget).sort()).toEqual([B, C].sort());
  });

  it('sibling-target conjunction (A⊑B, A⊑C as triples): dropping A⊑C adds nothing, keeps B', () => {
    const ws = enumerateWeakenings(
      culprit(A, C, { siblingTargets: [B] }),
      buildClassHierarchy([]),
      { includeThing: false },
    );
    const drop = ws.find((w) => w.strategy === 'dropConjunct')!;
    expect(drop).toBeDefined();
    expect(drop.adds).toEqual([]);
    expect(drop.removes).toEqual([{ subject: A, predicate: RDFS_SUBCLASS_OF, object: C }]);
  });

  it('LACONIC culprit: A ⊑ B ⊓ C with B the culprit → top candidate drops B, keeps C (ranked first)', () => {
    const intersectionNode = '_:int1';
    const ws = enumerateWeakenings(
      culprit(A, intersectionNode, { intersectionMembers: [B, C], laconicCulpritMember: B }),
      buildClassHierarchy([]),
    );
    // The FIRST (most-preferred) candidate is the laconic-precise one: it drops
    // the culprit B and keeps C — i.e. adds `A ⊑ C`, removes nothing of C.
    const top = ws[0];
    expect(top.strategy).toBe('dropConjunct');
    expect(top.specificityRank).toBe(0);
    expect(top.adds).toEqual([{ subject: A, predicate: RDFS_SUBCLASS_OF, object: C }]);
    expect(top.rationale).toContain('LACONIC');
    // The per-member candidates are still present (keep B / keep C alternatives).
    expect(ws.some((w) => w.weakerTarget === B)).toBe(true);
    expect(ws.some((w) => w.weakerTarget === C)).toBe(true);
  });

  it('LACONIC hint is inert when the culprit member is not in the intersection', () => {
    const ws = enumerateWeakenings(
      culprit(A, '_:int', { intersectionMembers: [B, C], laconicCulpritMember: D }),
      buildClassHierarchy([]),
    );
    // No specificityRank-0 laconic candidate — falls back to the per-member set.
    expect(ws.every((w) => w.specificityRank >= 1)).toBe(true);
    expect(ws.map((w) => w.weakerTarget).sort()).toEqual([B, C].sort());
  });
});

describe('addWeakeningRepairs — augments deletion repairs with weakening alternatives', () => {
  const deletion = (id: string, s: string, p: string, o: string): RepairSuggestion => ({
    id,
    issue: 'inconsistency',
    action: { tool: 'removeLink', args: { subjectIri: s, predicateIri: p, objectIri: o } },
    rationale: `Remove ${s} ${p} ${o}`,
    justificationsCovered: [0],
  });

  it('adds W-ids weakenings for a subClassOf deletion, keeping the deletion', () => {
    const edges = [{ sub: B, sup: C }];
    const repairs = [deletion('R1', A, RDFS_SUBCLASS_OF, B)];
    const augmented = addWeakeningRepairs(repairs, {
      hierarchy: buildClassHierarchy(edges),
      direct: buildDirectEdgeMap(edges),
    });
    // R1 (deletion) preserved.
    expect(augmented.find((r) => r.id === 'R1')).toBeDefined();
    // At least one weakening alternative referencing R1.
    const weakenings = augmented.filter((r) => r.kind === 'weaken');
    expect(weakenings.length).toBeGreaterThanOrEqual(1);
    expect(weakenings[0].alternativeTo).toBe('R1');
    expect(weakenings[0].batch?.adds[0]).toEqual({ subject: A, predicate: RDFS_SUBCLASS_OF, object: C });
    expect(weakenings[0].weakerThan).toContain('⊑');
  });

  it('does NOT add weakenings for a non-subClassOf deletion (e.g. rdf:type ABox)', () => {
    const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
    const repairs = [deletion('R1', `${EX}frank`, RDF_TYPE, `${EX}Employee`)];
    const augmented = addWeakeningRepairs(repairs, { hierarchy: buildClassHierarchy([]) });
    expect(augmented.filter((r) => r.kind === 'weaken')).toHaveLength(0);
    expect(augmented).toHaveLength(1);
  });

  it('suppresses the owl:Thing weakening (it duplicates the deletion)', () => {
    const edges = [{ sub: B, sup: C }];
    const augmented = addWeakeningRepairs([deletion('R1', A, RDFS_SUBCLASS_OF, B)], {
      hierarchy: buildClassHierarchy(edges),
      direct: buildDirectEdgeMap(edges),
    });
    const weakenings = augmented.filter((r) => r.kind === 'weaken');
    // No weakening should add nothing-or-target owl:Thing.
    expect(weakenings.every((w) => w.batch && w.batch.adds.length > 0)).toBe(true);
    expect(weakenings.some((w) => w.batch?.adds[0]?.object === OWL_THING)).toBe(false);
  });

  it('is deterministic — identical input yields identical output', () => {
    const edges = [{ sub: B, sup: C }];
    const ctx = { hierarchy: buildClassHierarchy(edges), direct: buildDirectEdgeMap(edges) };
    const r1 = addWeakeningRepairs([deletion('R1', A, RDFS_SUBCLASS_OF, B)], ctx);
    const r2 = addWeakeningRepairs([deletion('R1', A, RDFS_SUBCLASS_OF, B)], ctx);
    expect(r1).toEqual(r2);
  });
});
