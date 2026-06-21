// src/mcp/tools/computeRepairs.ts
//
// R1 — Reasoner-computed repair suggestions.
//
// Pure, deterministic translation of symbolic diagnostics (inconsistency
// justifications a.k.a. MIPS, unsatisfiable classes, SHACL violations) into a
// ranked list of *executable* repair candidates. This moves repair SELECTION
// from the LLM onto the symbolic side: instead of handing the agent a prose
// brief and asking it to translate justifications into tool calls, we compute
// the minimal axiom set whose removal restores consistency and emit ready-to-run
// `removeLink` / `addTriple` actions. Every emitted `action.tool` is a tool that
// is actually registered in ontosphereMcpServer.ts (guarded by a unit test).
//
// This module is intentionally free of any reasoner / worker dependency so it
// can be unit-tested exhaustively without WASM. The optional *symbolic
// verification* of each candidate (re-running the Konclude consistency oracle on
// a store copy with the axioms removed) is layered on top in reasoning.ts.

import type { DiagnosticsData } from './diagnosticsBrief';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RepairIssue = 'inconsistency' | 'shacl';

export interface RepairAction {
  /**
   * MCP tool the agent should call to apply this repair. Inconsistency repairs
   * always use `removeLink` — its handler removes ANY matching triple (it calls
   * rdfManager.removeTriple under the hood), so it works for IRI-object edges,
   * literal-object annotations, AND TBox schema axioms (disjointWith/subClassOf).
   * Only tools that are actually registered (see ontosphereMcpServer.ts) are emitted.
   */
  tool: 'removeLink' | 'addTriple' | 'updateNode';
  args: {
    subjectIri?: string;
    predicateIri?: string;
    /**
     * The triple object. For IRI-object axioms this is the object IRI. For
     * literal-object axioms (e.g. an annotation with a string/number literal)
     * this carries the literal's lexical value — `removeLink`'s handler coerces
     * a non-IRI object string to a Literal term and removes the matching triple,
     * so the same field works for both cases.
     */
    objectIri?: string;
    /**
     * For SHACL `addTriple`/`updateNode` candidates whose object value cannot be
     * inferred symbolically, this is left undefined and `needsValue` is set so
     * the agent knows it must supply a value.
     */
    objectValue?: string;
    /**
     * C1: the named graph the axiom physically resides in (e.g. 'urn:vg:data' or
     * 'urn:vg:ontologies' for an imported schema axiom). The apply path MUST
     * remove/add in THIS graph — hardcoding urn:vg:data silently no-ops when the
     * axiom lives in an imported ontology. Undefined ⇒ default data graph.
     */
    graph?: string;
    /**
     * H2: the object term's RDF kind ('NamedNode' | 'Literal' | 'BlankNode').
     * When 'Literal', `objectDatatype`/`objectLanguage` carry the exact type so
     * the apply path reconstructs the precise typed/lang literal instead of a
     * lossy lexical-only match that could remove a same-lexical sibling.
     */
    objectTermType?: string;
    /** H2: datatype IRI of a literal object (e.g. xsd:integer). */
    objectDatatype?: string;
    /** H2: language tag of a literal object (e.g. 'en'). */
    objectLanguage?: string;
  };
}

export interface RepairSuggestion {
  /** Stable, human-referenceable id, e.g. "R1", "R2", "S1". */
  id: string;
  issue: RepairIssue;
  action: RepairAction;
  /** Plain-language explanation of why this repair was chosen. */
  rationale: string;
  /**
   * Indices (into `diagnostics.justifications`) of the inconsistency
   * justifications this repair resolves. Present for inconsistency repairs.
   */
  justificationsCovered?: number[];
  /**
   * Set by the caller after symbolic verification: true when re-running the
   * Konclude consistency oracle on a store copy WITHOUT this repair's *single*
   * axiom yields a consistent ontology. NOTE: with multiple disjoint
   * contradictions no single removal restores GLOBAL consistency, so this is
   * commonly `false` even for a correct repair — it means "does not ALONE
   * restore consistency; apply the full repair set" rather than "wrong repair".
   * Cross-reference `verifiedSet`. Undefined when not (yet) verified.
   */
  verifiedConsistent?: boolean;
  /**
   * Set by the caller after symbolic verification of the FULL hitting set
   * (all inconsistency repairs removed together): true when removing every
   * inconsistency repair's axiom at once restores global consistency. This is
   * the paper-critical signal — the union of repairs IS the valid fix even when
   * each individual `verifiedConsistent` is false. Same value on every
   * inconsistency repair. Undefined when not (yet) verified.
   */
  verifiedSet?: boolean;
  /**
   * True when the action cannot be fully specified because a value must be
   * chosen by the agent (SHACL candidates with an unknown object).
   */
  needsValue?: boolean;
  /**
   * True for a marker suggestion that has NO executable action because the
   * reasoner reported a contradiction with no covering axiom (a degenerate /
   * empty MIPS). The agent must inspect the ontology manually. `action` is set
   * to a no-op shape and there is no `justificationsCovered`.
   */
  needsManualReview?: boolean;
}

