# Screenplay: Visual Exploration

A focused 60-second demo showing TBox/ABox navigation, entity search, zoom/pan,
and minimap. Uses `public/reasoning-demo.ttl` as the dataset.

---

## Scene 1 — Load Ontology (10 s)

Load `reasoning-demo.ttl` via the `loadRdf` tool. Apply Dagre layout, expand all
nodes, fit canvas.

Caption "TBox — 13 classes, 11 properties fully expanded". Pause.

## Scene 2 — Zoom In (8 s)

Scroll-wheel zoom into the class hierarchy to show detail.

Caption "Zoom in — mouse wheel navigates the canvas". Pause.

## Scene 3 — Search (10 s)

Click the search input. Type "Manager". The canvas highlights the match.

Press Escape to dismiss search.

Caption "Search — find any class, property, or individual by name". Pause.

## Scene 4 — Focus Node (8 s)

Use `focusNode` to center on `ex:Manager`. Expand its property card.

Caption "Focus node — center and expand any entity". Pause.

## Scene 5 — ABox Toggle (15 s)

Switch to ABox view via `setViewMode`. Layout and expand individuals.
Fit canvas to show all 8 named individuals.

Caption "ABox view — individuals and asserted relationships". Pause.

Zoom out with scroll wheel. Fit canvas.

## Scene 6 — Return to TBox (5 s)

Switch back to TBox. Fit canvas.

Caption "TBox / ABox toggle — switch between schema and instance views". Pause.

## Scene 7 — Closing (4 s)

Caption "TBox / ABox views — search, zoom, focus, minimap". Pause 3 s.

---

## Timing Summary

| Scene | Duration | Cumulative |
|-------|----------|------------|
| 1. Load ontology | 10 s | 0:10 |
| 2. Zoom in | 8 s | 0:18 |
| 3. Search | 10 s | 0:28 |
| 4. Focus node | 8 s | 0:36 |
| 5. ABox toggle | 15 s | 0:51 |
| 6. Return to TBox | 5 s | 0:56 |
| 7. Closing | 4 s | 1:00 |

**Total: ~60 seconds**

---

## MCP Tools

| Tool | Scene | Purpose |
|------|-------|---------|
| `loadRdf` | 1 | Load ontology from URL |
| `runLayout` | 1, 5 | Dagre layout |
| `expandNode` | 1, 4, 5 | Expand property cards |
| `fitCanvas` | 1, 5, 6 | Fit graph to viewport |
| `focusNode` | 4 | Center on entity |
| `setViewMode` | 5, 6 | Switch TBox / ABox |

## UI Actions

| Action | Scene | Purpose |
|--------|-------|---------|
| `scroll` | 2, 5 | Zoom in/out |
| `click` + `fill` | 3 | Search input |
| `key: Escape` | 3 | Dismiss search |
