# Feature Demo: Hierarchical Clustering

> Seed for the feat-clustering demo recording.
> Shows L2 structural fold, unfold, L3 Louvain community detection, expand.
>
> Spec: `e2e/demo-feat-clustering.spec.ts`
> Dataset: `public/reasoning-demo.ttl`

---

**Assistant:** Loading the reasoning demo ontology for clustering demonstration.

`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"loadRdf","arguments":{"url":"http://localhost:8080/reasoning-demo.ttl"}}}`
`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-tb","spacing":200}}}`
`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"expandNode","arguments":{}}}`
`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-tb","spacing":200}}}`
`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: Full ontology — 13 classes, ready for clustering
slug: full-graph
```

---

**Assistant:** Zooming in to see the graph detail before folding.

```action
scroll: 0 -200
wait: 800
```

```snapshot
caption: Detailed view before structural folding
slug: before-fold
```

---

**Assistant:** Now the spec will demonstrate L2 fold, unfold, and L3 Louvain clustering via UI interactions. Fitting canvas after each operation.

`{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: Hierarchical fold levels — collapse and expand graph structure
slug: clustering-overview
```
