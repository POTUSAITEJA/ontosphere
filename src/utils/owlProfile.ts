/**
 * owlProfile.ts
 *
 * PRAGMATIC SUBSET — NOT a complete OWL 2 DL profile validator.
 *
 * This module implements a deliberately incomplete, documented-as-subset check
 * over a flat list of RDF triples. It catches the high-frequency mistakes LLMs
 * make when authoring ontologies:
 *
 *   1. Object property used with a literal value (non-annotation triples only).
 *   2. Datatype property used with an IRI value.
 *   3. Property declared as both owl:ObjectProperty and owl:DatatypeProperty.
 *   4. Literal appearing in the object position of rdf:type.
 *
 * Annotation properties (rdfs:label, rdfs:comment, and predicates declared
 * owl:AnnotationProperty) are exempt from checks 1 and 2.
 */

// ────────────────────────────── Well-known IRIs ──────────────────────────────

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const OWL_OBJECT_PROPERTY = 'http://www.w3.org/2002/07/owl#ObjectProperty';
const OWL_DATATYPE_PROPERTY = 'http://www.w3.org/2002/07/owl#DatatypeProperty';
const OWL_ANNOTATION_PROPERTY = 'http://www.w3.org/2002/07/owl#AnnotationProperty';
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
const RDFS_COMMENT = 'http://www.w3.org/2000/01/rdf-schema#comment';

// ─────────────────────────────── Public types ────────────────────────────────

export interface ProfileTriple {
  subject: string;         // IRI
  predicate: string;       // IRI
  object: string;          // IRI or literal lexical value
  objectIsLiteral: boolean; // true if object is an RDF literal
}

export interface ProfileViolation {
  axiom: string;   // human-readable rendering of the offending triple
  reason: string;  // why it violates OWL 2 DL, plain language
}

export interface ProfileReport {
  owl2dl: boolean;           // false if any violation found
  violations: ProfileViolation[];
}

// ─────────────────────────────── Helpers ─────────────────────────────────────

function renderTriple(t: ProfileTriple): string {
  const obj = t.objectIsLiteral ? `"${t.object}"` : t.object;
  return `${t.subject} ${t.predicate} ${obj}`;
}

// ─────────────────────────────── Main export ─────────────────────────────────

export function checkOwl2Profile(triples: ProfileTriple[]): ProfileReport {
  const violations: ProfileViolation[] = [];

  // Pass 1: collect property type declarations and annotation properties.
  const objectProperties = new Set<string>();
  const datatypeProperties = new Set<string>();
  const annotationProperties = new Set<string>([RDFS_LABEL, RDFS_COMMENT]);

  for (const t of triples) {
    if (t.predicate === RDF_TYPE && !t.objectIsLiteral) {
      if (t.object === OWL_OBJECT_PROPERTY) {
        objectProperties.add(t.subject);
      } else if (t.object === OWL_DATATYPE_PROPERTY) {
        datatypeProperties.add(t.subject);
      } else if (t.object === OWL_ANNOTATION_PROPERTY) {
        annotationProperties.add(t.subject);
      }
    }
  }

  // Check 3: property declared as both ObjectProperty and DatatypeProperty.
  for (const iri of objectProperties) {
    if (datatypeProperties.has(iri)) {
      violations.push({
        axiom: iri,
        reason: `property declared as both object and datatype property`,
      });
    }
  }

  // Pass 2: check usage triples.
  for (const t of triples) {
    // Check 4: literal in rdf:type object position.
    if (t.predicate === RDF_TYPE && t.objectIsLiteral) {
      violations.push({
        axiom: renderTriple(t),
        reason: 'class position occupied by a literal',
      });
      continue;
    }

    // Skip annotation predicates for checks 1 and 2.
    if (annotationProperties.has(t.predicate)) {
      continue;
    }

    // Check 1: object property used with a literal object.
    if (objectProperties.has(t.predicate) && t.objectIsLiteral) {
      violations.push({
        axiom: renderTriple(t),
        reason: 'object property used with a literal value',
      });
    }

    // Check 2: datatype property used with an IRI object.
    if (datatypeProperties.has(t.predicate) && !t.objectIsLiteral) {
      violations.push({
        axiom: renderTriple(t),
        reason: 'datatype property used with an IRI value',
      });
    }
  }

  return {
    owl2dl: violations.length === 0,
    violations,
  };
}
