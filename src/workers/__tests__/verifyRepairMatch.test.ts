// src/workers/__tests__/verifyRepairMatch.test.ts
//
// BUG B — the pure matcher that makes VERIFY and APPLY agree on which triple is
// the repaired axiom. The runtime feeds this exact predicate real N3 quads, so
// covering it here proves verifyRepair excludes the IDENTICAL triple removeLink
// removes (precise graph + typed/lang literal), not a same-lexical sibling.

import { describe, it, expect } from "vitest";
import { quadMatchesRemoval, type MatchQuad, type RepairRemoval } from "../verifyRepairMatch";

const XSD_INT = "http://www.w3.org/2001/XMLSchema#integer";
const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

function quad(
  s: string,
  p: string,
  o: { value: string; termType?: string; datatype?: string; language?: string },
  graph?: string,
): MatchQuad {
  return {
    subject: { value: s, termType: "NamedNode" },
    predicate: { value: p, termType: "NamedNode" },
    object: {
      value: o.value,
      termType: o.termType ?? "NamedNode",
      ...(o.datatype ? { datatype: { value: o.datatype } } : {}),
      ...(o.language ? { language: o.language } : {}),
    },
    graph: graph
      ? { value: graph, termType: "NamedNode" }
      : { value: "", termType: "DefaultGraph" },
  };
}

const S = "http://ex/A";
const P = "http://www.w3.org/2002/07/owl#disjointWith";
const O = "http://ex/B";

describe("quadMatchesRemoval — BUG B graph scoping", () => {
  const dataQuad = quad(S, P, { value: O }, "urn:vg:data");
  const ontQuad = quad(S, P, { value: O }, "urn:vg:ontologies");

  it("a removal pinned to urn:vg:ontologies matches ONLY the ontologies quad", () => {
    const removal: RepairRemoval = {
      subject: S, predicate: P, object: O, objectTermType: "NamedNode", graph: "urn:vg:ontologies",
    };
    expect(quadMatchesRemoval(ontQuad, removal)).toBe(true);
    // The identical-lexical data-graph quad must NOT match — otherwise verify
    // would "succeed" against a triple apply (graph-scoped) never touches.
    expect(quadMatchesRemoval(dataQuad, removal)).toBe(false);
  });

  it("a removal pinned to urn:vg:data matches ONLY the data quad", () => {
    const removal: RepairRemoval = {
      subject: S, predicate: P, object: O, graph: "urn:vg:data",
    };
    expect(quadMatchesRemoval(dataQuad, removal)).toBe(true);
    expect(quadMatchesRemoval(ontQuad, removal)).toBe(false);
  });

  it("back-compat: a graphless removal matches a quad in ANY graph", () => {
    const removal: RepairRemoval = { subject: S, predicate: P, object: O };
    expect(quadMatchesRemoval(dataQuad, removal)).toBe(true);
    expect(quadMatchesRemoval(ontQuad, removal)).toBe(true);
  });
});

describe("quadMatchesRemoval — BUG B typed-literal precision", () => {
  const intQuad = quad("http://ex/i", "http://ex/age", { value: "42", termType: "Literal", datatype: XSD_INT }, "urn:vg:data");
  const strQuad = quad("http://ex/i", "http://ex/age", { value: "42", termType: "Literal" }, "urn:vg:data"); // xsd:string

  it("a removal of \"42\"^^xsd:integer matches the integer literal, NOT the same-lexical string", () => {
    const removal: RepairRemoval = {
      subject: "http://ex/i", predicate: "http://ex/age", object: "42",
      objectTermType: "Literal", objectDatatype: XSD_INT, graph: "urn:vg:data",
    };
    expect(quadMatchesRemoval(intQuad, removal)).toBe(true);
    expect(quadMatchesRemoval(strQuad, removal)).toBe(false);
  });

  it("a removal of an untyped (xsd:string) literal matches the string, NOT the integer", () => {
    const removal: RepairRemoval = {
      subject: "http://ex/i", predicate: "http://ex/age", object: "42",
      objectTermType: "Literal", objectDatatype: XSD_STRING, graph: "urn:vg:data",
    };
    expect(quadMatchesRemoval(strQuad, removal)).toBe(true);
    expect(quadMatchesRemoval(intQuad, removal)).toBe(false);
  });

  it("a language-tagged literal matches only its language tag", () => {
    const enQuad = quad("http://ex/i", "http://www.w3.org/2000/01/rdf-schema#label", { value: "Pizza", termType: "Literal", language: "en" });
    const deQuad = quad("http://ex/i", "http://www.w3.org/2000/01/rdf-schema#label", { value: "Pizza", termType: "Literal", language: "de" });
    const removal: RepairRemoval = {
      subject: "http://ex/i", predicate: "http://www.w3.org/2000/01/rdf-schema#label", object: "Pizza",
      objectTermType: "Literal", objectLanguage: "en",
    };
    expect(quadMatchesRemoval(enQuad, removal)).toBe(true);
    expect(quadMatchesRemoval(deQuad, removal)).toBe(false);
  });

  it("term-type guards an IRI removal against a same-lexical literal (and vice versa)", () => {
    const iriObj = quad(S, P, { value: O, termType: "NamedNode" }, "urn:vg:data");
    const litObj = quad(S, P, { value: O, termType: "Literal" }, "urn:vg:data");
    const iriRemoval: RepairRemoval = { subject: S, predicate: P, object: O, objectTermType: "NamedNode" };
    expect(quadMatchesRemoval(iriObj, iriRemoval)).toBe(true);
    expect(quadMatchesRemoval(litObj, iriRemoval)).toBe(false);
  });
});

describe("quadMatchesRemoval — VERIFY/APPLY agreement invariant", () => {
  it("the same metadata that the apply path uses selects exactly one of two graph copies", () => {
    // Two identical-lexical quads in different graphs (the apply path removes the
    // one in `graph`). Verify, using the SAME metadata, must select the SAME one.
    const copies = [
      quad(S, P, { value: O }, "urn:vg:data"),
      quad(S, P, { value: O }, "urn:vg:ontologies"),
    ];
    const removal: RepairRemoval = {
      subject: S, predicate: P, object: O, objectTermType: "NamedNode", graph: "urn:vg:ontologies",
    };
    const matched = copies.filter((q) => quadMatchesRemoval(q, removal));
    expect(matched).toHaveLength(1);
    expect(matched[0].graph?.value).toBe("urn:vg:ontologies");
  });
});
