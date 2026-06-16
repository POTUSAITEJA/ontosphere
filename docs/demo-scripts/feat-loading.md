# Screenplay: Zero-Install + RDF Loading

A focused 60-second demo showing Ontosphere's zero-install architecture and multiple
data loading paths. Uses `public/reasoning-demo.ttl` as the dataset.

---

## Scene 1 — Empty Canvas (8 s)

Open Ontosphere full-screen. Show the blank canvas with toolbar and sidebar visible.

Caption "Ontosphere — Zero-Install Semantic Web Workbench". Pause 2.5 s.

## Scene 2 — Load via URL Parameter (15 s)

Navigate to the app with the `rdfUrl` parameter:

```
?rdfUrl=https://thhanke.github.io/ontosphere/reasoning-demo.ttl
```

The TBox loads automatically — class and property nodes appear with Dagre layout.
Namespace badges label each node.

Caption "Load any ontology via URL parameter — no server needed". Pause 2.5 s.

## Scene 3 — Explore Loaded Graph (20 s)

Expand all nodes and fit canvas to show the full TBox (13 classes, 11 properties).

Switch to ABox — Alice, Bob, Carol, Dave, Eve, Frank, AliceCEO appear as individual nodes.
Layout and fit.

Switch back to TBox for the overview.

## Scene 4 — Alternative Loading (12 s)

Click the "Load Ontology" button in the sidebar to show the loading dialog.

Caption "Also load from file upload, SPARQL endpoint, or Linked Open Vocabularies".

Dismiss dialog. Pause.

## Scene 5 — Closing (5 s)

Caption "One URL — zero install, runs entirely in the browser". Pause 3 s.

---

## Timing Summary

| Scene | Duration | Cumulative |
|-------|----------|------------|
| 1. Empty canvas | 8 s | 0:08 |
| 2. URL param load | 15 s | 0:23 |
| 3. Explore loaded | 20 s | 0:43 |
| 4. Alternative loading | 12 s | 0:55 |
| 5. Closing | 5 s | 1:00 |

**Total: ~60 seconds**

---

## MCP Tools

| Tool | Scene | Purpose |
|------|-------|---------|
| `expandNode` | 3 | Expand all node property cards |
| `runLayout` | 3 | Dagre layout for TBox/ABox |
| `fitCanvas` | 3 | Fit graph to viewport |
| `setViewMode` | 3 | Switch TBox / ABox |
