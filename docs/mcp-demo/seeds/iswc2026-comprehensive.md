# ISWC 2026 Comprehensive Demo

> Full Ontosphere walkthrough: load PMDCO chemical composition data,
> resolve labels via ontology autocomplete, load community SHACL shapes,
> run OWL 2 DL reasoning with SHACL validation, inspect and fix SHACL errors
> via authoring, re-validate, and export.
>
> Spec: `e2e/demo-iswc2026-comprehensive.spec.ts`
> Dataset: `https://raw.githubusercontent.com/materialdigital/core-ontology/refs/heads/main/patterns/chemical%20composition/shape-data.ttl`
> Shapes: `https://raw.githubusercontent.com/materialdigital/core-ontology/refs/heads/main/patterns/autoshape/auto-shapes-open.ttl`

---

**Assistant:** Data loaded via URL parameter. Running layout.

`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"expandNode","arguments":{}}}`
`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-tb","spacing":200}}}`
`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: PMDCO chemical composition data — labels unresolved without the ontology
slug: data-loaded
```

---

**Assistant:** Labels show raw PMD identifiers. Opening Load Ontology and searching for PMDCO.

```action
click: button[aria-label="Load Ontology"]
wait: 1500
fill: input[role="combobox"] | pmdco
wait: 2500
```

```snapshot
caption: Autocomplete — ontology search finds PMD Core from the community registry
slug: pmdco-autocomplete
```

---

**Assistant:** Selecting PMDCO from the suggestions and loading it.

```action
click: [role="option"]:has-text("pmdco — PMD Core")
wait: 500
click: .space-y-4 button:has-text("Load Ontology")
wait: 12000
```

```snapshot
caption: PMDCO loaded — human-readable labels resolved for all PMD classes and properties
slug: ontology-loaded
```

---

**Assistant:** Opening SHACL settings to load community auto-shapes for quality validation.

```action
click: button.rail-btn:has-text("Settings")
wait: 1500
waitFor: [role="tab"]:has-text("SHACL")
click: [role="tab"]:has-text("SHACL")
wait: 1000
```

```snapshot
caption: Settings → SHACL — loading PMD community auto-shapes for structural validation
slug: shacl-settings
```

---

**Assistant:** Setting the auto-shapes URL and reloading shapes.

```action
fill: input[placeholder*="raw.githubusercontent"] | https://raw.githubusercontent.com/materialdigital/core-ontology/refs/heads/main/patterns/autoshape/auto-shapes-open.ttl
wait: 500
click: button:has(.lucide-refresh-cw)
wait: 10000
```

```snapshot
caption: 67 auto-shapes loaded — community-maintained structural constraints for PMD Core
slug: shapes-loaded
```

---

**Assistant:** Closing settings and running OWL 2 DL reasoning with SHACL validation.

```action
click: button[aria-label="Close"]
wait: 800
click: button[title="Run reasoning"]
wait: 10000
```

```snapshot
caption: Running OWL 2 DL reasoning + SHACL validation — PMDCO is large, this takes a moment…
slug: after-reasoning
```

---

**Assistant:** Opening the reasoning report to inspect the SHACL violation.

```action
waitFor: button.glass-btn--status-ok, button.glass-btn--status-error
click: button.glass-btn--status-error
wait: 1500
click: [role="tab"]:has-text("Errors")
wait: 1500
```

```snapshot
caption: Reasoning Report — Errors tab: some_silicon missing required quality
slug: reasoning-report
```

---

**Assistant:** Navigating to the error — some_silicon needs a band gap quality.

```action
click: [role="tabpanel"] button:has-text("some_silicon")
wait: 2000
```

```snapshot
caption: some_silicon — classified as semiconductor, requires a band gap quality
slug: navigate-error
```

---

**Assistant:** Clicking the node and hovering the validation badge.

```action
click: [data-element-id]:has-text("some_silicon")
wait: 800
hover: .reactodia-authoring-state__decorator--selected .reactodia-authoring-state__item-validation
wait: 2500
```

```snapshot
caption: SHACL error on some_silicon: "Less than 1 values for has quality" — semiconductors require a band gap quality
slug: hover-halo-error
```

---

**Assistant:** Switching to TBox to create the missing BandGap class.

```action
click: button:text-is("T-Box")
wait: 2000
```

```snapshot
caption: TBox view — class hierarchy for authoring new classes
slug: switch-tbox
```

---

**Assistant:** Creating a BandGap class in the TBox.

```action
click: input[placeholder*="earch"]
wait: 300
fill: input[placeholder*="earch"] | Class
wait: 800
waitFor: a[href$="owl#Class"] ~ .reactodia-class-tree-item__create-button
click: a[href$="owl#Class"] ~ .reactodia-class-tree-item__create-button
waitFor: .reactodia-dialog
wait: 400
fill: input.font-mono | http://www.example.org/#BandGap
wait: 300
click: .reactodia-dialog button:has-text("Apply")
wait: 1500
```

```action
click: .reactodia-toolbar-action__save
wait: 3000
```

```snapshot
caption: BandGap class created and saved — ready to instantiate in ABox
slug: bandgap-class-created
```

---

**Assistant:** Switching back to ABox and creating a BandGap individual.

```action
click: button:text-is("A-Box")
wait: 3000
fill: input[placeholder*="earch"] | gap
wait: 2000
waitFor: a[href*="BandGap"] ~ .reactodia-class-tree-item__create-button
click: a[href*="BandGap"] ~ .reactodia-class-tree-item__create-button
waitFor: .reactodia-dialog
wait: 400
fill: .reactodia-dialog input.font-mono | http://www.example.org/#bandgap_silicon
wait: 300
click: .reactodia-dialog button:has-text("Apply")
wait: 1500
```

```snapshot
caption: BandGap individual created — now connect it to some_silicon
slug: bandgap-individual-created
```

---

**Assistant:** Drawing the has-quality edge from some_silicon to the band gap node.

```action
click: [data-element-id]:has-text("some_silicon")
wait: 800
waitFor: .reactodia-selection-action__establish-link
dragTo: .reactodia-selection-action__establish-link | [data-element-id]:has-text("bandgap_silicon")
waitFor: .reactodia-dialog input[placeholder*="predicate"]
wait: 300
fill: .reactodia-dialog input[placeholder*="predicate"] | has quality
wait: 800
click: [role="option"]:has-text("has quality")
wait: 300
click: .reactodia-dialog button:has-text("Apply")
wait: 1000
```

```snapshot
caption: has quality edge drawn — some_silicon → BandGap, satisfying the SHACL constraint
slug: edge-drawn
```

---

**Assistant:** Applying layout and saving the authored changes.

`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-tb","spacing":200}}}`
`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```action
click: .reactodia-toolbar-action__save
wait: 1500
```

```snapshot
caption: Changes saved — band gap node and has-quality edge persisted
slug: after-save
```

---

**Assistant:** Re-running reasoning to verify the fix resolves the SHACL error.

```action
click: button[title="Run reasoning"]
wait: 10000
```

```snapshot
caption: Re-running reasoning + SHACL validation to verify the fix…
slug: after-revalidation
```

---

**Assistant:** Hover the Export button — download the corrected data.

```action
hover: button[aria-label="Export"]
wait: 2000
```

```snapshot
caption: Export — download as Turtle, JSON-LD, or RDF/XML with full namespace management
slug: export-hover
```