// ---------------------------------------------------------------------------
// Axiom helpers
// ---------------------------------------------------------------------------

type Axiom = {
  subject: string;
  predicate: string;
  object: string;
  // C1 + H2: optional provenance/term metadata threaded from the MIPS so the
  // repair action can target the correct graph and reconstruct the exact object
  // term. Absent on synthetic/test axioms that only specify s/p/o.
  objectTermType?: string;
  objectDatatype?: string;
  objectLanguage?: string;
  graph?: string;
};

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const OWL = 'http://www.w3.org/2002/07/owl#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';

/** Predicates that express TBox / structural schema axioms (least preferred to remove). */
const TBOX_PREDICATES = new Set<string>([
  `${OWL}disjointWith`,
  `${OWL}equivalentClass`,
  `${OWL}equivalentProperty`,
  `${OWL}complementOf`,
  `${OWL}unionOf`,
  `${OWL}intersectionOf`,
  `${OWL}oneOf`,
  `${OWL}onProperty`,
  `${OWL}someValuesFrom`,
  `${OWL}allValuesFrom`,
  `${OWL}hasValue`,
  `${OWL}cardinality`,
  `${OWL}minCardinality`,
  `${OWL}maxCardinality`,
  `${OWL}qualifiedCardinality`,
  `${OWL}minQualifiedCardinality`,
  `${OWL}maxQualifiedCardinality`,
  `${OWL}propertyDisjointWith`,
  `${OWL}disjointUnionOf`,
  `${OWL}inverseOf`,
  `${RDFS}subClassOf`,
  `${RDFS}subPropertyOf`,
  `${RDFS}domain`,
  `${RDFS}range`,
]);

/** Object values that, as rdf:type objects, denote a TBox structural assertion. */
const TBOX_TYPE_OBJECTS = new Set<string>([
  `${OWL}FunctionalProperty`,
  `${OWL}InverseFunctionalProperty`,
  `${OWL}TransitiveProperty`,
  `${OWL}SymmetricProperty`,
  `${OWL}AsymmetricProperty`,
  `${OWL}ReflexiveProperty`,
  `${OWL}IrreflexiveProperty`,
]);

/** local name after the last '#' or '/', or the full string. */
function localName(iri: string): string {
  if (!iri) return iri;
  const hash = iri.lastIndexOf('#');
  if (hash !== -1 && hash < iri.length - 1) return iri.slice(hash + 1);
  const slash = iri.lastIndexOf('/');
  if (slash !== -1 && slash < iri.length - 1) return iri.slice(slash + 1);
  return iri;
}

function axiomKey(a: Axiom): string {
  // Include graph + object term metadata so two axioms that share the same
  // s/p/o lexical form but differ in source graph (C1) or in literal
  // datatype/language (H2) are NOT merged into one hitting-set entry — they are
  // genuinely distinct RDF terms and may need distinct repairs.
  return [
    a.subject,
    a.predicate,
    a.object,
    a.objectTermType ?? '',
    a.objectDatatype ?? '',
    a.objectLanguage ?? '',
    a.graph ?? '',
  ].join(' ');
}

/**
 * Is this axiom a TBox / structural schema axiom? Such axioms are MORE
 * destructive to remove (they change the meaning of the ontology) so the
 * ranking prefers removing ABox / object-property assertions instead.
 */
function isTBoxAxiom(a: Axiom): boolean {
  if (TBOX_PREDICATES.has(a.predicate)) return true;
  if (a.predicate === RDF_TYPE && TBOX_TYPE_OBJECTS.has(a.object)) return true;
  return false;
}

