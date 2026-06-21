// src/workers/verifyRepairMatch.ts
//
// BUG B — the pure matching predicate shared between APPLY and VERIFY.
//
// verifyRepair builds a working store COPY with the repaired axioms removed and
// re-runs the consistency oracle. For the verdict to mean anything, VERIFY must
// exclude the IDENTICAL triple the apply path (removeLink / applyBatch) removes.
// The apply path targets a specific graph and reconstructs the exact object term
// (NamedNode / BlankNode / typed-or-lang Literal). A bare lexical, all-graph
// match could exclude a DIFFERENT quad (a same-lexical sibling in another graph
// or with another datatype) and report a false `verifiedConsistent`.
//
// This module is intentionally free of any N3 / worker dependency so it can be
// unit-tested directly. The runtime imports `quadMatchesRemoval` and feeds it
// real N3 quads (whose terms expose the same {value, termType, datatype,
// language} surface this matcher reads).

const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

/** A repair removal request, optionally carrying object-term + source-graph metadata. */
export interface RepairRemoval {
  subject: string;
  predicate: string;
  object: string;
  /** 'NamedNode' | 'Literal' | 'BlankNode'. When set, the quad's object termType must match. */
  objectTermType?: string;
  /** Datatype IRI of a literal object (e.g. xsd:integer). */
  objectDatatype?: string;
  /** Language tag of a literal object (e.g. 'en'). */
  objectLanguage?: string;
  /** Named graph the axiom physically lives in. When set, the quad's graph must match. */
  graph?: string;
}

/** The minimal term/quad surface the matcher reads (satisfied by N3 quads). */
export interface MatchTerm {
  value: string;
  termType?: string;
  datatype?: { value?: string };
  language?: string;
}
export interface MatchQuad {
  subject: MatchTerm;
  predicate: MatchTerm;
  object: MatchTerm;
  graph?: MatchTerm;
}

/** Graph value of a quad ('' for the default graph). */
function quadGraphValue(q: MatchQuad): string {
  const g = q.graph;
  if (!g) return "";
  if (g.termType === "DefaultGraph") return "";
  return g.value ?? "";
}

/**
 * Does `q` match the `removal`?
 *
 * Always requires subject / predicate / object lexical equality. When the
 * removal additionally specifies a `graph`, the quad's graph must match. When it
 * specifies an `objectTermType`, the quad's object termType must match — and for
 * a Literal, its datatype (defaulting to xsd:string) and language must match
 * too. Absent metadata ⇒ the legacy bare-lexical, all-graph, any-term match
 * (back-compat). This is the SAME triple the apply path removes.
 */
export function quadMatchesRemoval(q: MatchQuad, removal: RepairRemoval): boolean {
  if (q.subject.value !== removal.subject) return false;
  if (q.predicate.value !== removal.predicate) return false;
  if (q.object.value !== removal.object) return false;

  if (removal.graph && quadGraphValue(q) !== removal.graph) return false;

  if (removal.objectTermType) {
    if ((q.object.termType ?? "") !== removal.objectTermType) return false;
    if (removal.objectTermType === "Literal") {
      const wantDatatype =
        removal.objectDatatype ?? (removal.objectLanguage ? "" : XSD_STRING);
      const dtVal = q.object.datatype?.value ?? XSD_STRING;
      if ((dtVal || XSD_STRING) !== (wantDatatype || XSD_STRING)) return false;
      const lang = q.object.language ?? "";
      if ((removal.objectLanguage ?? "") && lang !== removal.objectLanguage) return false;
    }
  }
  return true;
}
