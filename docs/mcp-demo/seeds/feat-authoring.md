# Feature Demo: Canvas Authoring

> Seed for the feat-authoring demo recording.
> Shows TBox authoring from empty canvas: create classes via class tree UI,
> draw edges via halo establish-link drag, demonstrate undo and save —
> full user interaction path.
>
> Spec: `e2e/demo-feat-authoring.spec.ts`

---

**Assistant:** Switching to TBox mode on an empty canvas — OWL vocabulary is ready.

`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"setViewMode","arguments":{"mode":"tbox"}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: Empty TBox canvas — ready to author an ontology
slug: empty-tbox
```

---

**Assistant:** Creating the first class — Employee — via the class tree.

```action
click: input[placeholder*="earch"]
wait: 300
fill: input[placeholder*="earch"] | Class
wait: 800
waitFor: a[href$="owl#Class"] ~ .reactodia-class-tree-item__create-button
click: a[href$="owl#Class"] ~ .reactodia-class-tree-item__create-button
waitFor: .reactodia-dialog
wait: 400
fill: input.font-mono | http://example.com/Employee
wait: 300
click: .reactodia-dialog button:has-text("Apply")
wait: 1000
```

```snapshot
caption: Employee class — created from the class tree
slug: employee-added
```

---

**Assistant:** Adding a second class — Person.

```action
click: a[href$="owl#Class"] ~ .reactodia-class-tree-item__create-button
waitFor: .reactodia-dialog
wait: 400
fill: input.font-mono | http://example.com/Person
wait: 300
click: .reactodia-dialog button:has-text("Apply")
wait: 1000
```

```snapshot
caption: Person class added alongside Employee
slug: person-added
```

---

**Assistant:** Applying layout before drawing the connection.

`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-tb","spacing":200}}}`
`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: Layout applied — nodes positioned for connection
slug: pre-edge-layout
```

---

**Assistant:** Drawing a connection — drag from the establish-link halo button to the target node.

```action
click: [data-element-id]:has-text("Employee")
wait: 800
waitFor: .reactodia-selection-action__establish-link
dragTo: .reactodia-selection-action__establish-link | [data-element-id]:has-text("Person")
waitFor: .reactodia-dialog input[placeholder*="predicate"]
wait: 300
fill: .reactodia-dialog input[placeholder*="predicate"] | subClass
wait: 500
click: [role="option"]:has-text("subClassOf")
wait: 300
click: .reactodia-dialog button:has-text("Apply")
wait: 1000
```

```snapshot
caption: Employee ─subClassOf→ Person — relation drawn via halo drag
slug: edge-drawn
```

---

**Assistant:** Applying layout for a clean hierarchy.

`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-tb","spacing":200}}}`
`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: Clean class hierarchy after layout
slug: layout-done
```

---

**Assistant:** Selecting Employee to show the authoring halo.

```action
click: [data-element-id]:has-text("Employee")
wait: 1500
```

```snapshot
caption: Authoring mode — uncommitted changes highlighted on the halo
slug: authoring-state
```

---

**Assistant:** Adding a third class — Department — to demonstrate undo.

```action
click: a[href$="owl#Class"] ~ .reactodia-class-tree-item__create-button
waitFor: .reactodia-dialog
wait: 400
fill: input.font-mono | http://example.com/Department
wait: 300
click: .reactodia-dialog button:has-text("Apply")
wait: 1000
```

```snapshot
caption: Department added — three classes on the canvas
slug: third-node
```

---

**Assistant:** Clicking undo — Department disappears, edit history preserved.

```action
click: .reactodia-toolbar-action__undo
wait: 500
click: .reactodia-toolbar-action__undo
wait: 1500
```

```snapshot
caption: Undo — Department removed, edit history intact
slug: after-undo
```

---

**Assistant:** Saving all authoring changes to the N3 store.

```action
click: .reactodia-toolbar-action__save
wait: 1500
```

```snapshot
caption: Save — changes persisted to the N3 store
slug: after-save
```
