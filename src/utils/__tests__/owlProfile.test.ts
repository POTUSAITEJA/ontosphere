// src/utils/__tests__/owlProfile.test.ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { checkOwl2Profile, ProfileTriple } from '../owlProfile';

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const OWL_OBJECT_PROPERTY = 'http://www.w3.org/2002/07/owl#ObjectProperty';
const OWL_DATATYPE_PROPERTY = 'http://www.w3.org/2002/07/owl#DatatypeProperty';
const OWL_ANNOTATION_PROPERTY = 'http://www.w3.org/2002/07/owl#AnnotationProperty';
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
const RDFS_COMMENT = 'http://www.w3.org/2000/01/rdf-schema#comment';

const EX = 'http://example.org/';

function triple(
  subject: string,
  predicate: string,
  object: string,
  objectIsLiteral = false,
): ProfileTriple {
  return { subject, predicate, object, objectIsLiteral };
}

describe('checkOwl2Profile', () => {
  it('(a) clean triple set → owl2dl:true, no violations', () => {
    const triples: ProfileTriple[] = [
      // declare knows as ObjectProperty
      triple(`${EX}knows`, RDF_TYPE, OWL_OBJECT_PROPERTY),
      // declare age as DatatypeProperty
      triple(`${EX}age`, RDF_TYPE, OWL_DATATYPE_PROPERTY),
      // correct use: object property → IRI object
      triple(`${EX}Alice`, `${EX}knows`, `${EX}Bob`),
      // correct use: datatype property → literal
      triple(`${EX}Alice`, `${EX}age`, '30', true),
    ];
    const report = checkOwl2Profile(triples);
    expect(report.owl2dl).toBe(true);
    expect(report.violations).toHaveLength(0);
  });

  it('(b) object property used with literal → owl2dl:false, violation names the property', () => {
    const triples: ProfileTriple[] = [
      triple(`${EX}knows`, RDF_TYPE, OWL_OBJECT_PROPERTY),
      triple(`${EX}Alice`, `${EX}knows`, '42', true),
    ];
    const report = checkOwl2Profile(triples);
    expect(report.owl2dl).toBe(false);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].reason).toMatch(/object property used with a literal/i);
    expect(report.violations[0].axiom).toContain(`${EX}knows`);
  });

  it('(c) datatype property used with IRI object → violation', () => {
    const triples: ProfileTriple[] = [
      triple(`${EX}age`, RDF_TYPE, OWL_DATATYPE_PROPERTY),
      triple(`${EX}Alice`, `${EX}age`, `${EX}Bob`, false),
    ];
    const report = checkOwl2Profile(triples);
    expect(report.owl2dl).toBe(false);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].reason).toMatch(/datatype property used with an IRI/i);
    expect(report.violations[0].axiom).toContain(`${EX}age`);
  });

  it('(d) property declared both ObjectProperty and DatatypeProperty → violation', () => {
    const triples: ProfileTriple[] = [
      triple(`${EX}mixed`, RDF_TYPE, OWL_OBJECT_PROPERTY),
      triple(`${EX}mixed`, RDF_TYPE, OWL_DATATYPE_PROPERTY),
    ];
    const report = checkOwl2Profile(triples);
    expect(report.owl2dl).toBe(false);
    const v = report.violations.find((x) =>
      /both object and datatype/i.test(x.reason),
    );
    expect(v).toBeDefined();
    expect(v!.axiom).toContain(`${EX}mixed`);
  });

  it('(e) literal in rdf:type object position → violation', () => {
    const triples: ProfileTriple[] = [
      triple(`${EX}Alice`, RDF_TYPE, 'Person', true),
    ];
    const report = checkOwl2Profile(triples);
    expect(report.owl2dl).toBe(false);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].reason).toMatch(/class position occupied by a literal/i);
  });

  it('(f) literal on rdfs:label/rdfs:comment is NOT flagged', () => {
    const triples: ProfileTriple[] = [
      // object property declared correctly
      triple(`${EX}knows`, RDF_TYPE, OWL_OBJECT_PROPERTY),
      // annotation literals — must be ignored for check #1
      triple(`${EX}Alice`, RDFS_LABEL, 'Alice', true),
      triple(`${EX}Alice`, RDFS_COMMENT, 'A person named Alice.', true),
    ];
    const report = checkOwl2Profile(triples);
    expect(report.owl2dl).toBe(true);
    expect(report.violations).toHaveLength(0);
  });

  it('(g) literal on declared owl:AnnotationProperty is NOT flagged', () => {
    const triples: ProfileTriple[] = [
      triple(`${EX}notes`, RDF_TYPE, OWL_ANNOTATION_PROPERTY),
      triple(`${EX}Alice`, `${EX}notes`, 'some note', true),
    ];
    const report = checkOwl2Profile(triples);
    expect(report.owl2dl).toBe(true);
    expect(report.violations).toHaveLength(0);
  });
});
