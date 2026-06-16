# Feature Demo: Canvas Authoring

> Seed for the feat-authoring demo recording.
> Shows adding a class, drawing an edge, editing annotations, undo/redo.
>
> Spec: `e2e/demo-feat-authoring.spec.ts`
> Dataset: `public/reasoning-demo.ttl`

---

**Assistant:** Loading the reasoning demo ontology as a starting canvas.

`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"loadRdf","arguments":{"url":"http://localhost:8080/reasoning-demo.ttl"}}}`
`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-tb","spacing":200}}}`
`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"expandNode","arguments":{}}}`
`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-tb","spacing":200}}}`
`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: Loaded ontology — ready to author new entities
slug: loaded
```

---

**Assistant:** Adding a new Intern class to the ontology.

`{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"addNode","arguments":{"iri":"http://example.com/reasoning-demo#Intern","typeIri":"http://www.w3.org/2002/07/owl#Class","label":"Intern"}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: New class "Intern" added to the TBox
slug: intern-added
```

---

**Assistant:** Drawing a subClassOf edge from Intern to Employee.

`{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"addTriple","arguments":{"subjectIri":"http://example.com/reasoning-demo#Intern","predicateIri":"http://www.w3.org/2000/01/rdf-schema#subClassOf","objectIri":"http://example.com/reasoning-demo#Employee"}}}`
`{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-tb","spacing":200}}}`
`{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: Intern ─subClassOf→ Employee — edge drawn on canvas
slug: edge-drawn
```

---

**Assistant:** Editing an annotation on the Intern class.

`{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"updateNode","arguments":{"iri":"http://example.com/reasoning-demo#Intern","setProperties":[{"predicateIri":"http://www.w3.org/2000/01/rdf-schema#comment","value":"A temporary staff member under supervision."}]}}}`
`{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"expandNode","arguments":{"iri":"http://example.com/reasoning-demo#Intern","expand":true}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: Annotation edited — rdfs:comment visible in property card
slug: annotation-edited
```

---

**Assistant:** Demonstrating undo and redo.

```action
key: Control+z
wait: 1200
key: Control+z
wait: 1200
key: Control+Shift+z
wait: 1200
key: Control+Shift+z
wait: 800
```

```snapshot
caption: Undo / Redo — full edit history on the canvas
slug: undo-redo
```
