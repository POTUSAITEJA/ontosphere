// @vitest-environment node
/**
 * Konclude OWL DL reasoning test using the public/reasoning-demo.ttl ontology.
 *
 * Tests that Konclude infers the full OWL DL hierarchy and ABox entailments.
 *
 * Uses RdfReasoner directly (bypasses the rdfManager worker pipeline) so it
 * runs in Node.js without SharedArrayBuffer / browser Worker setup.
 *
 * v0.2.1 API split:
 *   reason(store)  — TBox only (direct subClassOf chain + owl:Thing)
 *   materialize(store, { includeClassHierarchy: true }) — full DL output (TBox + ABox)
 */
import { describe, it, expect } from "vitest";
import { RdfReasoner, INFERRED_GRAPH_IRI } from "rdf-reasoner-konclude";
import * as N3 from "n3";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EX = "http://example.com/reasoning-demo#";
const RDFS_SUB_CLASS_OF = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

function loadDemoStore(): N3.Store {
  const ttlPath = path.resolve(__dirname, "../../../public/reasoning-demo.ttl");
  const ttlContent = fs.readFileSync(ttlPath, "utf-8");
  const store = new N3.Store();
  const parser = new N3.Parser({ format: "text/turtle" });
  store.addQuads(parser.parse(ttlContent));
  return store;
}

