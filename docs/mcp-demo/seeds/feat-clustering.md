# Feature Demo: Hierarchical Clustering

> Seed for the feat-clustering demo recording.
> Shows cluster pagination across ABox and TBox views, algorithm selection, and level restore.
> Pure UI interaction — no MCP tool calls. Loads via URL parameter.
>
> Spec: `e2e/demo-feat-clustering.spec.ts`
> Dataset: `public/reasoning-demo.ttl`

---

**Assistant:** Ontology loaded via URL parameter — reasoning-demo dataset at default fold level L1.

```snapshot
caption: Ontology loaded via URL parameter — default fold level L1
slug: initial-load
```

---

**Assistant:** Level down in ABox — L0 expands all nodes, showing full details and annotations.

```action
click: button:has-text("◄")
wait: 2500
```

```snapshot
caption: ABox L0 — fully expanded, all node details visible
slug: abox-l0
```

---

**Assistant:** Switching to TBox — cluster pagination is view-specific, TBox still at L1.

```action
click: button:has-text("T-Box")
wait: 2500
```

```snapshot
caption: TBox still at L1 — pagination state is per-view
slug: tbox-l1-preserved
```

---

**Assistant:** Level up in TBox — L2 collapses subclass chains and OWL collections into structural groups.

```action
click: button:has-text("►")
wait: 2500
```

```snapshot
caption: TBox L2 — subclass chains and collections collapsed into groups
slug: tbox-l2
```

---

**Assistant:** The clustering algorithm dropdown — four options available: None, Label Propagation, Louvain, and K-Means.

```action
hover: select[title*="Clustering"]
wait: 2000
```

```snapshot
caption: Clustering algorithms — None, Label Propagation, Louvain, K-Means
slug: algorithm-dropdown
```

---

**Assistant:** Selecting Label Propagation as the clustering algorithm.

```action
select: select[title*="Clustering"] | Label Propagation
wait: 1500
```

```snapshot
caption: Label Propagation selected — applied at next level-up to L3
slug: algorithm-selected
```

---

**Assistant:** Level up to L3 — Label Propagation community-detection clustering applied.

```action
click: button:has-text("►")
wait: 2500
```

```snapshot
caption: TBox L3 — Label Propagation community-detection clusters
slug: tbox-l3
```

---

**Assistant:** Level down — L2 structural view restored, showing pagination preserves each level.

```action
click: button:has-text("◄")
wait: 2500
```

```snapshot
caption: TBox L2 restored — fold levels are navigable and preserved
slug: tbox-l2-restored
```
