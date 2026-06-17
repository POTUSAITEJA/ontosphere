# Feature Demo: Visual Exploration

> Seed for the feat-exploration demo recording.
> Shows TBox/ABox toggle, class tree navigation, layout dialog,
> re-apply layout shortcut, zoom, node expand — all via UI actions.
>
> Spec: `e2e/demo-feat-exploration.spec.ts`
> Dataset: `public/reasoning-demo.ttl`

---

**Assistant:** Loading the reasoning demo ontology to populate the canvas.

`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"loadRdf","arguments":{"url":"http://localhost:8080/reasoning-demo.ttl"}}}`
`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-lr","spacing":200}}}`
`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"expandNode","arguments":{}}}`
`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-lr","spacing":200}}}`
`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: ABox — individuals and relationships loaded
slug: abox-loaded
```

---

**Assistant:** Switching to TBox to see the ontology schema.

```action
click: button[title="View ontology schema (T-Box)"]
wait: 1500
```

```snapshot
caption: TBox — class hierarchy and properties
slug: tbox-view
```

---

**Assistant:** Opening the layout dialog to choose a layout algorithm.

```action
click: button[title="Layout settings"]
wait: 800
waitFor: h2:has-text("Layout Settings")
wait: 600
```

```snapshot
caption: Layout dialog — choose algorithm and spacing
slug: layout-dialog
```

---

**Assistant:** Selecting the vertical layout for a top-down class hierarchy.

```action
click: button:has-text("Vertical")
wait: 1500
```

```snapshot
caption: Vertical layout applied — top-down hierarchy
slug: vertical-layout
```

---

**Assistant:** Closing the layout dialog.

```action
key: Escape
wait: 600
```

`{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: TBox overview — 13 classes in vertical layout
slug: tbox-vertical
```

---

**Assistant:** Searching for Manager — the class hierarchy unfolds and the view navigates.

```action
click: input[placeholder*="earch"]
wait: 300
fill: input[placeholder*="earch"] | Manager
wait: 1200
key: Enter
wait: 1500
```

```snapshot
caption: Search — type a class name, Enter navigates on canvas
slug: navigate-manager
```

---

**Assistant:** Zooming in to inspect the Manager class and its neighbors.

```action
scroll: 0 -300
wait: 600
scroll: 0 -200
wait: 800
```

```snapshot
caption: Zoom in — explore the class hierarchy up close
slug: zoom-in
```

---

**Assistant:** Selecting Manager to expand its inline properties.

```action
key: Escape
wait: 400
click: [data-element-id]:has(:text-is("Manager"))
wait: 800
waitFor: .reactodia-selection-action__expand
click: .reactodia-selection-action__expand
wait: 1500
```

```snapshot
caption: Expand — inline properties visible on the node
slug: expand-manager
```

---

**Assistant:** Re-applying layout after expansion to keep the graph tidy.

```action
click: [title="Re-apply current layout"]
wait: 1500
```

```snapshot
caption: Re-apply layout — one-click shortcut after changes
slug: reapply-layout
```

---

**Assistant:** Switching to ABox to see the individuals.

```action
click: button[title="View instance data (A-Box)"]
wait: 1500
```

```snapshot
caption: ABox — individuals and asserted relationships
slug: abox-view
```

---

**Assistant:** Re-applying layout for a clean ABox overview.

```action
click: [title="Re-apply current layout"]
wait: 1500
```

`{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: TBox / ABox toggle — switch between schema and instances
slug: final-overview
```
