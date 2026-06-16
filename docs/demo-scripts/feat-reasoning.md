# Screenplay: OWL 2 DL Reasoning

A focused 90-second demo showing in-browser OWL 2 DL reasoning via Konclude WASM:
running the reasoner, inspecting inferred triples, consistency check, and ABox type
inspection. Uses `public/reasoning-demo.ttl`.

---

## Scene 1 — Load Ontology (10 s)

Load `reasoning-demo.ttl`. Layout and expand in TBox view. Show the 13 classes and
11 properties with their OWL 2 DL axioms (restrictions, cardinality, disjointness,
property chains).

Caption "OWL 2 DL ontology loaded — 13 patterns ready for reasoning". Pause.

## Scene 2 — Run Reasoning (20 s)

Run `runReasoning`. A spinner appears while Konclude processes the ontology in WASM.

After completion: new amber dashed edges and amber italic type annotations appear.
Expand all nodes and re-layout to surface all inferred links.

Caption "Running OWL 2 DL reasoning (Konclude WASM)..."
After completion: "Reasoning complete — inferred triples shown in amber". Pause.

## Scene 3 — Inspect ABox (15 s)

Switch to ABox view. Layout and expand all individuals.

Caption "ABox after reasoning — individuals with inferred types". Pause.

## Scene 4 — Dave's Inferred Types (15 s)

Focus on Dave — he had no explicit `rdf:type`. Expand his property card.

The reasoner inferred: Manager (domain of `manages`), TeamLead (manages both
Manager and Employee), LeadershipTeam (union of Executive and Manager).

Caption "Dave — Manager, TeamLead, LeadershipTeam all inferred". Pause.

## Scene 5 — Carol's Restriction Types (15 s)

Focus on Carol. Expand her property card.

The reasoner inferred: DirectReport (hasValue restriction on `isManagedBy alice`),
ProjectContributor (someValuesFrom restriction on `worksOn`).

Caption "Carol — DirectReport and ProjectContributor via restriction reasoning". Pause.

## Scene 6 — Closing (5 s)

Caption "13 OWL 2 DL patterns — subclass, inverse, transitive, restriction, chain".
Pause 3.5 s.

---

## Timing Summary

| Scene | Duration | Cumulative |
|-------|----------|------------|
| 1. Load ontology | 10 s | 0:10 |
| 2. Run reasoning | 20 s | 0:30 |
| 3. Inspect ABox | 15 s | 0:45 |
| 4. Dave inspection | 15 s | 1:00 |
| 5. Carol inspection | 15 s | 1:15 |
| 6. Closing | 5 s | 1:20 |

**Total: ~80 seconds** (within 90 s target)

---

## OWL 2 DL Patterns Demonstrated

1. rdfs:subClassOf chain (Person → Employee → Manager → Executive)
2. rdfs:subPropertyOf (hasFriend → knows)
3. owl:inverseOf (manages ↔ isManagedBy)
4. owl:SymmetricProperty (isColleagueOf)
5. owl:TransitiveProperty (hasSupervisor)
6. owl:someValuesFrom restriction (ProjectContributor)
7. owl:hasValue restriction (DirectReport)
8. owl:allValuesFrom restriction (DirectorRole — structural only)
9. owl:intersectionOf (TeamLead)
10. owl:complementOf (NonEmployee — structural only)
11. owl:disjointWith (Contractor ⊥ Employee)
12. owl:propertyChainAxiom (hasGrandManager)
13. owl:unionOf (LeadershipTeam)
14. owl:sameAs propagation (aliceCEO)
15. rdfs:domain / rdfs:range entailment (dave → Manager)

## MCP Tools

| Tool | Scene | Purpose |
|------|-------|---------|
| `loadRdf` | 1 | Load ontology |
| `runReasoning` | 2 | Trigger Konclude WASM |
| `setViewMode` | 3 | Switch to ABox |
| `focusNode` | 4, 5 | Center on individual |
| `expandNode` | 1, 2, 3, 4, 5 | Show property cards |
| `runLayout` | 1, 2, 3 | Layout arrangement |
| `fitCanvas` | 1, 2, 3 | Fit to viewport |
