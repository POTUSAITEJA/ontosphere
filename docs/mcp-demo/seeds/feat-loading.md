# Feature Demo: Zero-Install + RDF Loading

> Seed for the feat-loading demo recording.
> Shows loading ontology via URL parameter, exploring loaded graph, file upload mention.
>
> Spec: `e2e/demo-feat-loading.spec.ts`
> Dataset: `public/reasoning-demo.ttl`

---

**Assistant:** Ontology loaded via URL parameter. Expanding all nodes and fitting to viewport.

`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"expandNode","arguments":{}}}`
`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-tb","spacing":200}}}`
`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: Loaded OWL 2 DL ontology — 13 classes, 11 properties, 8 individuals
slug: ontology-loaded
```

---

**Assistant:** Switching to ABox view to show loaded individuals.

`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"setViewMode","arguments":{"mode":"abox"}}}`
`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-lr","spacing":200}}}`
`{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"expandNode","arguments":{}}}`
`{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-lr","spacing":200}}}`
`{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: ABox — individuals loaded from the ontology file
slug: abox-loaded
```

---

**Assistant:** Back to TBox for the full schema overview.

`{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"setViewMode","arguments":{"mode":"tbox"}}}`
`{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: One URL, zero install — ontology loaded directly in the browser
slug: tbox-final
```
