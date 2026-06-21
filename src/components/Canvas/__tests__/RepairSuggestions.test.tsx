// src/components/Canvas/__tests__/RepairSuggestions.test.tsx
//
// Verifies the human "Apply repair" UI: it computes suggestions via the SAME
// pure `computeRepairs` function the agent path uses, renders the rationale +
// triple, and that clicking "Apply fix" performs the correct rdfManager
// mutation and surfaces an undoable toast. Also covers "Apply all verified".

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// --- mocks (declared before importing the component under test) ---

const hoisted = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  }),
  rdf: {
    explainInconsistency: vi.fn(),
    getUnsatisfiableClasses: vi.fn(),
    runShaclValidation: vi.fn(),
    verifyRepair: vi.fn(),
    removeTriple: vi.fn(),
    addTriple: vi.fn(),
    applyBatch: vi.fn(),
  },
  runReasoning: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: hoisted.toast }));

// Keep term display deterministic and dependency-free.
vi.mock('../../../utils/termUtils', () => ({
  toPrefixed: (iri: string) => iri,
}));

vi.mock('../../../utils/rdfManager', () => ({
  rdfManager: hoisted.rdf,
}));

vi.mock('@/mcp/workspaceContext', () => ({
  getWorkspaceRefs: () => ({ runReasoning: hoisted.runReasoning }),
}));

import { RepairSuggestions } from '../RepairSuggestions';
import { computeRepairs } from '../../../mcp/tools/computeRepairs';

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const OWL_DISJOINT = 'http://www.w3.org/2002/07/owl#disjointWith';

const EX = 'http://ex/';

// A single contradiction: individual i is typed as both A and B, and A
// owl:disjointWith B. The least-destructive repair removes one ABox type
// assertion (not the TBox disjointWith axiom).
const JUSTIFICATION = [
  [
    { subject: `${EX}i`, predicate: RDF_TYPE, object: `${EX}A` },
    { subject: `${EX}i`, predicate: RDF_TYPE, object: `${EX}B` },
    { subject: `${EX}A`, predicate: OWL_DISJOINT, object: `${EX}B` },
  ],
];

function primeConsistentInconsistency() {
  hoisted.rdf.explainInconsistency.mockResolvedValue(JUSTIFICATION);
  hoisted.rdf.getUnsatisfiableClasses.mockResolvedValue([]);
  hoisted.rdf.runShaclValidation.mockResolvedValue({ conforms: true, violations: [], shapeCount: 0 });
  // Removing the single repair restores consistency.
  hoisted.rdf.verifyRepair.mockResolvedValue(true);
  hoisted.rdf.applyBatch.mockResolvedValue({ added: 0, removed: 1 });
}

