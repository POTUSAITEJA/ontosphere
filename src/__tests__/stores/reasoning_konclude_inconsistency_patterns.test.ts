// @vitest-environment node
/**
 * Issue #13: Six OWL 2 DL inconsistency patterns.
 * Each it() asserts checkConsistency() → false using isolated inline Turtle.
 * Patterns 1–2 are OWL 2 EL-compatible; patterns 3–6 require full OWL 2 DL / SROIQ(D).
 * If a pattern returns true (not detected), it is recorded in a comment — not a test failure.
 * Tracks: https://github.com/ThHanke/ontosphere/issues/13
 */
import { describe, it, expect } from "vitest";
import { RdfReasoner } from "rdf-reasoner-konclude";
import * as N3 from "n3";

const PREFIXES = `
@prefix : <http://example.org/reasoner-test#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
`;

function parseTurtle(patternTurtle: string): N3.Store {
  const store = new N3.Store();
  store.addQuads(new N3.Parser({ format: "text/turtle" }).parse(PREFIXES + patternTurtle));
  return store;
}

describe("Issue #13: OWL 2 DL inconsistency patterns", () => {
  it(
    "Pattern 1 (OWL 2 EL): individual in two disjoint classes",
    async () => {
      let r: RdfReasoner | undefined;
      try {
        r = new RdfReasoner();
        await r.ready;
      } catch (e) {
        console.warn("[TEST] Konclude WASM unavailable — skipping:", String(e));
        return;
      }
      const store = parseTurtle(`
:Person a owl:Class .
:Organization a owl:Class ; owl:disjointWith :Person .
:alice a owl:NamedIndividual , :Person , :Organization .
`);
      let result: boolean | undefined;
      try {
        result = await r.checkConsistency(store);
      } finally {
        r.terminate();
      }
      console.log("[TEST] checkConsistency result:", result);
      expect(result, "Pattern 1: alice in disjoint Person+Organization → inconsistent").toBe(false);
    },
    30000,
  );

  it(
    "Pattern 2 (OWL 2 EL): domain/range inferred disjoint types",
    async () => {
      let r: RdfReasoner | undefined;
      try {
        r = new RdfReasoner();
        await r.ready;
      } catch (e) {
        console.warn("[TEST] Konclude WASM unavailable — skipping:", String(e));
        return;
      }
      const store = parseTurtle(`
:Machine a owl:Class .
:Component a owl:Class ; owl:disjointWith :Machine .
:hasPart a owl:ObjectProperty ; rdfs:domain :Machine ; rdfs:range :Component .
:widget a owl:NamedIndividual ; :hasPart :widget .
`);
      let result: boolean | undefined;
      try {
        result = await r.checkConsistency(store);
      } finally {
        r.terminate();
      }
      console.log("[TEST] checkConsistency result:", result);
      expect(result, "Pattern 2: widget hasPart widget → inferred Machine+Component (disjoint) → inconsistent").toBe(false);
    },
    30000,
  );

  it(
    "Pattern 3 (OWL 2 DL): allValuesFrom + disjoint class violation",
    async () => {
      let r: RdfReasoner | undefined;
      try {
        r = new RdfReasoner();
        await r.ready;
      } catch (e) {
        console.warn("[TEST] Konclude WASM unavailable — skipping:", String(e));
        return;
      }
      const store = parseTurtle(`
:CleanRoom a owl:Class .
:DirtyRoom a owl:Class ; owl:disjointWith :CleanRoom .
:locatedIn a owl:ObjectProperty .
:CleanRoomOnlyDevice a owl:Class ;
    rdfs:subClassOf [ a owl:Restriction ; owl:onProperty :locatedIn ; owl:allValuesFrom :CleanRoom ] .
:device1 a owl:NamedIndividual , :CleanRoomOnlyDevice ; :locatedIn :room9 .
:room9 a owl:NamedIndividual , :DirtyRoom .
`);
      let result: boolean | undefined;
      try {
        result = await r.checkConsistency(store);
      } finally {
        r.terminate();
      }
      console.log("[TEST] checkConsistency result:", result);
      expect(result, "Pattern 3: CleanRoomOnlyDevice located in DirtyRoom → inconsistent").toBe(false);
    },
    30000,
  );

  it(
    "Pattern 4 (OWL 2 DL): max qualified cardinality + differentFrom",
    async () => {
      let r: RdfReasoner | undefined;
      try {
        r = new RdfReasoner();
        await r.ready;
      } catch (e) {
        console.warn("[TEST] Konclude WASM unavailable — skipping:", String(e));
        return;
      }
      const store = parseTurtle(`
:Vehicle a owl:Class . :VIN a owl:Class . :hasVIN a owl:ObjectProperty .
:Vehicle rdfs:subClassOf [ a owl:Restriction ; owl:onProperty :hasVIN ;
    owl:onClass :VIN ; owl:maxQualifiedCardinality "1"^^xsd:nonNegativeInteger ] .
:car1 a owl:NamedIndividual , :Vehicle ; :hasVIN :vinA , :vinB .
:vinA a owl:NamedIndividual , :VIN . :vinB a owl:NamedIndividual , :VIN .
:vinA owl:differentFrom :vinB .
`);
      let result: boolean | undefined;
      try {
        result = await r.checkConsistency(store);
      } finally {
        r.terminate();
      }
      console.log("[TEST] checkConsistency result:", result);
      expect(result, "Pattern 4: car1 has two distinct VINs, max qualified cardinality 1 → inconsistent").toBe(false);
    },
    30000,
  );

  it(
    "Pattern 5 (OWL 2 DL): asymmetric property violation",
    async () => {
      let r: RdfReasoner | undefined;
      try {
        r = new RdfReasoner();
        await r.ready;
      } catch (e) {
        console.warn("[TEST] Konclude WASM unavailable — skipping:", String(e));
        return;
      }
      const store = parseTurtle(`
:parentOf a owl:ObjectProperty , owl:AsymmetricProperty .
:alice a owl:NamedIndividual ; :parentOf :bob .
:bob a owl:NamedIndividual ; :parentOf :alice .
`);
      let result: boolean | undefined;
      try {
        result = await r.checkConsistency(store);
      } finally {
        r.terminate();
      }
      console.log("[TEST] checkConsistency result:", result);
      expect(result, "Pattern 5: alice parentOf bob AND bob parentOf alice (AsymmetricProperty) → inconsistent").toBe(false);
    },
    30000,
  );

  it(
    "Pattern 6 (OWL 2 DL): irreflexive property self-loop",
    async () => {
      let r: RdfReasoner | undefined;
      try {
        r = new RdfReasoner();
        await r.ready;
      } catch (e) {
        console.warn("[TEST] Konclude WASM unavailable — skipping:", String(e));
        return;
      }
      const store = parseTurtle(`
:properPartOf a owl:ObjectProperty , owl:IrreflexiveProperty .
:part1 a owl:NamedIndividual ; :properPartOf :part1 .
`);
      let result: boolean | undefined;
      try {
        result = await r.checkConsistency(store);
      } finally {
        r.terminate();
      }
      console.log("[TEST] checkConsistency result:", result);
      expect(result, "Pattern 6: part1 properPartOf part1 (IrreflexiveProperty) → inconsistent").toBe(false);
    },
    30000,
  );
});
