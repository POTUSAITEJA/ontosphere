// src/mcp/__tests__/computeRepairs.test.ts
// @vitest-environment node
//
// Pure unit tests for the hitting-set / ranking / SHACL repair core. No
// reasoner needed — every assertion is deterministic over hand-built MIPS.
import { describe, it, expect } from 'vitest';
import { computeRepairs, type RepairSuggestion } from '../tools/computeRepairs';
import type { DiagnosticsData } from '../tools/diagnosticsBrief';
import { mcpManifest } from '../manifest';

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const OWL_DISJOINT = 'http://www.w3.org/2002/07/owl#disjointWith';
const RDFS_SUBCLASS = 'http://www.w3.org/2000/01/rdf-schema#subClassOf';

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

const inconsistency = (justifications: DiagnosticsData['justifications'], rest: Partial<DiagnosticsData> = {}) =>
  base({ isConsistent: false, justifications, ...rest });

const keyOf = (r: RepairSuggestion) =>
  `${r.action.args.subjectIri} ${r.action.args.predicateIri} ${r.action.args.objectIri}`;

describe('computeRepairs — consistency gating', () => {
  it('returns no inconsistency repairs when isConsistent is true', () => {
    const repairs = computeRepairs(base({ isConsistent: true, justifications: [[ax(`${EX}a`, RDF_TYPE, `${EX}C`)]] }));
    expect(repairs.filter((r) => r.issue === 'inconsistency')).toHaveLength(0);
  });

  it('returns no repairs at all for a fully clean graph', () => {
    expect(computeRepairs(base({}))).toEqual([]);
  });
});

describe('computeRepairs — single MIPS hitting set', () => {
  const mips = [
    [
      ax(`${EX}frank`, RDF_TYPE, `${EX}Employee`),
      ax(`${EX}frank`, RDF_TYPE, `${EX}Contractor`),
      ax(`${EX}Employee`, OWL_DISJOINT, `${EX}Contractor`),
    ],
  ];

  it('produces a hitting set covering the single justification with >=1 repair', () => {
    const repairs = computeRepairs(inconsistency(mips));
    const inc = repairs.filter((r) => r.issue === 'inconsistency');
    expect(inc.length).toBeGreaterThanOrEqual(1);
    // every justification (index 0) must be covered by the union
    const covered = new Set<number>();
    inc.forEach((r) => r.justificationsCovered?.forEach((j) => covered.add(j)));
    expect(covered.has(0)).toBe(true);
  });

  it('a single MIPS is hit by exactly one axiom removal (minimal)', () => {
    const inc = computeRepairs(inconsistency(mips)).filter((r) => r.issue === 'inconsistency');
    expect(inc).toHaveLength(1);
  });

  it('prefers removing an ABox assertion (rdf:type) over the TBox disjointWith axiom', () => {
    const inc = computeRepairs(inconsistency(mips)).filter((r) => r.issue === 'inconsistency');
    expect(inc[0].action.args.predicateIri).toBe(RDF_TYPE);
    expect(inc[0].action.tool).toBe('removeLink'); // object is an IRI
  });

  it('each repair targets an axiom that actually appears in a justification', () => {
    const inc = computeRepairs(inconsistency(mips)).filter((r) => r.issue === 'inconsistency');
    const axiomKeys = new Set(mips.flat().map((a) => `${a.subject} ${a.predicate} ${a.object}`));
    for (const r of inc) expect(axiomKeys.has(keyOf(r))).toBe(true);
  });
});

describe('computeRepairs — overlapping MIPS (shared axiom)', () => {
  // Both justifications share the disjointWith axiom — removing it alone hits both.
  const shared = ax(`${EX}Employee`, OWL_DISJOINT, `${EX}Contractor`);
  const mips = [
    [ax(`${EX}frank`, RDF_TYPE, `${EX}Employee`), ax(`${EX}frank`, RDF_TYPE, `${EX}Contractor`), shared],
    [ax(`${EX}gina`, RDF_TYPE, `${EX}Employee`), ax(`${EX}gina`, RDF_TYPE, `${EX}Contractor`), shared],
  ];

  it('chooses the single shared axiom covering BOTH justifications', () => {
    const inc = computeRepairs(inconsistency(mips)).filter((r) => r.issue === 'inconsistency');
    // The minimal hitting set is the single shared disjointWith axiom.
    expect(inc).toHaveLength(1);
    expect(keyOf(inc[0])).toBe(`${shared.subject} ${shared.predicate} ${shared.object}`);
    expect(inc[0].justificationsCovered).toEqual([0, 1]);
  });

  it('top repair rationale mentions resolving both contradictions', () => {
    const inc = computeRepairs(inconsistency(mips)).filter((r) => r.issue === 'inconsistency');
    expect(inc[0].rationale).toContain('2 of the 2');
  });
});

