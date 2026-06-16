# Screenplay: SHACL Validation

A focused 75-second demo showing SHACL constraint validation: loading shapes, running
validation, inspecting violations and warnings, and seeing how reasoning changes
validation results. Uses `public/reasoning-demo.ttl` with
`public/shacl-shapes/reasoning-demo.shacl.ttl`.

---

## Scene 1 — Load Ontology (10 s)

Load `reasoning-demo.ttl`. Layout and expand in TBox view.

Caption "Ontology loaded — ready for SHACL validation". Pause.

## Scene 2 — Load SHACL Shapes (10 s)

Load shapes from `reasoning-demo.shacl.ttl` via `loadShaclFromUrl`.

The shapes file contains 4 constraint shapes:
- ProjectDescription (Violation): every Project must have rdfs:comment
- ContractorSupervisor (Violation): every Contractor must have hasSupervisor
- EmployeeJobTitle (Warning): employees should have jobTitle
- IndividualDocumentation (Warning): named individuals should have rdfs:comment

Caption "SHACL shapes loaded — 4 constraint shapes". Pause.

## Scene 3 — Run Validation (10 s)

Run `validateGraph`. The result shows violations and warnings.

Expected violations:
- projectAlpha has no rdfs:comment → Violation
- frank has no hasSupervisor → Violation
- bob, carol, eve missing jobTitle → Warning (×3)
- Multiple individuals missing rdfs:comment → Warning

Caption "Validation complete — violations and warnings found". Pause.

## Scene 4 — Run Reasoning Then Re-Validate (20 s)

Run `runReasoning`. Inferred types expand — dave becomes Manager (and Employee),
alice becomes Employee via subclass chain.

Re-run `validateGraph`. Now dave and alice also trigger the EmployeeJobTitle warning
(alice has jobTitle, but dave's jobTitle may or may not propagate depending on
inference). The key point: reasoning changes who is targeted by the shapes.

Caption "SHACL + Reasoning interplay — validation results evolve with inferred knowledge".

## Scene 5 — Closing (5 s)

Caption "SHACL + Reasoning — validation results evolve with inferred knowledge".
Pause 3.5 s.

---

## Timing Summary

| Scene | Duration | Cumulative |
|-------|----------|------------|
| 1. Load ontology | 10 s | 0:10 |
| 2. Load shapes | 10 s | 0:20 |
| 3. Run validation | 10 s | 0:30 |
| 4. Reasoning + re-validate | 20 s | 0:50 |
| 5. Closing | 5 s | 0:55 |

**Total: ~55 seconds** (within 75 s target)

---

## MCP Tools

| Tool | Scene | Purpose |
|------|-------|---------|
| `loadRdf` | 1 | Load ontology |
| `loadShaclFromUrl` | 2 | Load shapes from URL |
| `validateGraph` | 3, 4 | Run SHACL validation |
| `runReasoning` | 4 | Trigger reasoning |
| `expandNode` | 1, 4 | Expand property cards |
| `runLayout` | 1, 4 | Layout |
| `fitCanvas` | 1, 4 | Fit viewport |
