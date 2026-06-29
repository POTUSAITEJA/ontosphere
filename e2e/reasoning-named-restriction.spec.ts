/**
 * Named-restriction MCP store inspection test.
 *
 * Seeds the exact same triples as the reasoning unit test (named-node variant)
 * via window.__mcpTools (addNode + addTriple), dumps the raw urn:vg:data quads,
 * runs reasoning, then checks ind1 classification.
 *
 * Purpose: verify that MCP tools write exactly the triples we expect and that
 * named restriction nodes reason correctly end-to-end in the live app.
 *
 * Requires: npm run dev (http://localhost:8080)
 */

import { test, expect } from '@playwright/test';
import { gotoAndWaitForReady, callTool, seedWithRetry } from './e2e-helpers.js';

const BASE_URL = process.env.VG_URL ?? 'http://localhost:8080';
const EX = 'http://example.org/collapse-test#';
const OWL = 'http://www.w3.org/2002/07/owl#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';

test('loadRdf blank-node restrictions: skolemized on canvas, reasoning classifies correctly', async ({ page }) => {
  await gotoAndWaitForReady(page, BASE_URL, 'loadRdf');

  // NB: use the `ct:` prefix, not `ex:` — the app reserves `ex:` for
  // http://example.org/ (iriUtils built-in), which would override this
  // document's @prefix and break the collapse-test# IRIs asserted below.
  // Classes and the object property are declared (`a owl:Class` /
  // `a owl:ObjectProperty`): Konclude only performs ABox individual
  // classification for declared classes that carry equivalentClass restrictions.
  const turtle = `
@prefix ct: <http://example.org/collapse-test#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .

ct:hasPart a owl:ObjectProperty .
ct:FillerA a owl:Class .
ct:FillerB a owl:Class .

ct:ClassA a owl:Class ;
    owl:equivalentClass [
    rdf:type owl:Restriction ;
    owl:onProperty ct:hasPart ;
    owl:someValuesFrom ct:FillerA
] .

ct:ClassB a owl:Class ;
    owl:equivalentClass [
    rdf:type owl:Restriction ;
    owl:onProperty ct:hasPart ;
    owl:someValuesFrom ct:FillerB
] .

ct:ind1 rdf:type owl:NamedIndividual ;
    ct:hasPart ct:p1 .

ct:p1 rdf:type ct:FillerA .
`;

  await callTool(page, 'loadRdf', { turtle }, BASE_URL);

  const linksResult = await callTool(page, 'getLinks', { limit: 500 }, BASE_URL) as any;
  const dataQuads: Array<{ subject: string; predicate: string; object: string }> =
    linksResult?.data?.links ?? [];

  // No raw blank-node subjects in the store
  const rawBnodes = dataQuads.filter(q => q.subject.startsWith('_:'));
  expect(rawBnodes).toHaveLength(0);

  // Skolemized restriction nodes present
  const skolemNodes = dataQuads.filter(q => q.subject.startsWith('urn:vg:bnode:'));
  expect(skolemNodes.length).toBeGreaterThan(0);

  // Run reasoning and verify ind1 → ClassA only
  await callTool(page, 'runReasoning', { rulesets: ['owl-rl.n3'] }, BASE_URL);

  const details = await callTool(page, 'getNodeDetails', { iri: `${EX}ind1` }, BASE_URL) as any;
  const types: string[] = details?.data?.types ?? [];

  // getNodeDetails returns CURIE/abbreviated forms (e.g. "ct:ClassA"), so compare
  // by local name rather than full IRI.
  const localNames = types.map((t) => t.split(/[#/:]/).pop());
  expect(localNames).toContain('ClassA');
  expect(localNames).not.toContain('ClassB');
});

test('named restriction nodes: MCP seeds correct triples and reasoning classifies correctly', async ({ page }) => {
  await gotoAndWaitForReady(page, BASE_URL);

  // Seed via addNode/addTriple — wrapped in seedWithRetry so a COI reload
  // mid-sequence re-navigates and re-seeds from scratch.
  await seedWithRetry(page, BASE_URL, async (call) => {
    // ── Seed TBox: named restriction nodes ─────────────────────────────────

    // R1: someValuesFrom FillerA
    await call('addNode', { iri: `${EX}R1`, typeIri: `${OWL}Restriction` });
    await call('addTriple', { subjectIri: `${EX}R1`, predicateIri: `${OWL}onProperty`,      objectIri: `${EX}hasPart` });
    await call('addTriple', { subjectIri: `${EX}R1`, predicateIri: `${OWL}someValuesFrom`,  objectIri: `${EX}FillerA` });

    // R2: someValuesFrom FillerB (same onProperty, different filler)
    await call('addNode', { iri: `${EX}R2`, typeIri: `${OWL}Restriction` });
    await call('addTriple', { subjectIri: `${EX}R2`, predicateIri: `${OWL}onProperty`,      objectIri: `${EX}hasPart` });
    await call('addTriple', { subjectIri: `${EX}R2`, predicateIri: `${OWL}someValuesFrom`,  objectIri: `${EX}FillerB` });

    // ClassA ≡ R1, ClassB ≡ R2
    await call('addNode', { iri: `${EX}ClassA`, typeIri: `${OWL}Class` });
    await call('addNode', { iri: `${EX}ClassB`, typeIri: `${OWL}Class` });
    await call('addTriple', { subjectIri: `${EX}ClassA`, predicateIri: `${OWL}equivalentClass`, objectIri: `${EX}R1` });
    await call('addTriple', { subjectIri: `${EX}ClassB`, predicateIri: `${OWL}equivalentClass`, objectIri: `${EX}R2` });

    // Declare the filler classes and the object property.
    await call('addNode', { iri: `${EX}hasPart`, typeIri: `${OWL}ObjectProperty` });
    await call('addNode', { iri: `${EX}FillerA`, typeIri: `${OWL}Class` });
    await call('addNode', { iri: `${EX}FillerB`, typeIri: `${OWL}Class` });

    // ── Seed ABox ───────────────────────────────────────────────────────────

    // ind1 hasPart p1; p1 type FillerA only
    await call('addNode', { iri: `${EX}ind1`, typeIri: `${OWL}NamedIndividual` });
    await call('addNode', { iri: `${EX}p1`,   typeIri: `${EX}FillerA` });
    await call('addTriple', { subjectIri: `${EX}ind1`, predicateIri: `${EX}hasPart`, objectIri: `${EX}p1` });
  });

  // ── Dump urn:vg:data to inspect what actually landed ───────────────────

  const linksResult = await callTool(page, 'getLinks', { limit: 500 }, BASE_URL) as any;
  const dataQuads: Array<{ subject: string; predicate: string; object: string }> =
    linksResult?.data?.links ?? [];

  console.log('[TEST] urn:vg:data quads after seeding:');
  for (const q of dataQuads) console.log(' ', q.subject, q.predicate, q.object);

  // Verify key triples are present
  const has = (s: string, p: string, o: string) =>
    dataQuads.some(q => q.subject === s && q.predicate === p && q.object === o);

  expect(has(`${EX}R1`, `${RDF}type`,             `${OWL}Restriction`)).toBe(true);
  expect(has(`${EX}R1`, `${OWL}onProperty`,        `${EX}hasPart`)).toBe(true);
  expect(has(`${EX}R1`, `${OWL}someValuesFrom`,    `${EX}FillerA`)).toBe(true);
  expect(has(`${EX}R2`, `${RDF}type`,             `${OWL}Restriction`)).toBe(true);
  expect(has(`${EX}R2`, `${OWL}onProperty`,        `${EX}hasPart`)).toBe(true);
  expect(has(`${EX}R2`, `${OWL}someValuesFrom`,    `${EX}FillerB`)).toBe(true);
  expect(has(`${EX}ClassA`, `${OWL}equivalentClass`, `${EX}R1`)).toBe(true);
  expect(has(`${EX}ClassB`, `${OWL}equivalentClass`, `${EX}R2`)).toBe(true);
  expect(has(`${EX}p1`, `${RDF}type`,             `${EX}FillerA`)).toBe(true);
  expect(has(`${EX}ind1`, `${EX}hasPart`,          `${EX}p1`)).toBe(true);

  // ── Run OWL-RL reasoning ────────────────────────────────────────────────

  const reasoningResult = await callTool(page, 'runReasoning', { rulesets: ['owl-rl.n3'] }, BASE_URL);
  console.log('[TEST] Reasoning result:', JSON.stringify(reasoningResult));

  // ── Inspect ind1 after reasoning ────────────────────────────────────────

  const details = await callTool(page, 'getNodeDetails', { iri: `${EX}ind1` }, BASE_URL) as any;
  console.log('[TEST] ind1 details after reasoning:', JSON.stringify(details));

  const types: string[] = details?.data?.types ?? [];
  console.log('[TEST] ind1 inferred types:', types);

  // getNodeDetails returns CURIE/abbreviated forms (e.g. "ex:collapse-test#ClassA"),
  // so compare by local name rather than full IRI.
  const localNames = types.map((t) => t.split(/[#/:]/).pop());
  // ind1 must be classified as ClassA (has FillerA filler)
  expect(localNames).toContain('ClassA');
  // ind1 must NOT be classified as ClassB (no FillerB filler)
  expect(localNames).not.toContain('ClassB');
});
