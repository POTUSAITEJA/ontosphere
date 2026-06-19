// src/mcp/__tests__/diagnostics.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockRunReasoning,
  mockExplainInconsistency,
  mockRunShacl,
  mockSparql,
  mockFetchQuadsPage,
} = vi.hoisted(() => ({
  mockRunReasoning: vi.fn(),
  mockExplainInconsistency: vi.fn(),
  mockRunShacl: vi.fn(),
  mockSparql: vi.fn(),
  mockFetchQuadsPage: vi.fn(),
}));

vi.mock('@/utils/rdfManager', () => ({
  rdfManager: {
    runReasoning: mockRunReasoning,
    explainInconsistency: mockExplainInconsistency,
    runShaclValidation: mockRunShacl,
    sparqlQuery: mockSparql,
    fetchQuadsPage: mockFetchQuadsPage,
  },
}));

// reasoning.ts also imports these — keep them inert for this suite.
vi.mock('@/mcp/workspaceContext', () => ({ getWorkspaceRefs: vi.fn(() => ({ ctx: {}, dataProvider: {} })) }));
vi.mock('@/stores/appConfigStore', () => ({
  useAppConfigStore: { getState: vi.fn(() => ({ config: { shaclEnabled: true }, setShaclEnabled: vi.fn() })) },
}));

import { reasoningTools } from '../tools/reasoning';

const explainDiagnostics = reasoningTools.find((t) => t.name === 'explainDiagnostics')!;

beforeEach(() => {
  vi.clearAllMocks();
  // sensible "clean" defaults; individual tests override.
  mockRunReasoning.mockResolvedValue({ isConsistent: true, errors: [] });
  mockExplainInconsistency.mockResolvedValue([]);
  mockRunShacl.mockResolvedValue({ conforms: true, violations: [], shapeCount: 0 });
  mockSparql.mockResolvedValue([]);
  mockFetchQuadsPage.mockResolvedValue({ items: [] });
});

describe('explainDiagnostics', () => {
  it('is registered', () => {
    expect(explainDiagnostics).toBeTruthy();
  });

  it('clean graph → consistent, no issues, "No issues detected." brief', async () => {
    const res = await explainDiagnostics.handler({});
    expect(res.success).toBe(true);
    expect(res.data.isConsistent).toBe(true);
    expect(res.data.justifications).toEqual([]);
    expect(res.data.repairBrief).toBe('No issues detected.');
    // does not call explainInconsistency when consistent
    expect(mockExplainInconsistency).not.toHaveBeenCalled();
  });

  it('inconsistent graph → returns justifications and a clash brief', async () => {
    mockRunReasoning.mockResolvedValue({ isConsistent: false, errors: [] });
    mockExplainInconsistency.mockResolvedValue([
      [
        { subject: 'http://ex/frank', predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', object: 'http://ex/Employee' },
        { subject: 'http://ex/Employee', predicate: 'http://www.w3.org/2002/07/owl#disjointWith', object: 'http://ex/Contractor' },
      ],
    ]);
    const res = await explainDiagnostics.handler({ maxJustifications: 2 });
    expect(res.success).toBe(true);
    expect(res.data.isConsistent).toBe(false);
    expect(res.data.justifications).toHaveLength(1);
    expect(res.data.justifications[0]).toHaveLength(2);
    expect(mockExplainInconsistency).toHaveBeenCalledWith(2);
    expect(res.data.repairBrief.toLowerCase()).toContain('disjointwith');
  });

  it('unsatisfiable class from SPARQL is reported', async () => {
    mockSparql.mockResolvedValue([{ c: { value: 'http://ex/EmptyClass' } }]);
    const res = await explainDiagnostics.handler({});
    expect(res.data.unsatisfiableClasses).toContain('http://ex/EmptyClass');
    expect(res.data.repairBrief).toContain('EmptyClass');
  });

  it('OWL 2 profile violation (literal on object property) is reported', async () => {
    mockFetchQuadsPage.mockResolvedValue({
      items: [
        // ex:knows declared an object property
        { subject: { value: 'http://ex/knows' }, predicate: { value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' }, object: { value: 'http://www.w3.org/2002/07/owl#ObjectProperty', termType: 'NamedNode' } },
        // ...but used with a literal object
        { subject: { value: 'http://ex/a' }, predicate: { value: 'http://ex/knows' }, object: { value: '42', termType: 'Literal' } },
      ],
    });
    const res = await explainDiagnostics.handler({});
    expect(res.data.profile.owl2dl).toBe(false);
    expect(res.data.profile.violations.length).toBeGreaterThan(0);
    expect(res.data.repairBrief).toContain('OWL 2 DL PROFILE');
  });

  it('SHACL violation is reported', async () => {
    mockRunShacl.mockResolvedValue({
      conforms: false,
      violations: [{ focusNode: 'http://ex/projectAlpha', path: null, severity: 'sh:Violation', message: 'missing rdfs:comment', sourceShape: 'http://ex/S', constraint: 'http://www.w3.org/ns/shacl#MinCountConstraintComponent' }],
      shapeCount: 1,
    });
    const res = await explainDiagnostics.handler({});
    expect(res.data.shaclViolations).toHaveLength(1);
    expect(res.data.repairBrief).toContain('projectAlpha');
  });

  it('returns success:false with context on internal error', async () => {
    mockRunReasoning.mockRejectedValue(new Error('worker boom'));
    const res = await explainDiagnostics.handler({});
    expect(res.success).toBe(false);
    expect(res.error).toContain('explainDiagnostics');
    expect(res.error).toContain('worker boom');
  });
});