/**
 * An rdf:type assertion to an OWL meta-class (owl:Class, owl:ObjectProperty,
 * owl:NamedIndividual, …) is a *declaration*. Removing a declaration is
 * pointless as a repair (it does not relieve the logical clash) so we treat it
 * as maximally destructive when ranking, keeping it out of hitting sets unless
 * nothing else covers a justification.
 */
function isDeclaration(a: Axiom): boolean {
  return (
    a.predicate === RDF_TYPE &&
    a.object.startsWith(OWL) &&
    /(Class|ObjectProperty|DatatypeProperty|AnnotationProperty|NamedIndividual|Ontology)$/.test(
      a.object,
    )
  );
}

/**
 * Does this axiom's object look like an absolute IRI (vs. a literal value)?
 * Used only for rationale wording — the emitted tool is always `removeLink`,
 * whose handler removes IRI-object AND literal-object triples alike.
 */
function hasIriObject(a: Axiom): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(a.object);
}

// ---------------------------------------------------------------------------
// Minimal hitting set over the justifications (MIPS)
// ---------------------------------------------------------------------------

/**
 * A hitting set over a family of sets is a set that intersects every member.
 * For inconsistency repair, every justification (MIPS) must lose at least one
 * axiom for consistency to be restored; the minimal hitting set is the smallest
 * such axiom collection.
 *
 * Minimum hitting set is NP-hard, so we use a deterministic greedy heuristic
 * (repeatedly take the axiom covering the most still-uncovered justifications)
 * followed by a minimality post-reduction pass (drop any chosen axiom that is
 * redundant because the rest already hit every justification). This yields a
 * *minimal* (irredundant) hitting set — not necessarily of globally minimum
 * cardinality, but small and verifiable, which is what the agent needs.
 *
 * Ties in coverage are broken to favour the LEAST-DESTRUCTIVE removal:
 *   1. higher coverage (more justifications hit) wins;
 *   2. then prefer ABox / object-property assertions over TBox structural axioms;
 *   3. then prefer axioms that touch an unsatisfiable class;
 *   4. then a stable lexicographic axiom-key order (full determinism).
 */
function computeMinimalHittingSet(
  justifications: Axiom[][],
  unsatClasses: Set<string>,
): { hittingSet: { axiom: Axiom; covered: number[] }[]; uncovered: number[] } {
  // Deduplicate axioms, recording which justifications each appears in.
  const axiomToJustifs = new Map<string, { axiom: Axiom; justifs: Set<number> }>();
  justifications.forEach((mips, jIdx) => {
    for (const ax of mips) {
      const key = axiomKey(ax);
      let entry = axiomToJustifs.get(key);
      if (!entry) {
        entry = { axiom: ax, justifs: new Set<number>() };
        axiomToJustifs.set(key, entry);
      }
      entry.justifs.add(jIdx);
    }
  });

  const touchesUnsat = (a: Axiom): boolean =>
    unsatClasses.has(a.subject) || unsatClasses.has(a.object);

  // Destructiveness rank: lower is better (less destructive → preferred).
  const destructiveness = (a: Axiom): number => {
    if (isDeclaration(a)) return 2; // never really a useful repair
    if (isTBoxAxiom(a)) return 1; // structural change
    return 0; // ABox / object-property assertion
  };

  const uncovered = new Set<number>(justifications.map((_, i) => i));
  const chosen: { axiom: Axiom; covered: number[] }[] = [];
  const chosenKeys = new Set<string>();

  while (uncovered.size > 0) {
    let best: { key: string; axiom: Axiom; newCover: number[] } | null = null;
    for (const [key, { axiom, justifs }] of axiomToJustifs) {
      if (chosenKeys.has(key)) continue;
      const newCover: number[] = [];
      for (const j of justifs) if (uncovered.has(j)) newCover.push(j);
      if (newCover.length === 0) continue;

      if (best === null) {
        best = { key, axiom, newCover };
        continue;
      }
      // Compare against current best with the documented tie-break order.
      const cmp = compareCandidates(
        { axiom: best.axiom, cover: best.newCover.length },
        { axiom, cover: newCover.length },
        destructiveness,
        touchesUnsat,
      );
      // cmp > 0 means the new candidate is better.
      if (cmp > 0) best = { key, axiom, newCover };
    }
    if (!best) break; // no axiom can cover remaining justifications (shouldn't happen)
    chosen.push({ axiom: best.axiom, covered: [...best.newCover].sort((a, b) => a - b) });
    chosenKeys.add(best.key);
    for (const j of best.newCover) uncovered.delete(j);
  }

  // Minimality post-reduction: drop any chosen axiom whose justifications are
  // already covered by the others. Iterate from the last-added (greedy picks
  // earliest-added axioms cover the most, so later ones are likelier redundant).
  const coversAll = (set: { covered: number[] }[]): boolean => {
    const hit = new Set<number>();
    for (const c of set) for (const j of c.covered) hit.add(j);
    return justifications.every((_, i) => hit.has(i));
  };
  for (let i = chosen.length - 1; i >= 0; i--) {
    const without = chosen.filter((_, idx) => idx !== i);
    if (coversAll(without)) {
      chosen.splice(i, 1);
    }
  }

  // Recompute the FULL coverage of each surviving axiom (it may hit more
  // justifications than the incremental `newCover` recorded during greedy
  // selection), so `justificationsCovered` reflects every MIPS it resolves.
  const hittingSet = chosen.map(({ axiom }) => {
    const justifs = axiomToJustifs.get(axiomKey(axiom))!.justifs;
    return { axiom, covered: [...justifs].sort((a, b) => a - b) };
  });

  // `uncovered` retains any justification index no axiom could hit — i.e. a
  // degenerate / empty MIPS (an inner `[]`). These have no covering axiom, so
  // the caller emits a `needsManualReview` marker instead of leaving the agent
  // with a contradiction and zero guidance (M4).
  return { hittingSet, uncovered: [...uncovered].sort((a, b) => a - b) };
}