describe('computeRepairs — disjoint MIPS (no shared axioms)', () => {
  const mips = [
    [ax(`${EX}a`, RDF_TYPE, `${EX}X`), ax(`${EX}a`, RDF_TYPE, `${EX}Y`)],
    [ax(`${EX}b`, RDF_TYPE, `${EX}P`), ax(`${EX}b`, RDF_TYPE, `${EX}Q`)],
  ];

  it('needs one removal per disjoint justification', () => {
    const inc = computeRepairs(inconsistency(mips)).filter((r) => r.issue === 'inconsistency');
    expect(inc).toHaveLength(2);
    const covered = new Set<number>();
    inc.forEach((r) => r.justificationsCovered?.forEach((j) => covered.add(j)));
    expect([...covered].sort()).toEqual([0, 1]);
  });

  it('each disjoint repair covers exactly one justification', () => {
    const inc = computeRepairs(inconsistency(mips)).filter((r) => r.issue === 'inconsistency');
    for (const r of inc) expect(r.justificationsCovered).toHaveLength(1);
  });
});

describe('computeRepairs — ranking order', () => {
  it('ranks the higher-coverage axiom first even against an ABox alternative', () => {
    const shared = ax(`${EX}P`, RDFS_SUBCLASS, `${EX}Q`); // TBox, but covers 2
    const mips = [
      [shared, ax(`${EX}a`, RDF_TYPE, `${EX}X`)],
      [shared, ax(`${EX}b`, RDF_TYPE, `${EX}Y`)],
    ];
    const inc = computeRepairs(inconsistency(mips)).filter((r) => r.issue === 'inconsistency');
    // coverage (2) beats least-destructive: the shared subClassOf axiom wins despite being TBox.
    expect(keyOf(inc[0])).toBe(`${shared.subject} ${shared.predicate} ${shared.object}`);
    expect(inc[0].justificationsCovered).toEqual([0, 1]);
  });

  it('breaks coverage ties by preferring the less-destructive (ABox) axiom', () => {
    // One justification, two candidates with equal coverage: a TBox disjointWith
    // and an ABox rdf:type. The ABox assertion should be selected.
    const mips = [
      [
        ax(`${EX}Employee`, OWL_DISJOINT, `${EX}Contractor`),
        ax(`${EX}frank`, RDF_TYPE, `${EX}Employee`),
      ],
    ];
    const inc = computeRepairs(inconsistency(mips)).filter((r) => r.issue === 'inconsistency');
    expect(inc[0].action.args.predicateIri).toBe(RDF_TYPE);
  });

  it('assigns stable sequential ids R1, R2 for disjoint MIPS', () => {
    const mips = [
      [ax(`${EX}a`, RDF_TYPE, `${EX}X`), ax(`${EX}a`, RDF_TYPE, `${EX}Y`)],
      [ax(`${EX}b`, RDF_TYPE, `${EX}P`), ax(`${EX}b`, RDF_TYPE, `${EX}Q`)],
    ];
    const inc = computeRepairs(inconsistency(mips)).filter((r) => r.issue === 'inconsistency');
    expect(inc.map((r) => r.id)).toEqual(['R1', 'R2']);
  });

  it('is deterministic — identical input yields identical output', () => {
    const mips = [
      [ax(`${EX}a`, RDF_TYPE, `${EX}X`), ax(`${EX}Employee`, OWL_DISJOINT, `${EX}Contractor`)],
    ];
    const a = computeRepairs(inconsistency(mips));
    const b = computeRepairs(inconsistency(mips));
    expect(a).toEqual(b);
  });
});

