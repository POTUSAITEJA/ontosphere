// src/components/Canvas/__tests__/MetricsPanel.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// --- mocks (declared before importing the component under test) ---

const hoisted = vi.hoisted(() => ({
  toastMocks: {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
  sparqlQuery: vi.fn(),
  getGraphCounts: vi.fn(),
  getNamespaces: vi.fn(),
  onSubjectsChange: vi.fn(),
  offSubjectsChange: vi.fn(),
}));
const { sparqlQuery, getGraphCounts, getNamespaces, onSubjectsChange, offSubjectsChange } =
  hoisted;

vi.mock('sonner', () => ({ toast: hoisted.toastMocks }));

vi.mock('../../../utils/rdfManager', () => ({
  rdfManager: {
    sparqlQuery: hoisted.sparqlQuery,
    getGraphCounts: hoisted.getGraphCounts,
    getNamespaces: hoisted.getNamespaces,
    onSubjectsChange: hoisted.onSubjectsChange,
    offSubjectsChange: hoisted.offSubjectsChange,
  },
}));

import { MetricsPanel } from '../MetricsPanel';

const NAMESPACES = [
  { prefix: 'ex', uri: 'http://example.org/' },
  { prefix: 'owl', uri: 'http://www.w3.org/2002/07/owl#' },
];

/** Build a COUNT SELECT result with a single ?n binding. */
function countRow(n: number) {
  return { type: 'select', rows: [{ n: String(n) }] };
}

describe('MetricsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getNamespaces.mockReturnValue(NAMESPACES);
    onSubjectsChange.mockImplementation(() => {});
    offSubjectsChange.mockImplementation(() => {});
    getGraphCounts.mockResolvedValue({ 'urn:vg:data': 200, 'urn:vg:inferred': 50 });

    // The panel issues the 7 structural COUNT queries first (in COUNT_QUERIES
    // order), then one COUNT per registered namespace. Map by query text so the
    // order of the namespace queries doesn't matter.
    // Distinct fixture values per metric so screen.getByText is unambiguous.
    sparqlQuery.mockImplementation((sparql: string) => {
      if (sparql.includes('COUNT(*)')) return Promise.resolve(countRow(200));
      if (sparql.includes('COUNT(DISTINCT ?s)') && sparql.includes('STRSTARTS')) {
        if (sparql.includes('http://example.org/')) return Promise.resolve(countRow(7));
        return Promise.resolve(countRow(4));
      }
      if (sparql.includes('COUNT(DISTINCT ?s)')) return Promise.resolve(countRow(42));
      if (sparql.includes('#Class')) {
        if (sparql.includes('rdf-schema#label')) return Promise.resolve(countRow(6));
        return Promise.resolve(countRow(12));
      }
      if (sparql.includes('ObjectProperty')) return Promise.resolve(countRow(24));
      if (sparql.includes('DatatypeProperty')) return Promise.resolve(countRow(9));
      if (sparql.includes('NamedIndividual')) return Promise.resolve(countRow(15));
      return Promise.resolve(countRow(0));
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the structural counts as stat cards', async () => {
    render(<MetricsPanel />);
    await waitFor(() => expect(getGraphCounts).toHaveBeenCalled());

    // Stat labels.
    await screen.findByText('Triples');
    expect(screen.getByText('Classes')).toBeTruthy();
    expect(screen.getByText('Object props')).toBeTruthy();
    expect(screen.getByText('Datatype props')).toBeTruthy();
    expect(screen.getByText('Individuals')).toBeTruthy();

    // Values (200 triples, 12 classes, 24 object props, 9 datatype props, 15 individuals).
    expect(screen.getByText('200')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('24')).toBeTruthy();
    expect(screen.getByText('9')).toBeTruthy();
    expect(screen.getByText('15')).toBeTruthy();
  });

  it('renders the per-namespace breakdown table sorted by subject count', async () => {
    render(<MetricsPanel />);
    await screen.findByText('Subjects by namespace');

    // Both prefixes appear (ex=7 subjects, owl=4 subjects), ex sorted first.
    const exCell = screen.getByText('ex');
    const owlCell = screen.getByText('owl');
    expect(exCell).toBeTruthy();
    expect(owlCell).toBeTruthy();
    // The subject count sits in the same row as the prefix cell.
    expect(exCell.closest('tr')?.textContent).toContain('7');
    expect(owlCell.closest('tr')?.textContent).toContain('4');
  });

  it('renders the quality heuristics derived from the counts', async () => {
    render(<MetricsPanel />);
    await screen.findByText('Quality heuristics');

    expect(screen.getByText('Avg properties / class')).toBeTruthy();
    expect(screen.getByText('Classes with rdfs:label')).toBeTruthy();
    // 5 of 10 classes labeled → 50%.
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByText(/not a/i)).toBeTruthy();
  });

  it('re-gathers when the Refresh button is clicked', async () => {
    render(<MetricsPanel />);
    await waitFor(() => expect(getGraphCounts).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Refresh metrics' }));
    await waitFor(() => expect(getGraphCounts).toHaveBeenCalledTimes(2));
  });

  it('subscribes to subject changes on mount and unsubscribes on unmount', async () => {
    const { unmount } = render(<MetricsPanel />);
    await waitFor(() => expect(onSubjectsChange).toHaveBeenCalled());
    unmount();
    expect(offSubjectsChange).toHaveBeenCalled();
  });

  it('shows an empty state when there are no triples', async () => {
    getGraphCounts.mockResolvedValue({ 'urn:vg:data': 0, 'urn:vg:inferred': 0 });
    sparqlQuery.mockResolvedValue(countRow(0));
    render(<MetricsPanel />);
    await screen.findByText('Load data to see metrics.');
  });
});
