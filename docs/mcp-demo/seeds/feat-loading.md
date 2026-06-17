# Feature Demo: Zero-Install + RDF Loading

> Seed for the feat-loading demo recording.
> Shows loading an external RDF file via URL parameter, explaining unresolved
> labels, loading the matching ontology via autocomplete, and the ontology widget.
>
> Spec: `e2e/demo-feat-loading.spec.ts`

---

**Assistant:** Starting with an empty canvas — the URL parameter will load data automatically.

```snapshot
caption: Empty canvas — data loads via ?url= parameter
slug: empty-canvas
```

---

**Assistant:** Data loaded from the PMD shape-data file. Nodes and edges appear on the canvas.

```action
wait: 3000
```

```snapshot
caption: RDF data loaded via ?url= — nodes and edges on canvas
slug: data-loaded
```

---

**Assistant:** The Load File button can also load RDF data from local storage.

```action
hover: [aria-label="Load File"]
wait: 2500
```

```snapshot
caption: Load File button — also accepts local .ttl / .rdf / .jsonld files
slug: load-file-hover
```

---

**Assistant:** Notice the PMD namespace prefixes on edge labels and node types — the PMDCO ontology is not loaded yet, so Ontosphere cannot resolve human-readable labels.

```action
wait: 2500
```

```snapshot
caption: Unresolved labels — pmd: prefixes shown because PMDCO ontology is not loaded
slug: unresolved-labels
```

---

**Assistant:** If the graph contained an owl:imports statement pointing to a resolvable URI, Ontosphere would auto-load that ontology. This graph has no such import — so we load it manually.

```action
wait: 500
```

```snapshot
caption: owl:imports auto-discovery — if present, referenced ontologies load automatically. Here none found.
slug: owl-imports-explain
```

---

**Assistant:** Opening the Load Ontology dialog — a well-known catalog is available, or enter any URL directly.

```action
click: [aria-label="Load Ontology"]
waitFor: input[role="combobox"]
wait: 800
```

```snapshot
caption: Load Ontology — search known ontologies or enter a URL directly
slug: load-ontology-dialog
```

---

**Assistant:** Typing "pmdco" — it appears in the well-known ontology catalog.

```action
fill: input[role="combobox"] | pmdco
wait: 1500
```

```snapshot
caption: Autocomplete — PMDCO found in the well-known ontology catalog
slug: pmdco-autocomplete
```

---

**Assistant:** Selecting PMDCO from the suggestions and loading it.

```action
click: [role="option"]:has-text("pmdco — PMD Core")
wait: 500
click: .space-y-4 button:has-text("Load Ontology")
wait: 8000
```

```snapshot
caption: PMDCO loaded — edge labels and node types now show human-readable names
slug: pmdco-loaded
```

---

**Assistant:** Opening the ontology widget to show loaded sources and management options.

```action
click: button[title="Loaded ontologies"]
wait: 2500
```

```snapshot
caption: Ontology widget — Remove from autoload prevents loading on next visit, Unload removes it now
slug: ontology-widget
```

---

**Assistant:** Pointing at the management buttons — Remove from autoload and Unload.

```snapshot
caption: Remove from autoload — skip next session. Unload — remove right now.
slug: ontology-management
```