describe('computeRepairs — unsatisfiable-class tie-break', () => {
  it('prefers an axiom touching an unsatisfiable class when coverage & destructiveness tie', () => {
    // Two ABox rdf:type assertions, equal coverage; only the second touches the
    // unsatisfiable class Empty. Note the chosen object IRI is not the unsat one
    // here — the SUBJECT touches it via subject membership.
    const mips = [
      [
        ax(`${EX}plain`, RDF_TYPE, `${EX}Thing`),
        ax(`${EX}member`, RDF_TYPE, `${EX}Empty`),
      ],
    ];
    const inc = computeRepairs(
      inconsistency(mips, { unsatisfiableClasses: [`${EX}Empty`] }),
    ).filter((r) => r.issue === 'inconsistency');
    expect(inc[0].action.args.objectIri).toBe(`${EX}Empty`);
  });
});

describe('computeRepairs — SHACL candidates', () => {
  const shaclData = base({
    shaclViolations: [
      {
        focusNode: `${EX}projectAlpha`,
        path: 'http://www.w3.org/2000/01/rdf-schema#comment',
        severity: 'sh:Violation',
        message: 'missing rdfs:comment',
        sourceShape: `${EX}S`,
        constraint: 'http://www.w3.org/ns/shacl#MinCountConstraintComponent',
      },
    ],
  });

  it('emits an addTriple candidate with needsValue for an actionable violation', () => {
    const repairs = computeRepairs(shaclData);
    const shacl = repairs.filter((r) => r.issue === 'shacl');
    expect(shacl).toHaveLength(1);
    expect(shacl[0].action.tool).toBe('addTriple');
    expect(shacl[0].action.args.subjectIri).toBe(`${EX}projectAlpha`);
    expect(shacl[0].action.args.predicateIri).toBe('http://www.w3.org/2000/01/rdf-schema#comment');
    expect(shacl[0].action.args.objectValue).toBeUndefined();
    expect(shacl[0].needsValue).toBe(true);
  });

  it('skips violations without a focusNode or path (not actionable)', () => {
    const d = base({
      shaclViolations: [
        { focusNode: null, path: 'http://ex/p', severity: 'sh:Violation', message: null, sourceShape: null, constraint: null },
        { focusNode: `${EX}n`, path: null, severity: 'sh:Violation', message: null, sourceShape: null, constraint: null },
      ],
    });
    expect(computeRepairs(d).filter((r) => r.issue === 'shacl')).toHaveLength(0);
  });

  it('assigns sequential S-prefixed ids', () => {
    const d = base({
      shaclViolations: [
        { focusNode: `${EX}a`, path: `${EX}p`, severity: 'sh:Violation', message: null, sourceShape: null, constraint: null },
        { focusNode: `${EX}b`, path: `${EX}q`, severity: 'sh:Violation', message: null, sourceShape: null, constraint: null },
      ],
    });
    expect(computeRepairs(d).map((r) => r.id)).toEqual(['S1', 'S2']);
  });
});

