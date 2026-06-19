// src/mcp/tools/diagnosticsBrief.ts
// Pure function: turns structured diagnostics into a ranked, plain-language,
// agent-actionable repair brief.

export interface DiagnosticsData {
  isConsistent: boolean | null;
  justifications: { subject: string; predicate: string; object: string }[][];
  unsatisfiableClasses: string[];
  profile: { owl2dl: boolean; violations: { axiom: string; reason: string }[] };
  shaclViolations: {
    focusNode: string | null;
    path: string | null;
    severity: string | null;
    message: string | null;
    sourceShape: string | null;
    constraint: string | null;
  }[];
}

// ---------------------------------------------------------------------------
// IRI → local name helper
// ---------------------------------------------------------------------------

/** Returns the local name after the last '#' or '/', or the full string if neither. */
function localName(iri: string): string {
  if (!iri) return iri;
  const hashIdx = iri.lastIndexOf('#');
  if (hashIdx !== -1 && hashIdx < iri.length - 1) return iri.slice(hashIdx + 1);
  const slashIdx = iri.lastIndexOf('/');
  if (slashIdx !== -1 && slashIdx < iri.length - 1) return iri.slice(slashIdx + 1);
  return iri;
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildInconsistencySection(
  justifications: DiagnosticsData['justifications'],
): string {
  const lines: string[] = ['1. INCONSISTENCY (most severe)'];

  if (justifications.length > 1) {
    lines.push(
      `   The ontology has ${justifications.length} independent contradictions; each must be resolved.`,
    );
  }

  justifications.forEach((axiomSet, idx) => {
    lines.push(`   Justification ${idx + 1}:`);
    for (const ax of axiomSet) {
      lines.push(
        `     - ${localName(ax.subject)} ${localName(ax.predicate)} ${localName(ax.object)}`,
      );
    }
    lines.push(
      '   To resolve, remove or revise at least one axiom in this set.',
    );
  });

  return lines.join('\n');
}

function buildUnsatisfiableSection(classes: string[]): string {
  const lines: string[] = [`${sectionNum(2)}. UNSATISFIABLE CLASSES`];
  for (const cls of classes) {
    lines.push(
      `   - ${localName(cls)}: This class can never have instances — relax its definition` +
        ' (e.g. remove a disjointness or an over-constraining restriction).',
    );
  }
  return lines.join('\n');
}

function buildProfileSection(
  violations: DiagnosticsData['profile']['violations'],
  num: number,
): string {
  const lines: string[] = [`${num}. OWL 2 DL PROFILE VIOLATIONS`];
  for (const v of violations) {
    lines.push(`   - Axiom: ${localName(v.axiom)}`);
    lines.push(`     Reason: ${v.reason}`);
  }
  return lines.join('\n');
}

function buildShaclSection(
  violations: DiagnosticsData['shaclViolations'],
  num: number,
): string {
  // Group by severity
  const bySeverity = new Map<string, DiagnosticsData['shaclViolations']>();
  for (const v of violations) {
    const sev = v.severity ?? 'Unknown';
    if (!bySeverity.has(sev)) bySeverity.set(sev, []);
    bySeverity.get(sev)!.push(v);
  }

  const lines: string[] = [`${num}. SHACL VIOLATIONS`];
  for (const [severity, group] of bySeverity.entries()) {
    lines.push(`   [${severity}]`);
    for (const v of group) {
      const focus = v.focusNode ? localName(v.focusNode) : '(unknown)';
      const path = v.path ? localName(v.path) : '(no path)';
      const msg = v.message ?? '(no message)';
      lines.push(`   - Focus: ${focus} | Path: ${path}`);
      lines.push(`     Message: ${msg}`);
    }
  }
  lines.push(
    '   Add or correct the data to satisfy the shape.',
  );
  return lines.join('\n');
}

// Small helper to compute running section numbers
let _num = 0;
function sectionNum(base: number): number {
  return base;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function buildRepairBrief(d: DiagnosticsData): string {
  const hasInconsistency = d.isConsistent === false;
  const hasUnsatisfiable = d.unsatisfiableClasses.length > 0;
  const hasProfileViolations = d.profile.owl2dl === false && d.profile.violations.length > 0;
  const hasShaclViolations = d.shaclViolations.length > 0;
  const hasProfileFlag = d.profile.owl2dl === false;

  const anyIssue =
    hasInconsistency ||
    hasUnsatisfiable ||
    hasProfileFlag ||
    hasShaclViolations;

  if (!anyIssue) {
    return 'No issues detected.';
  }

  const sections: string[] = [];
  let num = 1;

  if (hasInconsistency) {
    sections.push(buildInconsistencySection(d.justifications));
    num++;
  }

  if (hasUnsatisfiable) {
    const lines: string[] = [`${num}. UNSATISFIABLE CLASSES`];
    for (const cls of d.unsatisfiableClasses) {
      lines.push(
        `   - ${localName(cls)}: This class can never have instances — relax its definition` +
          ' (e.g. remove a disjointness or an over-constraining restriction).',
      );
    }
    sections.push(lines.join('\n'));
    num++;
  }

  if (hasProfileFlag) {
    sections.push(buildProfileSection(d.profile.violations, num));
    num++;
  }

  if (hasShaclViolations) {
    sections.push(buildShaclSection(d.shaclViolations, num));
    num++;
  }

  return sections.join('\n\n');
}