describe('RepairSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the suggestion with its rationale (same as computeRepairs)', async () => {
    primeConsistentInconsistency();
    // The UI must surface exactly what the shared pure function produces.
    const expected = computeRepairs({
      isConsistent: false,
      justifications: JUSTIFICATION,
      unsatisfiableClasses: [],
      profile: { owl2dl: true, violations: [] },
      shaclViolations: [],
    });
    expect(expected.length).toBeGreaterThan(0);

    render(<RepairSuggestions reasoningId="r1" isConsistent={false} />);

    await waitFor(() => {
      expect(screen.getByText(expected[0].rationale)).toBeTruthy();
    });
    // The repair id badge is shown.
    expect(screen.getByText(expected[0].id)).toBeTruthy();
  });

  it('Apply fix routes the removal through applyBatch (confirming the delta) and shows an undoable toast', async () => {
    primeConsistentInconsistency();
    const expected = computeRepairs({
      isConsistent: false,
      justifications: JUSTIFICATION,
      unsatisfiableClasses: [],
      profile: { owl2dl: true, violations: [] },
      shaclViolations: [],
    });
    const repair = expected[0];

    render(<RepairSuggestions reasoningId="r1" isConsistent={false} />);

    const applyBtn = await screen.findByRole('button', { name: /Apply repair/i });
    fireEvent.click(applyBtn);

    // H1: the apply goes through applyBatch (which returns the REAL removed
    // delta), NOT the fire-and-forget removeTriple.
    await waitFor(() => {
      expect(hoisted.rdf.applyBatch).toHaveBeenCalled();
    });
    const [changes, graph] = hoisted.rdf.applyBatch.mock.calls[0];
    // C1: the IRI-object justification lives in the (default) data graph here.
    expect(graph).toBe('urn:vg:data');
    expect(changes.removes.length).toBe(1);
    expect(changes.removes[0].subject).toBe(repair.action.args.subjectIri);
    expect(changes.removes[0].predicate).toBe(repair.action.args.predicateIri);
    expect(changes.removes[0].object).toBe(repair.action.args.objectIri);

    // A success toast with an Undo action was shown (since removed >= 1).
    await waitFor(() => expect(hoisted.toast.success).toHaveBeenCalled());
    const call = hoisted.toast.success.mock.calls.find((c) => c[1] && c[1].action);
    expect(call).toBeTruthy();
    expect(call![1].action.label).toBe('Undo');

    // Invoking Undo re-adds the removed triple via applyBatch (same graph).
    hoisted.rdf.applyBatch.mockClear();
    await call![1].action.onClick();
    expect(hoisted.rdf.applyBatch).toHaveBeenCalled();
    const [undoChanges, undoGraph] = hoisted.rdf.applyBatch.mock.calls[0];
    expect(undoGraph).toBe('urn:vg:data');
    expect(undoChanges.adds.length).toBe(1);
    expect(undoChanges.removes).toEqual([]);
  });

  it('C1: applies a justification axiom located in urn:vg:ontologies to THAT graph (not hardcoded urn:vg:data)', async () => {
    // The disjointWith TBox axiom is the only available repair when the two type
    // assertions are pinned via a separate consistency setup; here we force a
    // single-axiom justification whose axiom carries graph='urn:vg:ontologies'.
    const ontologyGraphJustif = [
      [
        // The covering axiom physically resides in the imported ontology graph.
        {
          subject: `${EX}A`,
          predicate: OWL_DISJOINT,
          object: `${EX}B`,
          objectTermType: 'NamedNode',
          graph: 'urn:vg:ontologies',
        },
      ],
    ];
    hoisted.rdf.explainInconsistency.mockResolvedValue(ontologyGraphJustif);
    hoisted.rdf.getUnsatisfiableClasses.mockResolvedValue([]);
    hoisted.rdf.runShaclValidation.mockResolvedValue({ conforms: true, violations: [], shapeCount: 0 });
    hoisted.rdf.verifyRepair.mockResolvedValue(true);
    // Simulate a store where the quad EXISTS in urn:vg:ontologies: a data-graph
    // removal returns {removed:0}; an ontologies-graph removal returns {removed:1}.
    hoisted.rdf.applyBatch.mockImplementation((changes: { removes?: { graph?: string }[] }, fallback: string) => {
      const g = changes.removes?.[0]?.graph ?? fallback;
      return Promise.resolve({ added: 0, removed: g === 'urn:vg:ontologies' ? 1 : 0 });
    });

    // Confirm computeRepairs threads the graph into action.args.graph.
    const expected = computeRepairs({
      isConsistent: false,
      justifications: ontologyGraphJustif,
      unsatisfiableClasses: [],
      profile: { owl2dl: true, violations: [] },
      shaclViolations: [],
    });
    expect(expected[0].action.args.graph).toBe('urn:vg:ontologies');

    render(<RepairSuggestions reasoningId="rc1" isConsistent={false} />);
    const applyBtn = await screen.findByRole('button', { name: /Apply repair/i });
    fireEvent.click(applyBtn);

    await waitFor(() => expect(hoisted.rdf.applyBatch).toHaveBeenCalled());
    const [changes, fallbackGraph] = hoisted.rdf.applyBatch.mock.calls[0];
    // The removal targets the ontologies graph (a data-graph apply would no-op).
    expect(changes.removes[0].graph).toBe('urn:vg:ontologies');
    expect(fallbackGraph).toBe('urn:vg:ontologies');
    // removed >= 1 ⇒ success, NOT a warning.
    await waitFor(() => expect(hoisted.toast.success).toHaveBeenCalled());
    expect(hoisted.toast.warning).not.toHaveBeenCalled();
  });

  it('H1: a repair that matches 0 triples shows a warning and does NOT mark applied', async () => {
    primeConsistentInconsistency();
    // Override: applyBatch reports nothing was removed (graph/serialization miss).
    hoisted.rdf.applyBatch.mockResolvedValue({ added: 0, removed: 0 });

    render(<RepairSuggestions reasoningId="rh1" isConsistent={false} />);
    const applyBtn = await screen.findByRole('button', { name: /Apply repair/i });
    fireEvent.click(applyBtn);

    await waitFor(() => expect(hoisted.rdf.applyBatch).toHaveBeenCalled());
    // A warning is shown and success is NOT.
    await waitFor(() => expect(hoisted.toast.warning).toHaveBeenCalled());
    expect(hoisted.toast.success).not.toHaveBeenCalled();
    // The button is NOT switched to "Applied".
    expect(screen.queryByText(/^Applied$/)).toBeNull();
  });

  it('H2: a typed-literal repair is applied with its exact datatype reconstructed', async () => {
    const XSD_INT = 'http://www.w3.org/2001/XMLSchema#integer';
    const EX_AGE = `${EX}age`;
    // A justification whose covering axiom has a typed literal object "42"^^xsd:integer.
    const literalJustif = [
      [
        {
          subject: `${EX}i`,
          predicate: EX_AGE,
          object: '42',
          objectTermType: 'Literal',
          objectDatatype: XSD_INT,
          graph: 'urn:vg:data',
        },
      ],
    ];
    hoisted.rdf.explainInconsistency.mockResolvedValue(literalJustif);
    hoisted.rdf.getUnsatisfiableClasses.mockResolvedValue([]);
    hoisted.rdf.runShaclValidation.mockResolvedValue({ conforms: true, violations: [], shapeCount: 0 });
    hoisted.rdf.verifyRepair.mockResolvedValue(true);
    hoisted.rdf.applyBatch.mockResolvedValue({ added: 0, removed: 1 });

    // computeRepairs threads the datatype/termType into action.args.
    const expected = computeRepairs({
      isConsistent: false,
      justifications: literalJustif,
      unsatisfiableClasses: [],
      profile: { owl2dl: true, violations: [] },
      shaclViolations: [],
    });
    expect(expected[0].action.args.objectTermType).toBe('Literal');
    expect(expected[0].action.args.objectDatatype).toBe(XSD_INT);

    render(<RepairSuggestions reasoningId="rh2" isConsistent={false} />);

    // BUG B: VERIFY must target the SAME typed-literal triple APPLY removes. The
    // verifyRepair call (fired on load) carries objectTermType + datatype + graph,
    // so it cannot "succeed" against a same-lexical "42" string sibling.
    await waitFor(() => expect(hoisted.rdf.verifyRepair).toHaveBeenCalled());
    const verifyRemovals = hoisted.rdf.verifyRepair.mock.calls[0][0];
    expect(verifyRemovals[0]).toMatchObject({
      subject: `${EX}i`,
      predicate: EX_AGE,
      object: '42',
      objectTermType: 'Literal',
      objectDatatype: XSD_INT,
      graph: 'urn:vg:data',
    });

    const applyBtn = await screen.findByRole('button', { name: /Apply repair/i });
    fireEvent.click(applyBtn);

    await waitFor(() => expect(hoisted.rdf.applyBatch).toHaveBeenCalled());
    const [changes] = hoisted.rdf.applyBatch.mock.calls[0];
    // The object is passed as a structured literal term carrying the datatype,
    // so the worker matches "42"^^xsd:integer EXACTLY (not a same-lexical sibling).
    const obj = changes.removes[0].object;
    expect(typeof obj).toBe('object');
    expect(obj.value).toBe('42');
    expect(obj.type).toBe('literal');
    expect(obj.datatype).toBe(XSD_INT);
  });

  it('Apply all verified applies the full repair set in one batch', async () => {
    // Two independent contradictions → two removeLink repairs in the hitting set.
    const twoJustifs = [
      [
        { subject: `${EX}i`, predicate: RDF_TYPE, object: `${EX}A` },
        { subject: `${EX}A`, predicate: OWL_DISJOINT, object: `${EX}B` },
        { subject: `${EX}i`, predicate: RDF_TYPE, object: `${EX}B` },
      ],
      [
        { subject: `${EX}j`, predicate: RDF_TYPE, object: `${EX}C` },
        { subject: `${EX}C`, predicate: OWL_DISJOINT, object: `${EX}D` },
        { subject: `${EX}j`, predicate: RDF_TYPE, object: `${EX}D` },
      ],
    ];
    hoisted.rdf.explainInconsistency.mockResolvedValue(twoJustifs);
    hoisted.rdf.getUnsatisfiableClasses.mockResolvedValue([]);
    hoisted.rdf.runShaclValidation.mockResolvedValue({ conforms: true, violations: [], shapeCount: 0 });
    // Each single removal does NOT restore consistency, but the full set does.
    hoisted.rdf.verifyRepair.mockImplementation((removals: { subject: string }[]) =>
      Promise.resolve(removals.length > 1),
    );
    hoisted.rdf.applyBatch.mockResolvedValue({ added: 0, removed: 2 });

    render(<RepairSuggestions reasoningId="r2" isConsistent={false} />);

    const applyAllBtn = await screen.findByRole('button', { name: /Apply all verified repairs/i });
    fireEvent.click(applyAllBtn);

    await waitFor(() => {
      expect(hoisted.rdf.applyBatch).toHaveBeenCalled();
    });
    const [changes, graph] = hoisted.rdf.applyBatch.mock.calls[0];
    expect(graph).toBe('urn:vg:data');
    expect(Array.isArray(changes.removes)).toBe(true);
    expect(changes.removes.length).toBe(2);
    expect(changes.adds).toEqual([]);
  });

  it('FIX1: a fast double-click on "Apply fix" applies the repair only once', async () => {
    primeConsistentInconsistency();
    // applyBatch is held open so the second click lands while the first call is
    // still in flight (isApplied has not flipped yet).
    let resolveApply: (v: { added: number; removed: number }) => void = () => {};
    const applyPromise = new Promise<{ added: number; removed: number }>((res) => {
      resolveApply = res;
    });
    hoisted.rdf.applyBatch.mockReturnValue(applyPromise);

    render(<RepairSuggestions reasoningId="rf1" isConsistent={false} />);
    const applyBtn = await screen.findByRole('button', { name: /Apply repair/i });

    // Two rapid clicks before the first applyBatch resolves.
    fireEvent.click(applyBtn);
    fireEvent.click(applyBtn);

    // The in-flight guard rejected the second click synchronously.
    expect(hoisted.rdf.applyBatch).toHaveBeenCalledTimes(1);

    // Resolve the first apply; still exactly one call (no late second fire).
    resolveApply({ added: 0, removed: 1 });
    await waitFor(() => expect(hoisted.toast.success).toHaveBeenCalled());
    expect(hoisted.rdf.applyBatch).toHaveBeenCalledTimes(1);
    // No misleading "matched no triples" warning for a repair that succeeded.
    expect(hoisted.toast.warning).not.toHaveBeenCalled();
  });

  it('FIX1: a fast double-click on "Apply all verified" applies the set only once', async () => {
    const twoJustifs = [
      [
        { subject: `${EX}i`, predicate: RDF_TYPE, object: `${EX}A` },
        { subject: `${EX}A`, predicate: OWL_DISJOINT, object: `${EX}B` },
        { subject: `${EX}i`, predicate: RDF_TYPE, object: `${EX}B` },
      ],
      [
        { subject: `${EX}j`, predicate: RDF_TYPE, object: `${EX}C` },
        { subject: `${EX}C`, predicate: OWL_DISJOINT, object: `${EX}D` },
        { subject: `${EX}j`, predicate: RDF_TYPE, object: `${EX}D` },
      ],
    ];
    hoisted.rdf.explainInconsistency.mockResolvedValue(twoJustifs);
    hoisted.rdf.getUnsatisfiableClasses.mockResolvedValue([]);
    hoisted.rdf.runShaclValidation.mockResolvedValue({ conforms: true, violations: [], shapeCount: 0 });
    hoisted.rdf.verifyRepair.mockImplementation((removals: { subject: string }[]) =>
      Promise.resolve(removals.length > 1),
    );
    let resolveApply: (v: { added: number; removed: number }) => void = () => {};
    const applyPromise = new Promise<{ added: number; removed: number }>((res) => {
      resolveApply = res;
    });
    hoisted.rdf.applyBatch.mockReturnValue(applyPromise);

    render(<RepairSuggestions reasoningId="rf2" isConsistent={false} />);
    const applyAllBtn = await screen.findByRole('button', { name: /Apply all verified repairs/i });

    fireEvent.click(applyAllBtn);
    fireEvent.click(applyAllBtn);

    // Only the first invocation reached applyBatch.
    expect(hoisted.rdf.applyBatch).toHaveBeenCalledTimes(1);
    resolveApply({ added: 0, removed: 2 });
    await waitFor(() => expect(hoisted.toast.success).toHaveBeenCalled());
    expect(hoisted.rdf.applyBatch).toHaveBeenCalledTimes(1);
  });

  it('FIX2: applyAllVerified marks Applied ONLY the repairs actually included in the batch', async () => {
    // Inject a mixed repair set: one real removeLink repair (in the batch) and
    // one inconsistency+!needsManualReview repair that lacks an objectIri (so it
    // is excluded from `removals` and must NOT be marked Applied).
    const computeMod = await import('../../../mcp/tools/computeRepairs');
    const spy = vi.spyOn(computeMod, 'computeRepairs').mockReturnValue([
      {
        id: 'R1',
        issue: 'inconsistency',
        action: {
          tool: 'removeLink',
          args: { subjectIri: `${EX}i`, predicateIri: RDF_TYPE, objectIri: `${EX}A` },
        },
        rationale: 'Real repair included in the batch',
      },
      {
        id: 'R2',
        issue: 'inconsistency',
        // inconsistency + !needsManualReview but missing objectIri ⇒ excluded
        // from removals. Under the old broad filter this was wrongly marked Applied.
        action: {
          tool: 'removeLink',
          args: { subjectIri: `${EX}j`, predicateIri: RDF_TYPE },
        },
        rationale: 'Repair NOT applied (missing object)',
      },
    ] as ReturnType<typeof computeMod.computeRepairs>);

    hoisted.rdf.explainInconsistency.mockResolvedValue([[{ subject: `${EX}i`, predicate: RDF_TYPE, object: `${EX}A` }]]);
    hoisted.rdf.getUnsatisfiableClasses.mockResolvedValue([]);
    hoisted.rdf.runShaclValidation.mockResolvedValue({ conforms: true, violations: [], shapeCount: 0 });
    hoisted.rdf.verifyRepair.mockResolvedValue(true);
    // Only the single valid removal is in the batch.
    hoisted.rdf.applyBatch.mockResolvedValue({ added: 0, removed: 1 });

    render(<RepairSuggestions reasoningId="rf3" isConsistent={false} />);

    const applyAllBtn = await screen.findByRole('button', { name: /Apply all verified repairs/i });
    fireEvent.click(applyAllBtn);

    await waitFor(() => expect(hoisted.rdf.applyBatch).toHaveBeenCalled());
    const [changes] = hoisted.rdf.applyBatch.mock.calls[0];
    // Only the well-formed repair was sent to the batch.
    expect(changes.removes.length).toBe(1);
    expect(changes.removes[0].subject).toBe(`${EX}i`);

    // R1 (applied) shows "Applied"; R2 (excluded) must NOT — its button stays "Apply fix".
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Apply repair R1/i }).textContent).toMatch(/Applied/);
    });
    expect(screen.getByRole('button', { name: /Apply repair R2/i }).textContent).toMatch(/Apply fix/);
    expect(screen.getByRole('button', { name: /Apply repair R2/i }).textContent).not.toMatch(/Applied/);

    spy.mockRestore();
  });

  it('shows the consistent/conformant empty state when there are no issues', async () => {
    hoisted.rdf.getUnsatisfiableClasses.mockResolvedValue([]);
    hoisted.rdf.runShaclValidation.mockResolvedValue({ conforms: true, violations: [], shapeCount: 0 });

    render(<RepairSuggestions reasoningId="r3" isConsistent={true} />);

    await waitFor(() => {
      expect(screen.getByText(/No automatic repairs available/i)).toBeTruthy();
    });
    // No inconsistency justification lookup when consistent.
    expect(hoisted.rdf.explainInconsistency).not.toHaveBeenCalled();
  });
});