/**
 * Returns > 0 if `b` should be preferred over `a`, < 0 if `a` is preferred,
 * 0 if equal under all criteria. Implements the documented ranking order.
 */
function compareCandidates(
  a: { axiom: Axiom; cover: number },
  b: { axiom: Axiom; cover: number },
  destructiveness: (x: Axiom) => number,
  touchesUnsat: (x: Axiom) => boolean,
): number {
  // 1. higher coverage wins
  if (b.cover !== a.cover) return b.cover - a.cover;
  // 2. lower destructiveness wins (prefer ABox over TBox)
  const da = destructiveness(a.axiom);
  const db = destructiveness(b.axiom);
  if (da !== db) return da - db;
  // 3. prefer touching an unsatisfiable class
  const ua = touchesUnsat(a.axiom) ? 0 : 1;
  const ub = touchesUnsat(b.axiom) ? 0 : 1;
  if (ua !== ub) return ua - ub;
  // 4. stable lexicographic order
  const ka = axiomKey(a.axiom);
  const kb = axiomKey(b.axiom);
  if (ka < kb) return -1;
  if (ka > kb) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Repair builders
// ---------------------------------------------------------------------------

function buildInconsistencyRepairs(
  justifications: Axiom[][],
  unsatClasses: Set<string>,
): RepairSuggestion[] {
  if (justifications.length === 0) return [];
  const { hittingSet, uncovered } = computeMinimalHittingSet(justifications, unsatClasses);

  // Final presentation ordering: rank repairs by impact — most justifications
  // covered first, then least-destructive, then unsat-touching, then stable key.
  const destructiveness = (a: Axiom): number =>
    isDeclaration(a) ? 2 : isTBoxAxiom(a) ? 1 : 0;
  const touchesUnsat = (a: Axiom): boolean =>
    unsatClasses.has(a.subject) || unsatClasses.has(a.object);

  hittingSet.sort((x, y) =>
    compareCandidates(
      { axiom: x.axiom, cover: x.covered.length },
      { axiom: y.axiom, cover: y.covered.length },
      destructiveness,
      touchesUnsat,
    ),
  );

  const out: RepairSuggestion[] = hittingSet.map(({ axiom, covered }, i) => {
    // H1: ALWAYS removeLink. Its handler removes any matching triple (IRI- AND
    // literal-object) and any TBox axiom — and it is a registered MCP tool,
    // unlike the previously-emitted `removeTriple` which had no handler.
    const tool: RepairAction['tool'] = 'removeLink';
    const structural = isTBoxAxiom(axiom);
    const coversText =
      covered.length > 1
        ? `resolves ${covered.length} of the ${justifications.length} contradictions`
        : `resolves contradiction ${covered[0] + 1}`;
    const kind = structural
      ? 'a TBox/structural axiom (more invasive — verify intent before applying)'
      : hasIriObject(axiom)
        ? 'an ABox/assertion (least-destructive choice)'
        : 'an annotation/literal assertion (least-destructive choice)';
    const rationale =
      `Remove ${localName(axiom.subject)} ${localName(axiom.predicate)} ` +
      `${localName(axiom.object)} — ${kind}; this ${coversText}.`;
    return {
      id: `R${i + 1}`,
      issue: 'inconsistency' as const,
      action: {
        tool,
        args: {
          subjectIri: axiom.subject,
          predicateIri: axiom.predicate,
          objectIri: axiom.object,
          // C1 + H2: carry the source graph and object term metadata so the
          // apply path removes from the correct graph and reconstructs the exact
          // typed/lang literal. Only set when present (back-compat).
          ...(axiom.graph ? { graph: axiom.graph } : {}),
          ...(axiom.objectTermType ? { objectTermType: axiom.objectTermType } : {}),
          ...(axiom.objectDatatype ? { objectDatatype: axiom.objectDatatype } : {}),
          ...(axiom.objectLanguage ? { objectLanguage: axiom.objectLanguage } : {}),
        },
      },
      rationale,
      justificationsCovered: covered,
    };
  });

  // M4: any justification with no covering axiom (a degenerate / empty MIPS)
  // gets a non-executable `needsManualReview` marker so the agent is told the
  // contradiction exists and why it cannot be auto-repaired, instead of being
  // handed a contradiction with zero guidance.
  for (const jIdx of uncovered) {
    out.push({
      id: `R${out.length + 1}`,
      issue: 'inconsistency' as const,
      action: { tool: 'removeLink', args: {} },
      rationale:
        `Contradiction ${jIdx + 1} has no covering axiom in its justification ` +
        `(the reasoner returned an empty/degenerate MIPS). No automatic repair ` +
        `can be computed — inspect the ontology manually (e.g. an implicit ` +
        `entailment or a class definition rather than a single removable axiom).`,
      justificationsCovered: [jIdx],
      needsManualReview: true,
    });
  }

  return out;
}

function buildShaclRepairs(
  violations: DiagnosticsData['shaclViolations'],
): RepairSuggestion[] {
  const out: RepairSuggestion[] = [];
  let n = 0;
  for (const v of violations) {
    if (!v.focusNode || !v.path) continue; // can't form an actionable triple
    n += 1;
    const constraintName = v.constraint ? localName(v.constraint) : 'shape constraint';
    // We cannot symbolically infer the value the shape expects, so the agent
    // must supply it. We use addTriple with needsValue:true.
    const rationale =
      `SHACL ${v.severity ?? 'violation'} on ${localName(v.focusNode)} via ` +
      `${localName(v.path)} (${constraintName})` +
      (v.message ? `: ${v.message}` : '') +
      `. Add a value for ${localName(v.path)} on ${localName(v.focusNode)} to satisfy the shape.`;
    out.push({
      id: `S${n}`,
      issue: 'shacl',
      action: {
        tool: 'addTriple',
        args: {
          subjectIri: v.focusNode,
          predicateIri: v.path,
          // objectValue intentionally omitted — see needsValue.
        },
      },
      rationale,
      needsValue: true,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Compute ranked, executable repair candidates from symbolic diagnostics.
 *
 * - Inconsistency repairs come from a minimal hitting set over the MIPS:
 *   removing the chosen axioms intersects every justification, restoring
 *   consistency. Ranked by impact (coverage), then least-destructive, then
 *   unsat-touching, then a stable order.
 * - SHACL repairs emit one `addTriple` candidate per actionable violation,
 *   flagged `needsValue` since the expected object cannot be inferred.
 *
 * Pure and deterministic: identical input always yields identical output.
 * Verification of each candidate (re-running the consistency oracle on a store
 * copy without the removed axioms) is performed separately by the caller.
 */
export function computeRepairs(diagnostics: DiagnosticsData): RepairSuggestion[] {
  const unsatClasses = new Set<string>(diagnostics.unsatisfiableClasses ?? []);
  const inconsistencyRepairs =
    diagnostics.isConsistent === false
      ? buildInconsistencyRepairs(diagnostics.justifications ?? [], unsatClasses)
      : [];
  const shaclRepairs = buildShaclRepairs(diagnostics.shaclViolations ?? []);
  return [...inconsistencyRepairs, ...shaclRepairs];
}