describe('computeRepairs — H1: every emitted action.tool is a registered MCP tool', () => {
  // The set of tools actually registered with the MCP server. The manifest is
  // CI-enforced (scripts/check-mcp-json.mjs) to match the handler registry in
  // ontosphereMcpServer.ts, so membership here == a real, callable tool.
  const REGISTERED_TOOLS = new Set(mcpManifest.map((t) => t.name));

  it('manifest contains removeLink and addTriple but NOT removeTriple (guards the H1 regression)', () => {
    expect(REGISTERED_TOOLS.has('removeLink')).toBe(true);
    expect(REGISTERED_TOOLS.has('addTriple')).toBe(true);
    // removeTriple is NOT a registered MCP tool — emitting it would be a bug.
    expect(REGISTERED_TOOLS.has('removeTriple')).toBe(false);
  });

  it('IRI-object MIPS: action.tool is removeLink and is registered', () => {
    const mips = [
      [
        ax(`${EX}frank`, RDF_TYPE, `${EX}Employee`),
        ax(`${EX}frank`, RDF_TYPE, `${EX}Contractor`),
        ax(`${EX}Employee`, OWL_DISJOINT, `${EX}Contractor`),
      ],
    ];
    const inc = computeRepairs(inconsistency(mips)).filter((r) => r.issue === 'inconsistency');
    expect(inc.length).toBeGreaterThanOrEqual(1);
    for (const r of inc) {
      expect(r.action.tool).toBe('removeLink');
      expect(REGISTERED_TOOLS.has(r.action.tool)).toBe(true);
    }
  });

  it('literal-object MIPS: action.tool is removeLink (not removeTriple) and is registered', () => {
    // A literal object (e.g. a datatype clash on a functional property). The
    // axiom object is a literal lexical value, not an IRI.
    const FUNCTIONAL = 'http://www.w3.org/2002/07/owl#FunctionalProperty';
    const mips = [
      [
        ax(`${EX}age`, RDF_TYPE, FUNCTIONAL),
        ax(`${EX}bob`, `${EX}age`, '30'),
        ax(`${EX}bob`, `${EX}age`, '40'),
      ],
    ];
    const inc = computeRepairs(inconsistency(mips)).filter((r) => r.issue === 'inconsistency');
    expect(inc.length).toBeGreaterThanOrEqual(1);
    // At least one chosen repair removes a literal-object assertion.
    const literalRepair = inc.find((r) => /^\d+$/.test(r.action.args.objectIri ?? ''));
    expect(literalRepair).toBeDefined();
    for (const r of inc) {
      expect(r.action.tool).toBe('removeLink');
      expect(REGISTERED_TOOLS.has(r.action.tool)).toBe(true);
    }
  });

  it('ALL emitted action.tools (inconsistency + SHACL) are members of the registered tool set', () => {
    // Exercise a graph with both inconsistency and SHACL repairs.
    const d = inconsistency(
      [
        [ax(`${EX}a`, RDF_TYPE, `${EX}X`), ax(`${EX}a`, RDF_TYPE, `${EX}Y`)],
        [ax(`${EX}bob`, `${EX}age`, '30'), ax(`${EX}bob`, `${EX}age`, '40'), ax(`${EX}age`, RDF_TYPE, 'http://www.w3.org/2002/07/owl#FunctionalProperty')],
      ],
      {
        shaclViolations: [
          { focusNode: `${EX}n`, path: `${EX}p`, severity: 'sh:Violation', message: null, sourceShape: null, constraint: null },
        ],
      },
    );
    const repairs = computeRepairs(d);
    expect(repairs.length).toBeGreaterThan(0);
    for (const r of repairs) {
      // needsManualReview markers also carry a registered tool name.
      expect(REGISTERED_TOOLS.has(r.action.tool)).toBe(true);
    }
  });
});

describe('computeRepairs — M4: degenerate / empty MIPS', () => {
  it('an empty inner MIPS [[]] yields a needsManualReview marker, not silent zero repairs', () => {
    const repairs = computeRepairs(inconsistency([[]])).filter((r) => r.issue === 'inconsistency');
    expect(repairs).toHaveLength(1);
    const marker = repairs[0];
    expect(marker.needsManualReview).toBe(true);
    expect(marker.justificationsCovered).toEqual([0]);
    // The marker carries a registered tool name and an explanatory rationale.
    expect(marker.rationale.toLowerCase()).toContain('manual');
  });

  it('isConsistent:false with [] (no justifications) yields no inconsistency repairs', () => {
    const repairs = computeRepairs(inconsistency([])).filter((r) => r.issue === 'inconsistency');
    expect(repairs).toHaveLength(0);
  });

  it('a mix of a real MIPS and a degenerate empty MIPS yields a real repair + a marker', () => {
    const d = inconsistency([
      [ax(`${EX}a`, RDF_TYPE, `${EX}X`), ax(`${EX}a`, RDF_TYPE, `${EX}Y`)],
      [], // degenerate
    ]);
    const inc = computeRepairs(d).filter((r) => r.issue === 'inconsistency');
    const real = inc.filter((r) => !r.needsManualReview);
    const markers = inc.filter((r) => r.needsManualReview);
    expect(real.length).toBeGreaterThanOrEqual(1);
    expect(markers).toHaveLength(1);
    expect(markers[0].justificationsCovered).toEqual([1]);
  });
});

