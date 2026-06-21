// src/components/Canvas/__tests__/EntailmentExplanation.test.tsx
//
// Verifies the "why was this inferred?" affordance on the canvas. The popover
// is LAZY: it only calls rdfManager.explainEntailment when the user opens it,
// and it renders a distinct message for each branch of the explain result
// (justifications, vacuous, ontologyInconsistent, asserted, empty-justification),
// plus loading and error states.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// Keep axiom rendering deterministic and free of the namespace registry.
vi.mock('../../../utils/termUtils', () => ({
  toPrefixed: (iri: string) => iri,
}));

import { EntailmentExplanation } from '../EntailmentExplanation';

const TRIPLE = {
  subject: 'Alice',
  predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
  object: 'Agent',
};

function openPopover() {
  const trigger = screen.getByRole('button', { name: /Explain inference/i });
  fireEvent.click(trigger);
  return trigger;
}

afterEach(() => cleanup());

describe('EntailmentExplanation', () => {
  let explain: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    explain = vi.fn();
  });

  it('does NOT call explainEntailment on render (lazy)', () => {
    explain.mockResolvedValue({ isEntailed: true, justifications: [] });
    render(<EntailmentExplanation triple={TRIPLE} explain={explain as any} />);
    expect(explain).not.toHaveBeenCalled();
  });

  it('calls explainEntailment with the exact triple args when opened', async () => {
    explain.mockResolvedValue({ isEntailed: true, justifications: [] });
    render(<EntailmentExplanation triple={TRIPLE} explain={explain as any} />);
    openPopover();
    await waitFor(() => expect(explain).toHaveBeenCalledTimes(1));
    expect(explain).toHaveBeenCalledWith(
      'Alice',
      'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
      'Agent',
      { objectIsLiteral: undefined },
    );
  });

  it('calls explainEntailment only once across open/close/open (cached)', async () => {
    explain.mockResolvedValue({ isEntailed: true, justifications: [] });
    render(<EntailmentExplanation triple={TRIPLE} explain={explain as any} />);
    const trigger = openPopover();
    await waitFor(() => expect(explain).toHaveBeenCalledTimes(1));
    fireEvent.click(trigger); // close
    fireEvent.click(trigger); // open again
    expect(explain).toHaveBeenCalledTimes(1);
  });

  it('renders the justification axioms (Inferred because:)', async () => {
    explain.mockResolvedValue({
      isEntailed: true,
      justifications: [
        [
          { subject: 'Person', predicate: 'http://www.w3.org/2000/01/rdf-schema#subClassOf', object: 'Agent' },
          { subject: 'Alice', predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', object: 'Person' },
        ],
      ],
    });
    render(<EntailmentExplanation triple={TRIPLE} explain={explain as any} />);
    openPopover();
    expect(await screen.findByText(/Inferred because:/i)).toBeTruthy();
    // subClassOf rendered with the ⊑ glyph
    expect(screen.getByText('Person ⊑ Agent')).toBeTruthy();
    expect(screen.getByText('Alice rdf:type Person')).toBeTruthy();
  });

  it('labels multiple justifications as alternative supports', async () => {
    explain.mockResolvedValue({
      isEntailed: true,
      justifications: [
        [{ subject: 'Person', predicate: 'http://www.w3.org/2000/01/rdf-schema#subClassOf', object: 'Agent' }],
        [{ subject: 'Worker', predicate: 'http://www.w3.org/2000/01/rdf-schema#subClassOf', object: 'Agent' }],
      ],
    });
    render(<EntailmentExplanation triple={TRIPLE} explain={explain as any} />);
    openPopover();
    expect(await screen.findByText(/Support 1/i)).toBeTruthy();
    expect(screen.getByText(/Alternative support 2/i)).toBeTruthy();
  });

  it('renders the vacuous message', async () => {
    explain.mockResolvedValue({ isEntailed: true, vacuous: true, justifications: [] });
    render(<EntailmentExplanation triple={TRIPLE} explain={explain as any} />);
    openPopover();
    expect(
      await screen.findByText(/Holds vacuously \(the subject class is unsatisfiable\)\./i),
    ).toBeTruthy();
  });

  it('renders the ontology-inconsistent message', async () => {
    explain.mockResolvedValue({ isEntailed: null, ontologyInconsistent: true, justifications: [] });
    render(<EntailmentExplanation triple={TRIPLE} explain={explain as any} />);
    openPopover();
    expect(
      await screen.findByText(/Cannot explain: the ontology is inconsistent/i),
    ).toBeTruthy();
  });

  it('renders the asserted (not inferred) message', async () => {
    explain.mockResolvedValue({ isEntailed: false, justifications: [] });
    render(<EntailmentExplanation triple={TRIPLE} explain={explain as any} />);
    openPopover();
    expect(
      await screen.findByText(/This is an asserted triple \(not inferred\)\./i),
    ).toBeTruthy();
  });

  it('renders the empty-justification fallback for entailed-without-detail', async () => {
    explain.mockResolvedValue({ isEntailed: true, justifications: [] });
    render(<EntailmentExplanation triple={TRIPLE} explain={explain as any} />);
    openPopover();
    expect(
      await screen.findByText(/no detailed justification available for this relation type/i),
    ).toBeTruthy();
  });

  it('renders an error message when explainEntailment rejects', async () => {
    explain.mockRejectedValue(new Error('reasoner offline'));
    render(<EntailmentExplanation triple={TRIPLE} explain={explain as any} />);
    openPopover();
    expect(await screen.findByText(/reasoner offline/i)).toBeTruthy();
  });

  it('forwards objectIsLiteral for inferred data properties', async () => {
    explain.mockResolvedValue({ isEntailed: true, justifications: [] });
    render(
      <EntailmentExplanation
        triple={{ subject: 'Alice', predicate: 'ex:age', object: '42', objectIsLiteral: true }}
        explain={explain as any}
      />,
    );
    openPopover();
    await waitFor(() => expect(explain).toHaveBeenCalledTimes(1));
    expect(explain).toHaveBeenCalledWith('Alice', 'ex:age', '42', { objectIsLiteral: true });
  });
});
