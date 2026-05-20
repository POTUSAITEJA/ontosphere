// src/mcp/tools/reasoning.ts
import type { McpTool, McpResult } from '@/mcp/types';
import { getWorkspaceRefs } from '@/mcp/workspaceContext';
import { VALID_ALGORITHMS } from './layout';
const EXPORT_FORMATS = ['turtle', 'jsonld', 'rdfxml', 'svg', 'png'];

// ---------------------------------------------------------------------------
// runReasoning
// ---------------------------------------------------------------------------
const runReasoning: McpTool = {
  name: 'runReasoning',
  description: "Run OWL reasoning over the loaded graph and infer new triples. Default backend is 'konclude' (full OWL 2 DL). Pass reasonerBackend='n3' to use N3 rule-based inference instead. Pass clearBefore=true to clear previous inferences first.",
  inputSchema: {
    type: 'object',
    properties: {
      clearBefore: { type: 'boolean', default: false },
      reasonerBackend: { type: 'string', enum: ['konclude', 'n3'], description: "Reasoning backend: 'konclude' (OWL 2 DL, default) or 'n3' (N3 rule-based)" },
    },
  },
  async handler(params): Promise<McpResult> {
    try {
      const { clearBefore = false, reasonerBackend } = (params ?? {}) as { clearBefore?: boolean; reasonerBackend?: 'konclude' | 'n3' };
      const refs = getWorkspaceRefs();

      if (clearBefore) {
        refs.clearInferred?.() ?? refs.dataProvider.clearInferred();
      }

      const backend = reasonerBackend === 'n3' ? 'n3' : reasonerBackend === 'konclude' ? 'konclude' : undefined;
      const result = await refs.runReasoning?.(backend);
      const inferredTriples = (result as any)?.meta?.addedCount ?? (result as any)?.inferences?.length ?? 0;

      return { success: true, data: { inferredTriples } };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
};

// ---------------------------------------------------------------------------
// clearInferred
// ---------------------------------------------------------------------------
const clearInferred: McpTool = {
  name: 'clearInferred',
  description: 'Remove all inferred (reasoned) triples from the graph.',
  inputSchema: {
    type: 'object',
  },
  async handler(): Promise<McpResult> {
    try {
      const refs = getWorkspaceRefs();
      if (refs.clearInferred) {
        refs.clearInferred();
      } else {
        await refs.dataProvider.clearInferred();
      }
      return { success: true, data: { cleared: true } };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
};

// ---------------------------------------------------------------------------
// getCapabilities
// ---------------------------------------------------------------------------
const getCapabilities: McpTool = {
  name: 'getCapabilities',
  description: 'Return the supported layout algorithms and export formats.',
  inputSchema: {
    type: 'object',
  },
  async handler(): Promise<McpResult> {
    try {
      return {
        success: true,
        data: {
          layoutAlgorithms: [...VALID_ALGORITHMS],
          exportFormats: EXPORT_FORMATS,
          reasonerBackends: ['konclude', 'n3'],
        },
      };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
};

export const reasoningTools: McpTool[] = [runReasoning, clearInferred, getCapabilities];
