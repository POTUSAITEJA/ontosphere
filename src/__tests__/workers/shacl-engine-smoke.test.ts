// @vitest-environment node
import { describe, it, expect } from 'vitest';

const OWL_CLASS = 'http://www.w3.org/2002/07/owl#Class';
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const SH = 'http://www.w3.org/ns/shacl#';
const EX = 'http://example.org/';

async function buildValidator() {
  const { Validator } = await import('shacl-engine') as any;
  const { targetResolvers } = await import('shacl-engine/sparql.js') as any;
  const dataModel = await import('@rdfjs/data-model') as any;
  const datasetMod = await import('@rdfjs/dataset') as any;

  const factory = dataModel.default ?? dataModel;
  const dataset = datasetMod.default?.dataset ?? datasetMod.dataset;

  return { Validator, targetResolvers, factory, dataset };
}

function buildShapesDataset(
  factory: any,
  dataset: () => any,
) {
  const ds = dataset();
  const shape = factory.namedNode(EX + 'ClassLabelShape');
  const target = factory.blankNode('t1');
  const propShape = factory.blankNode('p1');

  // Shape type
  ds.add(factory.quad(shape, factory.namedNode(RDF_TYPE), factory.namedNode(SH + 'NodeShape')));

  // SPARQL target
  ds.add(factory.quad(shape, factory.namedNode(SH + 'target'), target));
  ds.add(factory.quad(target, factory.namedNode(RDF_TYPE), factory.namedNode(SH + 'SPARQLTarget')));
  ds.add(factory.quad(
    target,
    factory.namedNode(SH + 'select'),
    factory.literal(`SELECT ?this WHERE { ?this a <${OWL_CLASS}> . FILTER(isIRI(?this)) }`),
  ));

  // Property constraint: sh:minCount 1 on rdfs:label
  ds.add(factory.quad(shape, factory.namedNode(SH + 'property'), propShape));
  ds.add(factory.quad(propShape, factory.namedNode(SH + 'path'), factory.namedNode(RDFS_LABEL)));
  ds.add(factory.quad(propShape, factory.namedNode(SH + 'minCount'), factory.literal('1', factory.namedNode('http://www.w3.org/2001/XMLSchema#integer'))));

  return ds;
}

describe('shacl-engine SPARQL target smoke test', () => {
  it('reports violation for named class without label', async () => {
    const { Validator, targetResolvers, factory, dataset } = await buildValidator();
    const shapesDs = buildShapesDataset(factory, dataset);

    const dataDs = dataset();
    dataDs.add(factory.quad(
      factory.namedNode(EX + 'MyClass'),
      factory.namedNode(RDF_TYPE),
      factory.namedNode(OWL_CLASS),
    ));

    const validator = new Validator(shapesDs, { factory, targetResolvers });
    const report = await validator.validate({ dataset: dataDs });

    expect(report.conforms).toBe(false);
    expect(report.results.length).toBe(1);
    expect(report.results[0].focusNode.value).toBe(EX + 'MyClass');
  });

  it('reports no violation for named class with label', async () => {
    const { Validator, targetResolvers, factory, dataset } = await buildValidator();
    const shapesDs = buildShapesDataset(factory, dataset);

    const dataDs = dataset();
    dataDs.add(factory.quad(
      factory.namedNode(EX + 'MyClass'),
      factory.namedNode(RDF_TYPE),
      factory.namedNode(OWL_CLASS),
    ));
    dataDs.add(factory.quad(
      factory.namedNode(EX + 'MyClass'),
      factory.namedNode(RDFS_LABEL),
      factory.literal('My Class'),
    ));

    const validator = new Validator(shapesDs, { factory, targetResolvers });
    const report = await validator.validate({ dataset: dataDs });

    expect(report.conforms).toBe(true);
    expect(report.results.length).toBe(0);
  });

  it('excludes blank-node class from SPARQL target', async () => {
    const { Validator, targetResolvers, factory, dataset } = await buildValidator();
    const shapesDs = buildShapesDataset(factory, dataset);

    const dataDs = dataset();
    // Blank node typed as owl:Class, no label — should NOT trigger violation
    const bnode = factory.blankNode('restriction1');
    dataDs.add(factory.quad(bnode, factory.namedNode(RDF_TYPE), factory.namedNode(OWL_CLASS)));

    const validator = new Validator(shapesDs, { factory, targetResolvers });
    const report = await validator.validate({ dataset: dataDs });

    expect(report.conforms).toBe(true);
    expect(report.results.length).toBe(0);
  });

  it('validates skolemized blank node (urn:vg:bnode:*) as IRI', async () => {
    const { Validator, targetResolvers, factory, dataset } = await buildValidator();
    const shapesDs = buildShapesDataset(factory, dataset);

    const dataDs = dataset();
    // Skolemized blank node — NamedNode so isIRI() returns true, should get violation
    const skolem = factory.namedNode('urn:vg:bnode:abc123');
    dataDs.add(factory.quad(skolem, factory.namedNode(RDF_TYPE), factory.namedNode(OWL_CLASS)));

    const validator = new Validator(shapesDs, { factory, targetResolvers });
    const report = await validator.validate({ dataset: dataDs });

    expect(report.conforms).toBe(false);
    expect(report.results.length).toBe(1);
    expect(report.results[0].focusNode.value).toBe('urn:vg:bnode:abc123');
  });
});