describe("Konclude DL reasoning: reasoning-demo.ttl", () => {
  let reasoner: RdfReasoner;

  it(
    "reason() returns TBox-only direct taxonomy",
    async () => {
      try {
        reasoner = new RdfReasoner();
        await reasoner.ready;
      } catch (e) {
        console.warn(
          "[TEST] Konclude WASM unavailable in this environment — skipping:",
          String(e),
        );
        return;
      }

      const store = loadDemoStore();
      await reasoner.reason(store);

      const inferredGraph = N3.DataFactory.namedNode(INFERRED_GRAPH_IRI);
      const inferred = store.getQuads(null, null, null, inferredGraph);

      console.log("[TEST] reason() inferred triple count:", inferred.length);
      console.log(
        "[TEST] reason() triples:",
        inferred.map(
          (q) => `${q.subject.value.replace(EX, "ex:")} ${q.predicate.value.split("#")[1] ?? q.predicate.value} ${q.object.value.replace(EX, "ex:")}`,
        ),
      );

      // v0.2.1: reason() returns TBox only — 4 triples (3 direct subClassOf edges + Person→owl:Thing)
      expect(inferred.length).toBe(4);

      // Person subClassOf owl:Thing — NOT in source, inferred (all OWL classes subclass owl:Thing)
      const OWL_THING = "http://www.w3.org/2002/07/owl#Thing";
      expect(
        inferred.some(
          (q) =>
            q.subject.value === `${EX}Person` &&
            q.predicate.value === RDFS_SUB_CLASS_OF &&
            q.object.value === OWL_THING,
        ),
      ).toBe(true);

      // Direct hierarchy edges echoed from source
      expect(
        inferred.some(
          (q) =>
            q.subject.value === `${EX}Employee` &&
            q.predicate.value === RDFS_SUB_CLASS_OF &&
            q.object.value === `${EX}Person`,
        ),
      ).toBe(true);

      // Lock in echo count: 3 direct subClassOf edges (Employee→Person, Manager→Employee, Executive→Manager)
      const sourceKeys = new Set(
        store
          .getQuads(null, null, null, N3.DataFactory.defaultGraph())
          .map((q) => `${q.subject.value} ${q.predicate.value} ${q.object.value}`),
      );
      const echoed = inferred.filter((q) =>
        sourceKeys.has(`${q.subject.value} ${q.predicate.value} ${q.object.value}`),
      );
      console.log("[TEST] reason() echoed:", echoed.length, "| genuinely new:", inferred.length - echoed.length);
      expect(echoed.length).toBe(3);
    },
    30000,
  );

  it(
    "materialize() surfaces full DL output: TBox + ABox entailments",
    async () => {
      if (!reasoner) {
        try {
          reasoner = new RdfReasoner();
          await reasoner.ready;
        } catch (e) {
          console.warn("[TEST] Konclude WASM unavailable — skipping:", String(e));
          return;
        }
      }

      const store = loadDemoStore();
      try {
        await reasoner.materialize(store, { includeClassHierarchy: true });
      } finally {
        reasoner.terminate();
      }

      const inferredGraph = N3.DataFactory.namedNode(INFERRED_GRAPH_IRI);
      const inferred = store.getQuads(null, null, null, inferredGraph);

      console.log("[TEST] materialize() inferred triple count:", inferred.length);

      // Full DL output: 27 triples (12 echoed source + 15 genuinely new)
      expect(inferred.length).toBe(27);

      // TBox: Person subClassOf owl:Thing
      const OWL_THING = "http://www.w3.org/2002/07/owl#Thing";
      expect(
        inferred.some(
          (q) =>
            q.subject.value === `${EX}Person` &&
            q.predicate.value === RDFS_SUB_CLASS_OF &&
            q.object.value === OWL_THING,
        ),
      ).toBe(true);

      // ABox: subClassOf chain — alice is Executive, infer Manager/Employee/Person
      expect(inferred.some((q) => q.subject.value === `${EX}alice` && q.predicate.value === RDF_TYPE && q.object.value === `${EX}Manager`)).toBe(true);
      expect(inferred.some((q) => q.subject.value === `${EX}alice` && q.predicate.value === RDF_TYPE && q.object.value === `${EX}Employee`)).toBe(true);
      expect(inferred.some((q) => q.subject.value === `${EX}alice` && q.predicate.value === RDF_TYPE && q.object.value === `${EX}Person`)).toBe(true);

      // ABox: subPropertyOf — hasFriend infers knows
      expect(inferred.some((q) => q.subject.value === `${EX}alice` && q.predicate.value === `${EX}knows` && q.object.value === `${EX}bob`)).toBe(true);

      // ABox: inverseOf — manages infers isManagedBy
      expect(inferred.some((q) => q.subject.value === `${EX}carol` && q.predicate.value === `${EX}isManagedBy` && q.object.value === `${EX}alice`)).toBe(true);
      expect(inferred.some((q) => q.subject.value === `${EX}bob` && q.predicate.value === `${EX}isManagedBy` && q.object.value === `${EX}dave`)).toBe(true);

      // ABox: SymmetricProperty — isColleagueOf reverse
      expect(inferred.some((q) => q.subject.value === `${EX}carol` && q.predicate.value === `${EX}isColleagueOf` && q.object.value === `${EX}bob`)).toBe(true);

      // ABox: TransitiveProperty — carol hasSupervisor alice (via bob)
      expect(inferred.some((q) => q.subject.value === `${EX}carol` && q.predicate.value === `${EX}hasSupervisor` && q.object.value === `${EX}alice`)).toBe(true);

      // ABox: domain inference — dave type Manager (from dave manages bob; manages domain Manager)
      expect(inferred.some((q) => q.subject.value === `${EX}dave` && q.predicate.value === RDF_TYPE && q.object.value === `${EX}Manager`)).toBe(true);
      // ABox: range inference — bob type Manager (from carol hasSupervisor bob; hasSupervisor range Manager)
      expect(inferred.some((q) => q.subject.value === `${EX}bob` && q.predicate.value === RDF_TYPE && q.object.value === `${EX}Manager`)).toBe(true);

      // Lock in totals
      const sourceKeys = new Set(
        store
          .getQuads(null, null, null, N3.DataFactory.defaultGraph())
          .map((q) => `${q.subject.value} ${q.predicate.value} ${q.object.value}`),
      );
      const echoed = inferred.filter((q) =>
        sourceKeys.has(`${q.subject.value} ${q.predicate.value} ${q.object.value}`),
      );
      console.log("[TEST] materialize() echoed:", echoed.length, "| genuinely new:", inferred.length - echoed.length);
      expect(echoed.length).toBe(12);
      expect(inferred.length - echoed.length).toBe(15);
    },
    30000,
  );
});
