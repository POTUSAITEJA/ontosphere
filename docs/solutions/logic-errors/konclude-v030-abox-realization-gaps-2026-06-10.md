---
module: rdf-reasoner-konclude
tags: [konclude, owl2, abox-realization, mateiralize, cardinality, nominal-classes, known-limitations]
problem_type: reasoning-gap
---

# Konclude v0.3.0: ABox realization gaps — owl:minCardinality and owl:oneOf

**Discovered:** 2026-06-10 during OWL 2 DL demo expansion (feat/owl2dl-demo-expansion).
**Reproduced in:** `rdf-reasoner-konclude` v0.3.0, `materialize(store, { includeClassHierarchy: true })`.

## Symptoms

Two OWL 2 DL constructs that should produce new `rdf:type` triples in ABox realization do not fire:

### 1. `owl:minCardinality` / `owl:minQualifiedCardinality` — no ABox type inference

**What should happen:**  
If `ex:TeamLead owl:equivalentClass [owl:onProperty ex:manages; owl:minCardinality 2]` and `dave manages bob, dave manages eve` (with `bob owl:differentFrom eve`), then `materialize()` should infer `dave rdf:type ex:TeamLead`.

**What actually happens:**  
`dave rdf:type ex:TeamLead` is NOT written to `INFERRED_GRAPH_IRI`. The class appears in TBox classification (`classify()`) and in `checkConsistency()` correctly (violations are detected), but ABox realization via `materialize()` does not produce the inferred individual type.

Confirmed for both:
- `owl:minCardinality 2` (unqualified, xsd:integer)
- `owl:minQualifiedCardinality "2"^^xsd:nonNegativeInteger` with `owl:onClass owl:Thing`

### 2. `owl:oneOf` (nominal class) — no ABox type inference

**What should happen:**  
If `ex:LeadershipTeam owl:oneOf (ex:alice ex:dave)`, then `materialize()` should infer `alice rdf:type ex:LeadershipTeam` and `dave rdf:type ex:LeadershipTeam`.

**What actually happens:**  
Only `ex:LeadershipTeam rdfs:subClassOf owl:Thing` is written to the inferred graph. Individual type assertions for `alice` and `dave` are NOT produced.

## Workarounds

### Cardinality (minCardinality) — use owl:intersectionOf + someValuesFrom

Instead of:
```turtle
ex:TeamLead owl:equivalentClass [
    a owl:Restriction ;
    owl:onProperty ex:manages ;
    owl:minCardinality 2
] .
```

Use an intersection of two `someValuesFrom` restrictions that the ABox can satisfy with distinct values from the existing class hierarchy:
```turtle
ex:TeamLead a owl:Class ;
    owl:equivalentClass [
        a owl:Class ;
        owl:intersectionOf (
            [ a owl:Restriction ; owl:onProperty ex:manages ; owl:someValuesFrom ex:Manager ]
            [ a owl:Restriction ; owl:onProperty ex:manages ; owl:someValuesFrom ex:Employee ]
        )
    ] .
```

**Trade-off:** This expresses "manages at least one Manager AND at least one Employee", not "manages at least 2". It works for the demo's intent (dave manages bob=inferred Manager, eve=Employee), but does not generalize to arbitrary N-ary cardinality.

### Nominal class (owl:oneOf) — use owl:equivalentClass with owl:unionOf

Instead of:
```turtle
ex:LeadershipTeam owl:oneOf (ex:alice ex:dave) .
```

Use a class union over existing named classes:
```turtle
ex:LeadershipTeam a owl:Class ;
    owl:equivalentClass [ a owl:Class ; owl:unionOf (ex:Executive ex:Manager) ] .
```

**Note:** `[ owl:unionOf (...) ]` blank node **must** carry `a owl:Class` or Konclude emits "Couldn't extract minimal required 2 Class-Expressions, extracted Class-Expressions 1" and silently skips the equivalentClass expression.

Similarly `[ owl:complementOf ex:Employee ]` blank node must carry `a owl:Class`.

## Context for fixing in rdf-reasoner-konclude

Both gaps are in Konclude's WASM binary, not in the TypeScript wrapper. The TypeScript layer passes triples verbatim; Konclude's realizer is responsible for producing individual type assertions from cardinality and nominal class axioms.

**For `owl:minCardinality`:** Konclude's `classify()` correctly identifies the class in the TBox hierarchy, suggesting parsing is fine but the individual realization step does not consume cardinality axioms. The realizer may only handle role-fillers collected from universal/existential restrictions, not counting constraints.

**For `owl:oneOf`:** Konclude's OWL 2 EL mode can enumerate nominal class members for consistency checking (since nominals are part of OWL 2 EL), but the materializer does not close the enumeration back to individual `rdf:type` triples.

**Tests to add to rdf-reasoner-konclude to track these:**  
See `src/__tests__/stores/reasoning_konclude_advanced_constructs.test.ts` in ontosphere for the exact minimal inline Turtle needed to reproduce both.
