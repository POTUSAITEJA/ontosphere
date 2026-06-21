// @vitest-environment node
//
// Pure unit tests for the entailment-as-unsatisfiability probe construction
// (src/workers/entailmentProbe.ts). No reasoner / Worker needed — verifies the
// ¬axiom triple shapes and that probeKeys match the produced quads' term values
// exactly (so the worker can strip probe axioms out of justifications).
import { describe, it, expect } from 'vitest';
import * as N3 from 'n3';
import {
  buildEntailmentProbe,
  classifyAxiom,
  tripleKey,
  RDF_TYPE_URI,
  RDFS_SUBCLASSOF_URI,
  OWL_CLASS_URI,
  OWL_COMPLEMENT_OF_URI,
  type ProbeDataFactory,
} from '../entailmentProbe';

const df = N3.DataFactory as unknown as ProbeDataFactory;

const A = 'http://example.org/A';
const B = 'http://example.org/B';
const C = 'http://example.org/C';
const x = 'http://example.org/x';

/** Key from a real quad's term .value fields (mirrors the worker's strip key). */
const keyOfQuad = (q: N3.Quad) => `${q.subject.value}\0${q.predicate.value}\0${q.object.value}`;

describe('classifyAxiom', () => {
  it('classifies rdfs:subClassOf with IRI object as subClassOf', () => {
    expect(classifyAxiom(RDFS_SUBCLASSOF_URI, true)).toBe('subClassOf');
  });
  it('classifies rdf:type with IRI object as type', () => {
    expect(classifyAxiom(RDF_TYPE_URI, true)).toBe('type');
  });
  it('classifies a literal object as unsupported', () => {
    expect(classifyAxiom(RDFS_SUBCLASSOF_URI, false)).toBe('unsupported');
  });
  it('classifies an arbitrary predicate as unsupported', () => {
    expect(classifyAxiom('http://example.org/p', true)).toBe('unsupported');
  });
});

describe('buildEntailmentProbe — subClassOf (A ⊑ B)', () => {
  const probe = buildEntailmentProbe<N3.Quad>(df, A, RDFS_SUBCLASSOF_URI, B, true);

  it('selects the subClassOf shape', () => {
    expect(probe.kind).toBe('subClassOf');
  });

  it('emits exactly 4 probe quads', () => {
    // [ a owl:Class ; owl:complementOf B ]  (2) + A ⊑ ¬B (1) + witness a A (1)
    expect(probe.probeQuads).toHaveLength(4);
  });

  it('encodes ¬B as [ a owl:Class ; owl:complementOf B ]', () => {
    const hasNegClassDecl = probe.probeQuads.some(
      (q) => q.predicate.value === RDF_TYPE_URI && q.object.value === OWL_CLASS_URI && q.subject.termType === 'BlankNode',
    );
    const hasComplement = probe.probeQuads.some(
      (q) => q.predicate.value === OWL_COMPLEMENT_OF_URI && q.object.value === B && q.subject.termType === 'BlankNode',
    );
    expect(hasNegClassDecl).toBe(true);
    expect(hasComplement).toBe(true);
  });

  it('asserts A rdfs:subClassOf ¬B (TBox negation) and a fresh witness instance of A', () => {
    // A ⊑ ¬B at the TBox level (subject is A, object is the complement blank node).
    const aSubOfNeg = probe.probeQuads.find(
      (q) =>
        q.subject.termType === 'NamedNode' &&
        q.subject.value === A &&
        q.predicate.value === RDFS_SUBCLASSOF_URI &&
        q.object.termType === 'BlankNode',
    );
    expect(aSubOfNeg).toBeTruthy();
    // A witness instance forcing A non-empty: _w rdf:type A.
    const witnessIntoA = probe.probeQuads.some(
      (q) => q.subject.termType === 'BlankNode' && q.predicate.value === RDF_TYPE_URI && q.object.value === A,
    );
    expect(witnessIntoA).toBe(true);
  });

  it('probeKeys match every produced quad exactly (so they can be stripped)', () => {
    for (const q of probe.probeQuads) {
      expect(probe.probeKeys.has(keyOfQuad(q))).toBe(true);
    }
    expect(probe.probeKeys.size).toBe(probe.probeQuads.length);
  });
});

describe('buildEntailmentProbe — rdf:type (x : C)', () => {
  const probe = buildEntailmentProbe<N3.Quad>(df, x, RDF_TYPE_URI, C, true);

  it('selects the type shape', () => {
    expect(probe.kind).toBe('type');
  });

  it('emits exactly 3 probe quads', () => {
    // [ a owl:Class ; owl:complementOf C ] (2) + x a ¬C (1)
    expect(probe.probeQuads).toHaveLength(3);
  });

  it('asserts the subject individual into ¬C', () => {
    const xIntoNeg = probe.probeQuads.some(
      (q) =>
        q.subject.termType === 'NamedNode' &&
        q.subject.value === x &&
        q.predicate.value === RDF_TYPE_URI &&
        q.object.termType === 'BlankNode',
    );
    expect(xIntoNeg).toBe(true);
  });

  it('probeKeys match every produced quad exactly', () => {
    for (const q of probe.probeQuads) {
      expect(probe.probeKeys.has(keyOfQuad(q))).toBe(true);
    }
  });
});

describe('buildEntailmentProbe — unsupported', () => {
  it('returns no probe for a literal object', () => {
    const probe = buildEntailmentProbe<N3.Quad>(df, A, RDFS_SUBCLASSOF_URI, B, false);
    expect(probe.kind).toBe('unsupported');
    expect(probe.probeQuads).toHaveLength(0);
    expect(probe.reason).toMatch(/literal/i);
  });

  it('returns no probe for an unsupported predicate', () => {
    const probe = buildEntailmentProbe<N3.Quad>(df, A, 'http://example.org/p', B, true);
    expect(probe.kind).toBe('unsupported');
    expect(probe.probeQuads).toHaveLength(0);
  });
});

describe('tripleKey', () => {
  it('joins with NUL separators', () => {
    expect(tripleKey('s', 'p', 'o')).toBe('s\0p\0o');
  });
});

describe('distinct probeId yields collision-free blank nodes', () => {
  it('two probes with different ids do not share witness/neg labels', () => {
    const p0 = buildEntailmentProbe<N3.Quad>(df, A, RDFS_SUBCLASSOF_URI, B, true, 'p0');
    const p1 = buildEntailmentProbe<N3.Quad>(df, A, RDFS_SUBCLASSOF_URI, B, true, 'p1');
    const labels0 = new Set(p0.probeQuads.flatMap((q) => [q.subject.value, q.object.value]).filter((v) => v.startsWith('vg_')));
    const labels1 = new Set(p1.probeQuads.flatMap((q) => [q.subject.value, q.object.value]).filter((v) => v.startsWith('vg_')));
    for (const l of labels0) expect(labels1.has(l)).toBe(false);
  });
});
