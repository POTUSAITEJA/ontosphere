// src/mcp/__tests__/reasoning.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockClearInferred, mockClearInferredCallback, mockRunReasoning } = vi.hoisted(() => ({
  mockClearInferred: vi.fn(),
  mockClearInferredCallback: vi.fn(),
  mockRunReasoning: vi.fn(),
}));

vi.mock('@/mcp/workspaceContext', () => {
  const dataProvider = { clearInferred: mockClearInferred };
  return {
    getWorkspaceRefs: vi.fn(() => ({
      ctx: {},
      dataProvider,
      clearInferred: mockClearInferredCallback,
      runReasoning: mockRunReasoning,
    })),
  };
});

import { reasoningTools } from '../tools/reasoning';
import { getWorkspaceRefs } from '@/mcp/workspaceContext';

const tool = (name: string) => {
  const t = reasoningTools.find((t) => t.name === name);
  if (!t) throw new Error(`Tool not found: ${name}`);
  return t;
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
describe('runReasoning', () => {
  it('returns inferredTriples from meta.addedCount when available', async () => {
    mockRunReasoning.mockResolvedValueOnce({ meta: { addedCount: 42 } });
    const result = await tool('runReasoning').handler({});
    expect(result).toEqual({ success: true, data: { inferredTriples: 42 } });
  });

  it('calls refs.runReasoning exactly once per invocation', async () => {
    mockRunReasoning.mockResolvedValueOnce({ meta: { addedCount: 5 } });
    await tool('runReasoning').handler({});
    expect(mockRunReasoning).toHaveBeenCalledOnce();
  });

  it('passes reasonerBackend: n3 through to refs.runReasoning', async () => {
    mockRunReasoning.mockResolvedValueOnce({ meta: { addedCount: 0 } });
    await tool('runReasoning').handler({ reasonerBackend: 'n3' });
    expect(mockRunReasoning).toHaveBeenCalledWith('n3');
  });

  it('passes reasonerBackend: konclude through to refs.runReasoning', async () => {
    mockRunReasoning.mockResolvedValueOnce({ meta: { addedCount: 0 } });
    await tool('runReasoning').handler({ reasonerBackend: 'konclude' });
    expect(mockRunReasoning).toHaveBeenCalledWith('konclude');
  });

  it('passes undefined when no reasonerBackend given (canvas uses config default)', async () => {
    mockRunReasoning.mockResolvedValueOnce({ meta: { addedCount: 0 } });
    await tool('runReasoning').handler({});
    expect(mockRunReasoning).toHaveBeenCalledWith(undefined);
  });

  it('still returns success when runReasoning is not registered', async () => {
    (getWorkspaceRefs as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      ctx: {},
      dataProvider: { clearInferred: mockClearInferred },
    });
    const result = await tool('runReasoning').handler({});
    expect(result).toEqual({ success: true, data: { inferredTriples: 0 } });
  });

  it('falls back to inferences.length when meta.addedCount is absent', async () => {
    mockRunReasoning.mockResolvedValueOnce({
      inferences: [{ type: 'class', subject: 'a', predicate: 'b', object: 'c', confidence: 1 }],
    });
    const result = await tool('runReasoning').handler({});
    expect(result).toEqual({ success: true, data: { inferredTriples: 1 } });
  });

  it('returns error if refs.runReasoning throws', async () => {
    mockRunReasoning.mockRejectedValueOnce(new Error('reasoning error'));
    const result = await tool('runReasoning').handler({});
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('reasoning error') });
  });
});

// ---------------------------------------------------------------------------
describe('clearInferred', () => {
  it('calls registered clearInferred callback when available', async () => {
    const result = await tool('clearInferred').handler({});
    expect(result).toEqual({ success: true, data: { cleared: true } });
    expect(mockClearInferredCallback).toHaveBeenCalledOnce();
    expect(mockClearInferred).not.toHaveBeenCalled();
  });

  it('falls back to dataProvider.clearInferred() when callback not registered', async () => {
    (getWorkspaceRefs as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      ctx: {},
      dataProvider: { clearInferred: mockClearInferred },
    });
    const result = await tool('clearInferred').handler({});
    expect(result).toEqual({ success: true, data: { cleared: true } });
    expect(mockClearInferred).toHaveBeenCalledOnce();
  });

  it('returns error if clearInferred throws', async () => {
    (getWorkspaceRefs as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      ctx: {},
      dataProvider: { clearInferred: vi.fn() },
      clearInferred: vi.fn(() => { throw new Error('clear error'); }),
    });
    const result = await tool('clearInferred').handler({});
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('clear error') });
  });
});

// ---------------------------------------------------------------------------
describe('getCapabilities', () => {
  it('returns static layout algorithms and export formats', async () => {
    const result = await tool('getCapabilities').handler({});
    expect(result).toEqual({
      success: true,
      data: {
        layoutAlgorithms: ['dagre-lr', 'dagre-tb', 'elk-layered', 'elk-force', 'elk-stress', 'elk-radial'],
        exportFormats: ['turtle', 'jsonld', 'rdfxml', 'svg', 'png'],
        reasonerBackends: ['konclude', 'n3'],
      },
    });
  });
});
