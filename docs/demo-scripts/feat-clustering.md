# Screenplay: Hierarchical Clustering

A focused 75-second demo showing the three-level fold system: L1 annotation collapse,
L2 structural fold, and L3 Louvain community detection. Uses `public/reasoning-demo.ttl`.

---

## Scene 1 — Load Ontology (10 s)

Load `reasoning-demo.ttl`. Apply layout, expand all, fit canvas.

Caption "Full ontology — 13 classes, ready for clustering". Pause.

## Scene 2 — Pre-Fold View (8 s)

Zoom in to show the graph detail. Caption about the current unclustered state.

## Scene 3 — L2 Unfold (12 s)

Click the Unfold button. All collapsed subclass chains and OWL collection groups
expand — the graph grows as intermediate nodes appear.

Fit canvas.

Caption "L2 Unfold — expand collapsed subclass chains". Pause.

## Scene 4 — L2 Re-Fold (10 s)

Click the Fold button. The graph compresses back to summary form.

Caption "L2 Fold — re-collapse to summary form". Pause.

## Scene 5 — L3 Louvain (15 s)

Select "Louvain" from the clustering algorithm dropdown. Click the Cluster button.

Nodes group into colour-coded community clusters.

Caption "L3 Louvain — community detection groups related entities". Pause.

## Scene 6 — Expand All (10 s)

Click Expand All. Clusters flatten back to individual nodes.

Caption "Expand All — flatten back to individual nodes". Fit canvas. Pause.

## Scene 7 — Closing (5 s)

Caption "Three fold levels — from annotations to community detection". Pause 3 s.

---

## Timing Summary

| Scene | Duration | Cumulative |
|-------|----------|------------|
| 1. Load ontology | 10 s | 0:10 |
| 2. Pre-fold view | 8 s | 0:18 |
| 3. L2 Unfold | 12 s | 0:30 |
| 4. L2 Re-Fold | 10 s | 0:40 |
| 5. L3 Louvain | 15 s | 0:55 |
| 6. Expand All | 10 s | 1:05 |
| 7. Closing | 5 s | 1:10 |

**Total: ~70 seconds**

---

## Notes

- The clustering controls (fold/unfold buttons, algorithm selector, cluster button,
  expand all) are driven by direct Playwright UI interactions, not MCP tool calls.
  The seed provides initial load and fit; the spec handles clustering UI.
- If fold/unfold or cluster buttons aren't visible (e.g., toolbar is compact), the
  spec uses fallback selectors with graceful skip.
