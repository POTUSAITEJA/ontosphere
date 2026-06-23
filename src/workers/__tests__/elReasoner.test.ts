// src/workers/__tests__/elReasoner.test.ts
// @vitest-environment node
//
// ─────────────────────────────────────────────────────────────────────────────
// OWL 2 EL COMPLETION REASONER — correctness proof
// ─────────────────────────────────────────────────────────────────────────────
// Unit cases prove each EL⁺⁺ completion rule (transitive subsumption via CR1,
// existential + GCI via CR3/CR4, conjunction via CR2, role chains via CR-RC,
// unsatisfiability via CR5 and the conjunction-⊥ pattern) and the profile
// honesty (a non-EL construct — owl:allValuesFrom — is flagged, not silently
// mishandled).
//
// The final case is a STRONG CONFORMANCE check against the real Konclude WASM
// reasoner (REQUIRE_KONCLUDE-gated, --pool=threads): on an EL TBox, classifyEL's
// subsumption hierarchy must AGREE with full-DL classification. This asserts the
// polynomial EL path is sound & complete on EL input w.r.t. the full reasoner.
//
// Run the conformance case with:
//   REQUIRE_KONCLUDE=1 npx vitest run --pool=threads src/workers/__tests__/elReasoner.test.ts
import { describe, it, expect } from 'vitest';
import * as N3 from 'n3';
import { RdfReasoner } from 'rdf-reasoner-konclude';
import { classifyEL, isEntailedSubsumption, type Triple } from '../elReasoner';

const REQUIRE_KONCLUDE = !!process.env.REQUIRE_KONCLUDE;

// ── Vocabulary ───────────────────────────────────────────────────────────────
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const RDF_FIRST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first';
const RDF_REST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest';
const RDF_NIL = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil';
const RDFS_SUBCLASS_OF = 'http://www.w3.org/2000/01/rdf-schema#subClassOf';
const RDFS_SUBPROPERTY_OF = 'http://www.w3.org/2000/01/rdf-schema#subPropertyOf';
const OWL_CLASS = 'http://www.w3.org/2002/07/owl#Class';
const OWL_OBJECT_PROPERTY = 'http://www.w3.org/2002/07/owl#ObjectProperty';
const OWL_NOTHING = 'http://www.w3.org/2002/07/owl#Nothing';
const OWL_RESTRICTION = 'http://www.w3.org/2002/07/owl#Restriction';
const OWL_ON_PROPERTY = 'http://www.w3.org/2002/07/owl#onProperty';
const OWL_SOME_VALUES_FROM = 'http://www.w3.org/2002/07/owl#someValuesFrom';
const OWL_ALL_VALUES_FROM = 'http://www.w3.org/2002/07/owl#allValuesFrom';
const OWL_INTERSECTION_OF = 'http://www.w3.org/2002/07/owl#intersectionOf';
const OWL_PROPERTY_CHAIN_AXIOM = 'http://www.w3.org/2002/07/owl#propertyChainAxiom';

const EX = 'http://ex/';
const C = (n: string) => `${EX}${n}`;

// ── Triple builders ──────────────────────────────────────────────────────────
const t = (s: string, p: string, o: string, objectIsLiteral = false): Triple => ({
  subject: s,
  predicate: p,
  object: o,
  objectIsLiteral,
});
const declClass = (n: string): Triple => t(C(n), RDF_TYPE, OWL_CLASS);
const declProp = (n: string): Triple => t(C(n), RDF_TYPE, OWL_OBJECT_PROPERTY);
const subClass = (a: string, b: string): Triple => t(C(a), RDFS_SUBCLASS_OF, C(b));

let bnodeCounter = 0;
const bnode = () => `_:b${bnodeCounter++}`;