describe('computeRepairs — C1: source graph threaded into action.args', () => {
  it('carries graph=urn:vg:ontologies for an axiom that lives in the imported ontology graph', () => {
    // The covering axiom (subClassOf) physically resides in urn:vg:ontologies.
    const mips: DiagnosticsData['justifications'] = [
      [
        {
          subject: `${EX}A`,
          predicate: OWL_DISJOINT,
          object: `${EX}B`,
          objectTermType: 'NamedNode',
          graph: 'urn:vg:ontologies',
        },
      ],
    ];
    const inc = computeRepairs(inconsistency(mips)).filter((r) => r.issue === 'inconsistency');
    expect(inc).toHaveLength(1);
    // The graph is threaded onto the action so the apply path hits the right graph.
    expect(inc[0].action.args.graph).toBe('urn:vg:ontologies');
  });

  it('omits graph when the axiom carries none (back-compat: defaults to data graph downstream)', () => {
    const mips = [[ax(`${EX}a`, RDF_TYPE, `${EX}X`), ax(`${EX}a`, RDF_TYPE, `${EX}Y`)]];
    const inc = computeRepairs(inconsistency(mips)).filter((r) => r.issue === 'inconsistency');
    expect(inc[0].action.args.graph).toBeUndefined();
  });
});

describe('computeRepairs — H2: literal datatype/language threaded into action.args', () => {
  const XSD_INT = 'http://www.w3.org/2001/XMLSchema#integer';

  it('threads objectTermType + objectDatatype for a typed-literal object', () => {
    const mips: DiagnosticsData['justifications'] = [
      [
        {
          subject: `${EX}i`,
          predicate: `${EX}age`,
          object: '42',
          objectTermType: 'Literal',
          objectDatatype: XSD_INT,
        },
      ],
    ];
    const inc = computeRepairs(inconsistency(mips)).filter((r) => r.issue === 'inconsistency');
    expect(inc[0].action.args.objectTermType).toBe('Literal');
    expect(inc[0].action.args.objectDatatype).toBe(XSD_INT);
    expect(inc[0].action.args.objectLanguage).toBeUndefined();
  });

  it('keeps two same-lexical literals with DIFFERENT datatypes as distinct repairs', () => {
    // "42"^^xsd:integer in one justification, "42"^^xsd:string in another: the
    // axiomKey must NOT merge them (they are distinct RDF terms / distinct fixes).
    const XSD_STR = 'http://www.w3.org/2001/XMLSchema#string';
    const mips: DiagnosticsData['justifications'] = [
      [
        { subject: `${EX}i`, predicate: `${EX}v`, object: '42', objectTermType: 'Literal', objectDatatype: XSD_INT },
      ],
      [
        { subject: `${EX}i`, predicate: `${EX}v`, object: '42', objectTermType: 'Literal', objectDatatype: XSD_STR },
      ],
    ];
    const inc = computeRepairs(inconsistency(mips)).filter((r) => r.issue === 'inconsistency');
    // Two distinct repairs, one per typed literal.
    expect(inc).toHaveLength(2);
    const datatypes = inc.map((r) => r.action.args.objectDatatype).sort();
    expect(datatypes).toEqual([XSD_INT, XSD_STR].sort());
  });

  it('threads objectLanguage for a language-tagged literal', () => {
    const mips: DiagnosticsData['justifications'] = [
      [
        {
          subject: `${EX}i`,
          predicate: `${EX}label`,
          object: 'hello',
          objectTermType: 'Literal',
          objectLanguage: 'en',
        },
      ],
    ];
    const inc = computeRepairs(inconsistency(mips)).filter((r) => r.issue === 'inconsistency');
    expect(inc[0].action.args.objectTermType).toBe('Literal');
    expect(inc[0].action.args.objectLanguage).toBe('en');
  });
});

describe('computeRepairs — combined inconsistency + SHACL', () => {
  it('returns inconsistency repairs first, then SHACL repairs', () => {
    const d = inconsistency([[ax(`${EX}a`, RDF_TYPE, `${EX}X`), ax(`${EX}a`, RDF_TYPE, `${EX}Y`)]], {
      shaclViolations: [
        { focusNode: `${EX}n`, path: `${EX}p`, severity: 'sh:Violation', message: null, sourceShape: null, constraint: null },
      ],
    });
    const repairs = computeRepairs(d);
    expect(repairs[0].issue).toBe('inconsistency');
    expect(repairs[repairs.length - 1].issue).toBe('shacl');
  });
});
