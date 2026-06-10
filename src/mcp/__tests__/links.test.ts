// src/mcp/__tests__/links.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create mocks in vi.hoisted so their implementations survive vi.clearAllMocks().
const { mockAddTriple, mockRemoveTriple, mockFetchQuadsPage, mockGetWorkspaceRefs } = vi.hoisted(() => ({
  mockAddTriple: vi.fn().mockResolvedValue(undefined),
  mockRemoveTriple: vi.fn().mockResolvedValue(undefined),
  mockFetchQuadsPage: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  mockGetWorkspaceRefs: vi.fn().mockReturnValue({
    ctx: { model: { elements: [], links: [], requestLinks: vi.fn().mockResolvedValue(undefined) } },
    navigateToIri: vi.fn(),
  }),
}));

vi.mock('@/utils/rdfManager', () => ({
  rdfManager: {
    addTriple: mockAddTriple,
    removeTriple: mockRemoveTriple,
    fetchQuadsPage: mockFetchQuadsPage,
  },
}));

vi.mock('@/mcp/workspaceContext', () => ({
  getWorkspaceRefs: mockGetWorkspaceRefs,
}));

import { rdfManager } from '@/utils/rdfManager';
import { linkTools } from '../tools/links';

const addLink = linkTools.find((t) => t.name === 'addTriple')!;
const removeLink = linkTools.find((t) => t.name === 'removeLink')!;
const getLinks = linkTools.find((t) => t.name === 'getLinks')!;

beforeEach(() => {
  vi.clearAllMocks();
  mockAddTriple.mockResolvedValue(undefined);
  mockRemoveTriple.mockResolvedValue(undefined);
  mockFetchQuadsPage.mockResolvedValue({ items: [], total: 0 });
  mockGetWorkspaceRefs.mockReturnValue({
    ctx: { model: { elements: [], links: [], requestLinks: vi.fn().mockResolvedValue(undefined) } },
    navigateToIri: vi.fn(),
  });
});

describe('addTriple', () => {
  it('calls addTriple with correct args and returns success', async () => {
    const result = await addLink.handler({
      subjectIri: 'http://s',
      predicateIri: 'http://p',
      objectIri: 'http://o',
    });
    expect(mockAddTriple).toHaveBeenCalledWith('http://s', 'http://p', 'http://o');
    expect(result).toEqual({
      success: true,
      data: { added: { s: 'http://s', p: 'http://p', o: 'http://o' } },
    });
  });

  it('returns error when a param is missing', async () => {
    const result = await addLink.handler({ subjectIri: 'http://s', predicateIri: 'http://p' });
    expect(result).toEqual({
      success: false,
      error: 'subjectIri, predicateIri, and objectIri are all required. Call help({tool:"addTriple"}) for the full schema.',
    });
    expect(mockAddTriple).not.toHaveBeenCalled();
  });

  it('returns error when params are null/undefined', async () => {
    const result = await addLink.handler(null);
    expect(result).toEqual({
      success: false,
      error: 'subjectIri, predicateIri, and objectIri are all required. Call help({tool:"addTriple"}) for the full schema.',
    });
  });
});

describe('removeLink', () => {
  it('calls removeTriple with correct args and returns success', async () => {
    const result = await removeLink.handler({
      subjectIri: 'http://s',
      predicateIri: 'http://p',
      objectIri: 'http://o',
    });
    expect(mockRemoveTriple).toHaveBeenCalledWith('http://s', 'http://p', 'http://o');
    expect(result).toEqual({
      success: true,
      data: { removed: { s: 'http://s', p: 'http://p', o: 'http://o' } },
    });
  });

  it('returns error when a param is missing', async () => {
    const result = await removeLink.handler({ subjectIri: 'http://s' });
    expect(result).toEqual({
      success: false,
      error: 'subjectIri, predicateIri, and objectIri are all required',
    });
    expect(mockRemoveTriple).not.toHaveBeenCalled();
  });
});

describe('getLinks', () => {
  it('returns mapped quads from fetchQuadsPage', async () => {
    const mockItems = [
      { subject: 'http://s1', predicate: 'http://p1', object: 'http://o1' },
      { subject: 'http://s2', predicate: 'http://p2', object: 'http://o2' },
    ];
    mockFetchQuadsPage.mockResolvedValue({ items: mockItems, total: 2 });

    const result = await getLinks.handler({ subjectIri: 'http://s1', limit: 50 });
    expect(mockFetchQuadsPage).toHaveBeenCalledWith({
      graphName: 'urn:vg:data',
      filter: { subject: 'http://s1', predicate: undefined, object: undefined },
      limit: 50,
    });
    expect(result).toEqual({
      success: true,
      data: {
        links: [
          { subject: 'http://s1', predicate: 'http://p1', object: 'http://o1' },
          { subject: 'http://s2', predicate: 'http://p2', object: 'http://o2' },
        ],
      },
    });
  });

  it('defaults limit to 100 when not provided', async () => {
    mockFetchQuadsPage.mockResolvedValue({ items: [], total: 0 });
    await getLinks.handler({});
    expect(mockFetchQuadsPage).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100 })
    );
  });
});
