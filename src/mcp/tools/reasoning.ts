// src/mcp/tools/reasoning.ts
import type { McpTool, McpResult } from '@/mcp/types';
import { getWorkspaceRefs } from '@/mcp/workspaceContext';
import { useAppConfigStore } from '@/stores/appConfigStore';
import { VALID_ALGORITHMS } from './layout';
import { rdfManager } from '@/utils/rdfManager';
import { checkOwl2Profile, type ProfileTriple } from '@/utils/owlProfile';
import { buildRepairBrief, type DiagnosticsData } from './diagnosticsBrief';
const EXPORT_FORMATS = ['turtle', 'jsonld', 'rdfxml', 'svg', 'png'];

const DATA_GRAPH = 'urn:vg:data';

/** Read the asserted data graph and project it to ProfileTriple[] (literal-aware). */
async function loadDataProfileTriples(): Promise<ProfileTriple[]> {
  const page = await rdfManager.fetchQuadsPage({ graphName: DATA_GRAPH, limit: 0, serialize: true });
  const items = (page?.items ?? []) as Array<{
    subject: { value: string };
    predicate: { value: string };
    object: { value: string; termType: string };
  }>;
  return items.map((q) => ({
    subject: q.subject.value,
    predicate: q.predicate.value,
    object: q.object.value,
    objectIsLiteral: q.object.termType === 'Literal',
  }));
}

// ---------------------------------------------------------------------------
// runReasoning
// ---------------------------------------------------------------------------
const runReasoning: McpTool = {
  name: 'runReasoning',
  description: "Run OWL reasoning over the loaded graph and infer new triples. Default backend is 'konclude' (full OWL 2 DL). Pass reasonerBackend='n3' to use N3 rule-based inference instead. Pass clearBefore=true to clear previous inferences first. SHACL validation runs by default after reasoning if shapes are loaded (shaclValidation=true); pass shaclValidation=false to skip it. Response: { inferredTriples, isConsistent: boolean|null, errors: ReasoningError[] }. isConsistent=false means the ontology is logically contradictory — inferences were skipped and errors contains per-entity clash details (nodeId: individual IRI, rule, message). isConsistent=null when using the n3 backend or when validation was unavailable.",
  inputSchema: {
    type: 'object',
    properties: {
      clearBefore: { type: 'boolean', default: false },
      reasonerBackend: { type: 'string', enum: ['konclude', 'n3'], description: "Reasoning backend: 'konclude' (OWL 2 DL, default) or 'n3' (N3 rule-based)" },
      shaclValidation: { type: 'boolean', default: true, description: 'Run SHACL validation after reasoning (default true). Pass false to skip.' },
    },
  },
  async handler(params): Promise<McpResult> {
    try {
      const { clearBefore = false, reasonerBackend, shaclValidation = true } = (params ?? {}) as { clearBefore?: boolean; reasonerBackend?: 'konclude' | 'n3'; shaclValidation?: boolean };
      const refs = getWorkspaceRefs();

      if (clearBefore) {
        refs.clearInferred?.() ?? refs.dataProvider.clearInferred();
      }

      const prevShaclEnabled = useAppConfigStore.getState().config.shaclEnabled;
      if (shaclValidation !== prevShaclEnabled) {
        useAppConfigStore.getState().setShaclEnabled(shaclValidation);
      }

      const backend = reasonerBackend === 'n3' ? 'n3' : reasonerBackend === 'konclude' ? 'konclude' : undefined;
      let result: unknown;
      try {
        result = await refs.runReasoning?.(backend);
      } finally {
        if (shaclValidation !== prevShaclEnabled) {
          useAppConfigStore.getState().setShaclEnabled(prevShaclEnabled);
        }
      }
      const inferredTriples = (result as any)?.meta?.addedCount ?? (result as any)?.inferences?.length ?? 0;

      return {
        success: true,
        data: {
          inferredTriples,
          isConsistent: (result as any)?.isConsistent ?? null,
          errors: ((result as any)?.errors ?? []).map((e: any) => ({
            nodeId: e.nodeId ?? null,
            rule: e.rule ?? 'unknown',
            severity: e.severity ?? 'error',
            message: e.message ?? '',
          })),
        },
      };
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

// ---------------------------------------------------------------------------
// explainDiagnostics
// ---------------------------------------------------------------------------
const explainDiagnostics: McpTool = {
  name: 'explainDiagnostics',
  description:
    "Run the full symbolic verifier (OWL 2 DL reasoning + SHACL) and return ONE structured, actionable diagnosis of everything wrong with the current graph. " +
    "Use this to decide what to fix after authoring. Response: { isConsistent, justifications, unsatisfiableClasses, profile, shaclViolations, repairBrief }. " +
    "isConsistent=false means a logical contradiction: `justifications` lists each minimal set of axioms (MIPS) causing it — remove or revise one axiom per set. " +
    "`unsatisfiableClasses` are classes that can never have instances (best-effort). `profile` reports OWL 2 DL profile violations (e.g. a literal on an object property). " +
    "`shaclViolations` are data-shape conformance failures. `repairBrief` is a ranked plain-language summary you can act on directly. Read-only: never mutates asserted data.",
  inputSchema: {
    type: 'object',
    properties: {
      maxJustifications: {
        type: 'number',
        default: 3,
        description: 'Maximum number of independent inconsistency justifications (MIPS) to return when inconsistent.',
      },
    },
  },
  async handler(params): Promise<McpResult> {
    try {
      const { maxJustifications = 3 } = (params ?? {}) as { maxJustifications?: number };

      // 1. Run reasoning to compute consistency, classify, and run SHACL.
      const reasoning = await rdfManager.runReasoning();
      const isConsistent = (reasoning as { isConsistent?: boolean | null })?.isConsistent ?? null;

      // 2. Inconsistency justifications (only meaningful when inconsistent).
      let justifications: DiagnosticsData['justifications'] = [];
      if (isConsistent === false) {
        justifications = await rdfManager.explainInconsistency(maxJustifications);
      }

      // 3. Unsatisfiable classes (Konclude classification — classes equivalent to owl:Nothing).
      let unsatisfiableClasses: string[] = [];
      try { unsatisfiableClasses = await rdfManager.getUnsatisfiableClasses(); } catch { unsatisfiableClasses = []; }

      // 4. OWL 2 DL profile check over the asserted data graph.
      const profileTriples = await loadDataProfileTriples();
      const profile = checkOwl2Profile(profileTriples);

      // 5. SHACL conformance.
      const shacl = await rdfManager.runShaclValidation();
      const shaclViolations = (shacl?.violations ?? []) as DiagnosticsData['shaclViolations'];

      const data: DiagnosticsData = {
        isConsistent,
        justifications,
        unsatisfiableClasses,
        profile,
        shaclViolations,
      };
      const repairBrief = buildRepairBrief(data);

      return { success: true, data: { ...data, repairBrief } };
    } catch (e) {
      return { success: false, error: `explainDiagnostics: ${(e as Error)?.message ?? String(e)}` };
    }
  },
};

export const reasoningTools: McpTool[] = [runReasoning, clearInferred, getCapabilities, explainDiagnostics];