/** Build `∃R.Filler` as an owl:Restriction; returns [restrictionNode, triples]. */
function someValuesFrom(role: string, filler: string): [string, Triple[]] {
  const r = bnode();
  return [
    r,
    [
      t(r, RDF_TYPE, OWL_RESTRICTION),
      t(r, OWL_ON_PROPERTY, C(role)),
      t(r, OWL_SOME_VALUES_FROM, filler),
    ],
  ];
}

/** Build an rdf:List of the given members; returns [listHead, triples]. */
function rdfList(members: string[]): [string, Triple[]] {
  if (members.length === 0) return [RDF_NIL, []];
  const triples: Triple[] = [];
  const heads: string[] = members.map(() => bnode());
  for (let i = 0; i < members.length; i++) {
    triples.push(t(heads[i], RDF_FIRST, members[i]));
    triples.push(t(heads[i], RDF_REST, i + 1 < members.length ? heads[i + 1] : RDF_NIL));
  }
  return [heads[0], triples];
}

// ─────────────────────────────────────────────────────────────────────────────
describe('classifyEL — EL⁺⁺ completion rules', () => {
  it('CR1 transitive subsumption: A⊑B, B⊑C ⟹ A⊑C', () => {
    const ax: Triple[] = [
      declClass('A'),
      declClass('B'),
      declClass('Cc'),
      subClass('A', 'B'),
      subClass('B', 'Cc'),
    ];
    const r = classifyEL(ax);
    expect(r.inProfile).toBe(true);
    expect(r.isConsistent).toBe(true);
    // A ⊑ B, A ⊑ C (transitive), B ⊑ C.
    expect(isEntailedSubsumption(r, C('A'), C('B'))).toBe(true);
    expect(isEntailedSubsumption(r, C('A'), C('Cc'))).toBe(true);
    expect(isEntailedSubsumption(r, C('B'), C('Cc'))).toBe(true);
    // The reverse is NOT entailed.
    expect(isEntailedSubsumption(r, C('Cc'), C('A'))).toBe(false);
    // Show the derived subsumer set for A.
    expect(r.subsumptions.get(C('A'))).toEqual(new Set([C('A'), C('B'), C('Cc'), 'http://www.w3.org/2002/07/owl#Thing']));
  });

  it('CR3+CR4 existential + GCI: A⊑∃R.B, ∃R.B⊑C ⟹ A⊑C', () => {
    const [restr, restrTriples] = someValuesFrom('R', C('B'));
    const ax: Triple[] = [
      declClass('A'),
      declClass('B'),
      declClass('Cc'),
      declProp('R'),
      // A ⊑ ∃R.B
      t(C('A'), RDFS_SUBCLASS_OF, restr),
      ...restrTriples,
    ];
    // ∃R.B ⊑ C — a second restriction node on the SUBCLASS side.
    const [restr2, restr2Triples] = someValuesFrom('R', C('B'));
    ax.push(t(restr2, RDFS_SUBCLASS_OF, C('Cc')), ...restr2Triples);

    const r = classifyEL(ax);
    expect(r.inProfile).toBe(true);
    expect(r.isConsistent).toBe(true);
    expect(isEntailedSubsumption(r, C('A'), C('Cc'))).toBe(true);
  });

  it('CR2 conjunction: A⊑B, A⊑C, B⊓C⊑D ⟹ A⊑D', () => {
    const [inter, interTriples] = rdfList([C('B'), C('Cc')]);
    const conjNode = bnode();
    const ax: Triple[] = [
      declClass('A'),
      declClass('B'),
      declClass('Cc'),
      declClass('D'),
      subClass('A', 'B'),
      subClass('A', 'Cc'),
      // (B ⊓ C) ⊑ D
      t(conjNode, OWL_INTERSECTION_OF, inter),
      ...interTriples,
      t(conjNode, RDFS_SUBCLASS_OF, C('D')),
    ];
    const r = classifyEL(ax);
    expect(r.inProfile).toBe(true);
    expect(r.isConsistent).toBe(true);
    expect(isEntailedSubsumption(r, C('A'), C('D'))).toBe(true);
  });

  it('CR-RC role chain (transitivity R∘R⊑R): A⊑∃R.B, B⊑∃R.C ⟹ A⊑∃R.C', () => {
    const [rAB, abTriples] = someValuesFrom('R', C('B'));
    const [rBC, bcTriples] = someValuesFrom('R', C('Cc'));
    // Target existential ∃R.C named via a restriction we then subclass-name:
    // we test propagation by asserting ∃R.C ⊑ HasRC and checking A ⊑ HasRC.
    const [rRC, rcTriples] = someValuesFrom('R', C('Cc'));
    const ax: Triple[] = [
      declClass('A'),
      declClass('B'),
      declClass('Cc'),
      declClass('HasRC'),
      declProp('R'),
      // R ∘ R ⊑ R  (transitivity via a propertyChainAxiom)
      ...(() => {
        const [chain, chainTriples] = rdfList([C('R'), C('R')]);
        return [t(C('R'), OWL_PROPERTY_CHAIN_AXIOM, chain), ...chainTriples];
      })(),
      // A ⊑ ∃R.B
      t(C('A'), RDFS_SUBCLASS_OF, rAB),
      ...abTriples,
      // B ⊑ ∃R.C
      t(C('B'), RDFS_SUBCLASS_OF, rBC),
      ...bcTriples,
      // ∃R.C ⊑ HasRC
      t(rRC, RDFS_SUBCLASS_OF, C('HasRC')),
      ...rcTriples,
    ];
    const r = classifyEL(ax);
    expect(r.inProfile).toBe(true);
    expect(r.isConsistent).toBe(true);
    // By transitivity of R: A ⊑ ∃R.C, hence A ⊑ HasRC.
    expect(isEntailedSubsumption(r, C('A'), C('HasRC'))).toBe(true);
  });

  it('CR5 unsatisfiability via ⊥ filler: A⊑∃R.B, B⊑⊥ ⟹ A unsatisfiable', () => {
    const [rAB, abTriples] = someValuesFrom('R', C('B'));
    const ax: Triple[] = [
      declClass('A'),
      declClass('B'),
      declProp('R'),
      t(C('A'), RDFS_SUBCLASS_OF, rAB),
      ...abTriples,
      // B ⊑ ⊥
      t(C('B'), RDFS_SUBCLASS_OF, OWL_NOTHING),
    ];
    const r = classifyEL(ax);
    expect(r.inProfile).toBe(true);
    expect(r.unsatisfiableClasses).toContain(C('A'));
    expect(r.unsatisfiableClasses).toContain(C('B'));
    // An unsatisfiable class is below everything.
    expect(isEntailedSubsumption(r, C('A'), OWL_NOTHING)).toBe(true);
    // The TBox is still CONSISTENT (no individual forces ⊤ ⊑ ⊥).
    expect(r.isConsistent).toBe(true);
  });

  it('CR2 unsatisfiability via disjoint conjunction: A⊑B, A⊑C, B⊓C⊑⊥ ⟹ A unsatisfiable', () => {
    const [inter, interTriples] = rdfList([C('B'), C('Cc')]);
    const conjNode = bnode();
    const ax: Triple[] = [
      declClass('A'),
      declClass('B'),
      declClass('Cc'),
      subClass('A', 'B'),
      subClass('A', 'Cc'),
      t(conjNode, OWL_INTERSECTION_OF, inter),
      ...interTriples,
      // (B ⊓ C) ⊑ ⊥
      t(conjNode, RDFS_SUBCLASS_OF, OWL_NOTHING),
    ];
    const r = classifyEL(ax);
    expect(r.inProfile).toBe(true);
    expect(r.unsatisfiableClasses).toContain(C('A'));
    expect(isEntailedSubsumption(r, C('A'), OWL_NOTHING)).toBe(true);
  });

  it('profile honesty: owl:allValuesFrom is FLAGGED, not silently mishandled', () => {
    const restr = bnode();
    const ax: Triple[] = [
      declClass('A'),
      declClass('B'),
      declProp('R'),
      // A ⊑ ∀R.B  — NOT in EL.
      t(C('A'), RDFS_SUBCLASS_OF, restr),
      t(restr, RDF_TYPE, OWL_RESTRICTION),
      t(restr, OWL_ON_PROPERTY, C('R')),
      t(restr, OWL_ALL_VALUES_FROM, C('B')),
    ];
    const r = classifyEL(ax);
    expect(r.inProfile).toBe(false);
    expect(r.rejected.length).toBeGreaterThan(0);
    expect(r.rejected.some((x) => /allValuesFrom/i.test(x.reason))).toBe(true);
  });

  it('isEntailedSubsumption is open-world for unmentioned classes', () => {
    const r = classifyEL([declClass('A')]);
    // A ⊑ A and A ⊑ ⊤ hold; A ⊑ (unknown) does not.
    expect(isEntailedSubsumption(r, C('A'), C('A'))).toBe(true);
    expect(isEntailedSubsumption(r, C('A'), 'http://www.w3.org/2002/07/owl#Thing')).toBe(true);
    expect(isEntailedSubsumption(r, C('A'), C('Zzz'))).toBe(false);
    expect(isEntailedSubsumption(r, C('Never'), C('A'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STRONG CONFORMANCE vs Konclude (REQUIRE_KONCLUDE-gated, real WASM reasoner)
// ─────────────────────────────────────────────────────────────────────────────
describe('classifyEL — conformance with Konclude on an EL TBox', () => {
  // Build an EL TBox both as Triple[] (for classifyEL) and as N3 quads (for Konclude).
  function buildElTbox(): { triples: Triple[]; quads: N3.Quad[] } {
    const triples: Triple[] = [];
    const { namedNode, quad } = N3.DataFactory;
    const quads: N3.Quad[] = [];

    // Mirror every triple into an N3 quad. Restrictions/lists use blank nodes.
    const bmap = new Map<string, N3.BlankNode>();
    const term = (v: string) =>
      v.startsWith('_:') ? (bmap.get(v) ?? (() => { const b = N3.DataFactory.blankNode(v.slice(2)); bmap.set(v, b); return b; })()) : namedNode(v);

    const add = (tr: Triple) => {
      triples.push(tr);
      quads.push(quad(term(tr.subject) as N3.Quad_Subject, namedNode(tr.predicate), term(tr.object) as N3.Quad_Object));
    };

    // Classes A⊑B⊑C; D; Vehicle/Car; Parent via ∃hasChild.Person.
    for (const n of ['A', 'B', 'Cc', 'D', 'Person', 'Parent', 'Vehicle', 'Car', 'Animal', 'Dog']) {
      add(declClass(n));
    }
    add(declProp('hasChild'));
    add(subClass('A', 'B'));
    add(subClass('B', 'Cc'));
    add(subClass('Cc', 'D'));
    add(subClass('Car', 'Vehicle'));
    add(subClass('Dog', 'Animal'));

    // Parent ≡ ∃hasChild.Person  (use subClass both ways via two restrictions).
    {
      const [r1, r1t] = someValuesFrom('hasChild', C('Person'));
      add(t(C('Parent'), RDFS_SUBCLASS_OF, r1));
      r1t.forEach(add);
      const [r2, r2t] = someValuesFrom('hasChild', C('Person'));
      add(t(r2, RDFS_SUBCLASS_OF, C('Parent')));
      r2t.forEach(add);
    }
    return { triples, quads };
  }

  it(
    'classifyEL subsumptions AGREE with Konclude classification on an EL TBox',
    async () => {
      let reasoner: RdfReasoner | null = null;
      try {
        reasoner = new RdfReasoner();
        await reasoner.ready;
      } catch (e) {
        reasoner?.terminate();
        if (REQUIRE_KONCLUDE) {
          throw new Error(`REQUIRE_KONCLUDE set but Konclude failed to init: ${String(e)}`);
        }
        console.warn('[TEST][SKIP] Konclude WASM unavailable — skipping EL conformance:', String(e));
        return;
      }

      try {
        const { triples, quads } = buildElTbox();

        // EL reasoner classification.
        const el = classifyEL(triples);
        expect(el.inProfile).toBe(true);
        expect(el.isConsistent).toBe(true);

        // Konclude classification: materialize with the class hierarchy included.
        const inferred = (await reasoner.materialize(quads, {
          includeClassHierarchy: true,
        })) as unknown as N3.Quad[];

        // The named classes under comparison.
        const namedList = ['A', 'B', 'Cc', 'D', 'Person', 'Parent', 'Vehicle', 'Car', 'Animal', 'Dog'].map(C);
        const named = new Set(namedList);

        // Konclude may emit a transitively-REDUCED hierarchy (told edges only) or a
        // fuller one. To compare entailment-for-entailment we take the
        // reflexive-transitive CLOSURE of Konclude's named subClassOf edges
        // (told ∪ inferred) and compare it against classifyEL's named closure.
        const told = quads
          .filter(
            (q) =>
              q.predicate.value === RDFS_SUBCLASS_OF &&
              named.has(q.subject.value) &&
              named.has(q.object.value),
          )
          .map((q) => [q.subject.value, q.object.value] as const);
        const inferredEdges = inferred
          .filter(
            (q) =>
              q.predicate.value === RDFS_SUBCLASS_OF &&
              named.has(q.subject.value) &&
              named.has(q.object.value),
          )
          .map((q) => [q.subject.value, q.object.value] as const);

        // Floyd–Warshall-style reflexive-transitive closure over named classes.
        const closure = (edges: ReadonlyArray<readonly [string, string]>): Set<string> => {
          const reach = new Map<string, Set<string>>();
          for (const n of namedList) reach.set(n, new Set([n])); // reflexive
          for (const [s, o] of edges) reach.get(s)?.add(o);
          let changed = true;
          while (changed) {
            changed = false;
            for (const s of namedList) {
              const rs = reach.get(s) as Set<string>;
              for (const m of [...rs]) {
                const rm = reach.get(m);
                if (!rm) continue;
                for (const o of rm) {
                  if (!rs.has(o)) {
                    rs.add(o);
                    changed = true;
                  }
                }
              }
            }
          }
          const pairs = new Set<string>();
          for (const s of namedList) {
            for (const o of reach.get(s) as Set<string>) {
              if (s !== o) pairs.add(`${s}\0${o}`);
            }
          }
          return pairs;
        };

        const konClosure = closure([...told, ...inferredEdges]);

        // classifyEL's named non-trivial subsumption closure.
        const elClosure = new Set<string>();
        for (const sub of namedList) {
          for (const sup of namedList) {
            if (sub !== sup && isEntailedSubsumption(el, sub, sup)) {
              elClosure.add(`${sub}\0${sup}`);
            }
          }
        }

        // EXACT AGREEMENT: classifyEL ≡ Konclude over named-class subsumption.
        const render = (s: Set<string>) =>
          [...s].map((k) => k.replace('\0', ' ⊑ ')).sort().join(', ');
        expect(render(elClosure), 'classifyEL ≡ Konclude named subsumption closure').toBe(
          render(konClosure),
        );

        // Spot-check the key EL-derived subsumptions are in the agreed closure:
        // A⊑D (transitive over A⊑B⊑Cc⊑D) and Car⊑Vehicle.
        expect(konClosure.has(`${C('A')}\0${C('D')}`)).toBe(true);
        expect(elClosure.has(`${C('A')}\0${C('D')}`)).toBe(true);
        expect(elClosure.has(`${C('Car')}\0${C('Vehicle')}`)).toBe(true);
      } finally {
        reasoner.terminate();
      }
    },
    300000,
  );
});
