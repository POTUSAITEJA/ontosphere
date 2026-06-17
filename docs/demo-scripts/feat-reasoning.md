# Screenplay: OWL 2 DL Reasoning

Comprehensive demo: load ontology, click Run Reasoning, then systematically walk
through every OWL 2 DL construct — first the TBox axiom definition, then the ABox
inference result. Two clear phases: TBox walkthrough → ABox walkthrough.

Uses `public/reasoning-demo.ttl`.

---

## Phase 1 — Setup

### Scene 1: Load Ontology (8 s)

Load `reasoning-demo.ttl`. Layout and expand in TBox view.

Caption "OWL 2 DL ontology loaded — ready for reasoning".

### Scene 2: Run Reasoning (5 s)

Animated cursor moves to "▶ Run reasoning" button in top bar. Click. Spinner appears.

Caption "Running OWL 2 DL reasoning (Konclude WASM)…"

### Scene 3: Reasoning Complete (5 s)

Expand all nodes and re-layout. Amber dashed edges and italic type labels appear.

Caption "TBox after reasoning — inferred class relationships shown in amber".

## Phase 2 — TBox Axiom Walkthrough

Navigate to each class on the TBox canvas. Caption explains the OWL 2 DL axiom.

### Scene 4: subClassOf (5 s)

Focus Executive. Caption "rdfs:subClassOf — Executive → Manager → Employee → Person".

### Scene 5: someValuesFrom (5 s)

Focus ProjectContributor. Caption "owl:someValuesFrom — ProjectContributor ≡ ∃worksOn.Project".

### Scene 6: hasValue (5 s)

Focus DirectReport. Caption "owl:hasValue — DirectReport ≡ ∃isManagedBy.{alice}".

### Scene 7: allValuesFrom (5 s)

Focus DirectorRole. Caption "owl:allValuesFrom — DirectorRole ≡ ∀manages.Manager (structural, no ABox entailment in OWA)".

### Scene 8: intersectionOf (5 s)

Focus TeamLead. Caption "owl:intersectionOf — TeamLead ≡ (∃manages.Manager) ∩ (∃manages.Employee)".

### Scene 9: unionOf (5 s)

Focus LeadershipTeam. Caption "owl:unionOf — LeadershipTeam ≡ Executive ∪ Manager".

### Scene 10: disjointWith (5 s)

Focus Contractor. Caption "owl:disjointWith — Contractor ⊥ Employee (no individual can be both)".

### Scene 11: complementOf (5 s)

Focus NonEmployee. Caption "owl:complementOf — NonEmployee ≡ ¬Employee (structural TBox constraint)".

## Phase 3 — ABox Inference Results

Switch to ABox. Navigate to each individual. Caption explains which OWL constructs
produced the inferred types and properties.

### Scene 12: ABox Switch (8 s)

Switch to ABox. Layout, expand, fit.

Caption "ABox — individuals with inferred types from OWL 2 DL reasoning".

### Scene 13: Alice (8 s)

Focus Alice. Click to select. Expand property card. Inferred types: Manager,
Employee, Person (subClassOf chain), ProjectContributor (someValuesFrom),
LeadershipTeam (unionOf).

Caption "Alice — Manager, Employee, Person (subClassOf), ProjectContributor (someValuesFrom), LeadershipTeam (unionOf)".

### Scene 14: Dave (8 s)

Focus Dave. Click to select. Expand property card. Dave had no explicit type.
Inferred: Manager (domain of manages), TeamLead (intersectionOf: manages Manager
∩ manages Employee), LeadershipTeam (unionOf: Executive ∪ Manager).

Caption "Dave — Manager (rdfs:domain), TeamLead (intersectionOf), LeadershipTeam (unionOf)".

### Scene 15: Carol (8 s)

Focus Carol. Click to select. Expand property card. Inferred: DirectReport (hasValue:
isManagedBy alice), ProjectContributor (someValuesFrom: worksOn some Project),
hasGrandManager alice (propertyChainAxiom: hasSupervisor ∘ hasSupervisor),
hasSupervisor alice (transitive: carol→bob→alice).

Caption "Carol — DirectReport (hasValue), ProjectContributor (someValuesFrom), hasGrandManager (propertyChainAxiom), hasSupervisor alice (transitive)".

### Scene 16: Bob (8 s)

Focus Bob. Click to select. Expand property card. Inferred: isColleagueOf carol
(symmetric: asserted carol→bob, inferred bob→carol), isManagedBy dave (inverseOf
manages), knows alice (subPropertyOf: hasFriend → knows).

Caption "Bob — isColleagueOf (symmetric), isManagedBy (inverseOf), knows (subPropertyOf hasFriend)".

### Scene 17: AliceCEO (8 s)

Focus AliceCEO. Click to select. Expand property card. AliceCEO is owl:sameAs alice —
all types propagated: Executive, Manager, Employee, Person, ProjectContributor,
LeadershipTeam.

Caption "AliceCEO — owl:sameAs alice: Executive, Manager, Employee, ProjectContributor all propagated".

### Scene 18: Frank (5 s)

Focus Frank. Click to select. Expand property card. Contractor is consistent
because frank is not asserted as Employee (disjointWith respected).

Caption "Frank — Contractor (consistent with disjointWith Employee, differentFrom alice)".

## Phase 4 — Closing

### Scene 19: Final Overview (5 s)

Fit canvas. Final overview.

Caption "15 OWL 2 DL patterns — full SROIQ(D) compliance via Konclude WASM".

---

## Timing Summary

| Scene | Duration | Cumulative |
|-------|----------|------------|
| 1. Load ontology | 8 s | 0:08 |
| 2. Run reasoning | 5 s | 0:13 |
| 3. Reasoning complete | 5 s | 0:18 |
| 4–11. TBox axioms (8 classes) | 40 s | 0:58 |
| 12. ABox switch | 8 s | 1:06 |
| 13–18. ABox results (6 individuals) | 45 s | 1:51 |
| 19. Closing | 5 s | 1:56 |

**Total: ~2 minutes** (comprehensive coverage of all 15 patterns)

---

## OWL 2 DL Patterns — TBox → ABox Mapping

| # | Construct | TBox Scene | ABox Individual | ABox Scene |
|---|-----------|-----------|-----------------|------------|
| 1 | rdfs:subClassOf | 4: Executive | Alice | 13 |
| 2 | owl:someValuesFrom | 5: ProjectContributor | Alice, Carol | 13, 15 |
| 3 | owl:hasValue | 6: DirectReport | Carol | 15 |
| 4 | owl:allValuesFrom | 7: DirectorRole | (structural) | — |
| 5 | owl:intersectionOf | 8: TeamLead | Dave | 14 |
| 6 | owl:unionOf | 9: LeadershipTeam | Alice, Dave | 13, 14 |
| 7 | owl:disjointWith | 10: Contractor | Frank | 18 |
| 8 | owl:complementOf | 11: NonEmployee | (structural) | — |
| 9 | rdfs:subPropertyOf | — | Bob (knows) | 16 |
| 10 | owl:inverseOf | — | Bob (isManagedBy) | 16 |
| 11 | owl:SymmetricProperty | — | Bob (isColleagueOf) | 16 |
| 12 | owl:TransitiveProperty | — | Carol (hasSupervisor) | 15 |
| 13 | owl:propertyChainAxiom | — | Carol (hasGrandManager) | 15 |
| 14 | owl:sameAs | — | AliceCEO | 17 |
| 15 | rdfs:domain/range | — | Dave (Manager) | 14 |
