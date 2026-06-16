# Screenplay: Canvas Authoring

A focused 75-second demo showing how to add classes, draw edges, edit annotations,
and use undo/redo — all on the canvas. Uses `public/reasoning-demo.ttl` as the base dataset.

---

## Scene 1 — Load Existing Ontology (10 s)

Load `reasoning-demo.ttl`. Apply layout, expand all, fit canvas.

Caption "Loaded ontology — ready to author new entities". Pause.

## Scene 2 — Add a Class (8 s)

Use `addNode` to create `ex:Intern` as an `owl:Class`.

Caption "New class "Intern" added to the TBox". Pause.

## Scene 3 — Draw a subClassOf Edge (10 s)

Use `addTriple` to assert `ex:Intern rdfs:subClassOf ex:Employee`.
Re-layout and fit canvas to show the new edge.

Caption "Intern ─subClassOf→ Employee — edge drawn on canvas". Pause.

## Scene 4 — Edit an Annotation (12 s)

Use `updateNode` to set `rdfs:comment` on `ex:Intern` to
"A temporary staff member under supervision."

Expand Intern's property card to show the annotation.

Caption "Annotation edited — rdfs:comment visible in property card". Pause.

## Scene 5 — Undo / Redo (15 s)

Press `Ctrl+Z` twice — annotation disappears, then edge.
Press `Ctrl+Shift+Z` twice — edge reappears, then annotation.

Caption "Undo / Redo — full edit history on the canvas". Pause.

## Scene 6 — Closing (5 s)

Caption "Add nodes, draw edges, edit properties — all on the canvas". Pause 3 s.

---

## Timing Summary

| Scene | Duration | Cumulative |
|-------|----------|------------|
| 1. Load ontology | 10 s | 0:10 |
| 2. Add class | 8 s | 0:18 |
| 3. Draw edge | 10 s | 0:28 |
| 4. Edit annotation | 12 s | 0:40 |
| 5. Undo / Redo | 15 s | 0:55 |
| 6. Closing | 5 s | 1:00 |

**Total: ~60 seconds** (target 75 s, actual ~60 s with MCP-driven actions)

---

## MCP Tools

| Tool | Scene | Purpose |
|------|-------|---------|
| `loadRdf` | 1 | Load ontology |
| `addNode` | 2 | Create Intern class |
| `addTriple` | 3 | Assert subClassOf |
| `updateNode` | 4 | Set rdfs:comment |
| `expandNode` | 4 | Show property card |
| `runLayout` | 1, 3 | Dagre layout |
| `fitCanvas` | 1, 3 | Fit to viewport |

## UI Actions

| Action | Scene | Purpose |
|--------|-------|---------|
| `key: Control+z` | 5 | Undo (×2) |
| `key: Control+Shift+z` | 5 | Redo (×2) |
