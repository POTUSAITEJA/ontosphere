# Feature Demo: Visual Exploration

> Seed for the feat-exploration demo recording.
> Shows TBox/ABox toggle, entity search, zoom/pan, minimap.
>
> Spec: `e2e/demo-feat-exploration.spec.ts`
> Dataset: `public/reasoning-demo.ttl`

---

**Assistant:** Loading the reasoning demo ontology to populate the canvas.

`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"loadRdf","arguments":{"url":"http://localhost:8080/reasoning-demo.ttl"}}}`
`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-tb","spacing":200}}}`
`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"expandNode","arguments":{}}}`
`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-tb","spacing":200}}}`
`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: TBox — 13 classes, 11 properties fully expanded
slug: tbox-loaded
```

---

**Assistant:** Zooming in to explore the class hierarchy up close.

```action
scroll: 0 -400
wait: 800
scroll: 0 -200
wait: 600
```

```snapshot
caption: Zoom in — mouse wheel navigates the canvas
slug: zoom-in
```

---

**Assistant:** Searching for "Manager" to locate it in the graph.

```action
click: input[placeholder*="earch"]
fill: input[placeholder*="earch"] | Manager
wait: 1200
key: Escape
wait: 400
```

```snapshot
caption: Search — find any class, property, or individual by name
slug: search-manager
```

---

**Assistant:** Focusing on the Manager class to center it on canvas.

`{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"focusNode","arguments":{"iri":"http://example.com/reasoning-demo#Manager"}}}`
`{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"expandNode","arguments":{"iri":"http://example.com/reasoning-demo#Manager","expand":true}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: Focus node — center and expand any entity
slug: focus-manager
```

---

**Assistant:** Switching to ABox view to see individuals and their relationships.

`{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"setViewMode","arguments":{"mode":"abox"}}}`
`{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-lr","spacing":200}}}`
`{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"expandNode","arguments":{}}}`
`{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-lr","spacing":200}}}`
`{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: ABox view — individuals and asserted relationships
slug: abox-view
```

---

**Assistant:** Zooming out to see the full graph, then fitting to viewport.

```action
scroll: 0 300
wait: 600
scroll: 0 300
wait: 600
```

`{"jsonrpc":"2.0","id":13,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

---

**Assistant:** Switching back to TBox and fitting canvas for the final overview.

`{"jsonrpc":"2.0","id":14,"method":"tools/call","params":{"name":"setViewMode","arguments":{"mode":"tbox"}}}`
`{"jsonrpc":"2.0","id":15,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: TBox / ABox toggle — switch between schema and instance views
slug: tbox-abox-toggle
```
