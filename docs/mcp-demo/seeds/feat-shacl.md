# Feature Demo: SHACL Validation

> Seed for the feat-shacl demo recording.
> Shows SHACL validation with reasoning-demo shapes, reasoning interplay,
> sidebar navigation, and settings overview.
> UI interactions for reasoning and navigation; MCP for setup and shape loading.
>
> Spec: `e2e/demo-feat-shacl.spec.ts`
> Dataset: `public/reasoning-demo.ttl`
> Shapes: `public/shacl-shapes/reasoning-demo.shacl.ttl`

---

**Assistant:** Loading the reasoning demo ontology and SHACL shapes.

`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"loadRdf","arguments":{"url":"http://localhost:8080/reasoning-demo.ttl"}}}`
`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"loadShaclFromUrl","arguments":{"url":"http://localhost:8080/shacl-shapes/reasoning-demo.shacl.ttl"}}}`
`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"expandNode","arguments":{}}}`
`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-tb","spacing":200}}}`
`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: reasoning-demo.ttl loaded — SHACL shapes ready for validation
slug: loaded
```

---

**Assistant:** Ontosphere loads SHACL shapes on startup. The SHACL checkbox enables validation after reasoning.

```action
hover: button:has(input[type="checkbox"]):has-text("SHACL")
wait: 1500
```

```snapshot
caption: SHACL checkbox — when enabled, validation runs automatically after OWL reasoning
slug: shacl-checkbox
```

---

**Assistant:** Running OWL 2 DL reasoning with SHACL validation enabled.

```action
click: button[title="Run reasoning"]
wait: 6000
```

```snapshot
caption: Reasoning complete — indicator shows consistency status and SHACL results
slug: after-reasoning
```

---

**Assistant:** Clicking the reasoning indicator to open the reasoning results dialog.

```action
waitFor: button.glass-btn--status-ok, button.glass-btn--status-error
click: button.glass-btn--status-error
wait: 1500
```

```snapshot
caption: Reasoning Report — 2 SHACL errors and 12 warnings detected alongside OWL reasoning
slug: reasoning-dialog
```

---

**Assistant:** Clicking the first SHACL warning to navigate to the affected node — the sidebar opens automatically.

```action
click: button:has-text("bob")
wait: 2000
```

```snapshot
caption: Navigation to bob — SHACL panel unfolds in the sidebar with the highlighted message
slug: navigate-first-message
```

---

**Assistant:** Each affected node shows a validation badge on the canvas. Clicking it and hovering the badge reveals the SHACL messages.

```action
click: [data-element-id]:has(:text-is("Bob"))
wait: 800
hover: .reactodia-authoring-state__decorator--selected .reactodia-authoring-state__item-validation
wait: 2000
```

```snapshot
caption: Halo indicator — hover to see SHACL messages for each affected node
slug: hover-halo-bob
```

---

**Assistant:** SHACL results can also be navigated from the sidebar — clicking any message jumps to that node.

```action
waitFor: button.bg-accent.ring-1
hover: button.bg-accent.ring-1
wait: 1500
```

```snapshot
caption: SHACL sidebar — severity, description, and the affected node for each validation message
slug: hover-sidebar-message
```

---

**Assistant:** Navigating to a SHACL error — projectAlpha is missing a required description.

```action
click: button:has-text("Project must have"):has-text("projectAlpha")
wait: 2000
```

```snapshot
caption: Navigate SHACL results — click any message to jump to the affected node on canvas
slug: next-message-navigation
```

---

**Assistant:** Hovering projectAlpha's validation badge — the error details appear as a tooltip.

```action
click: [data-element-id]:has(:text-is("Project Alpha"))
wait: 800
hover: .reactodia-authoring-state__decorator--selected .reactodia-authoring-state__item-validation
wait: 3000
```

```snapshot
caption: SHACL violation — projectAlpha missing rdfs:comment (required by ProjectDescription shape)
slug: hover-halo-projectAlpha
```

---

**Assistant:** Opening Settings to see the SHACL shape configuration.

```action
click: button.rail-btn:has-text("Settings")
wait: 1500
waitFor: [role="tab"]:has-text("SHACL")
click: [role="tab"]:has-text("SHACL")
wait: 1500
```

```snapshot
caption: Settings → SHACL — bundled presets, custom URLs (persisted across sessions). URL param: ?shaclShapes=your-shapes.ttl
slug: settings-shacl-tab
```

---

**Assistant:** Closing the settings dialog.

```action
click: button[aria-label="Close"]
wait: 800
```

```snapshot
caption: SHACL validation — constraints verified against the knowledge graph
slug: settings-closed
```
