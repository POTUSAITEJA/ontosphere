# ISWC 2026 Comprehensive Demo

> Seed file for the comprehensive ISWC 2026 demo recording.
> This file contains MCP tool calls for actions that can be driven programmatically.
> UI-only actions (search, fold toggle, halo drag, clustering controls, undo/redo)
> are handled by the Playwright spec directly.
>
> Spec: `e2e/demo-iswc2026-comprehensive.spec.ts`
> Screenplay: `docs/demo-scripts/iswc2026-comprehensive.md`

---

**Assistant:** Loading the reasoning demo ontology via URL to populate the TBox canvas.

`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"loadRdf","arguments":{"url":"http://localhost:8080/reasoning-demo.ttl"}}}`
`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-tb","spacing":200}}}`
`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"expandNode","arguments":{}}}`
`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-tb","spacing":200}}}`
`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: Loaded OWL 2 DL ontology — 13 classes, 11 properties, 8 individuals
slug: ontology-loaded
```

---

**Assistant:** Adding the new Intern class node to the TBox.

`{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"addNode","arguments":{"iri":"http://example.com/reasoning-demo#Intern","typeIri":"http://www.w3.org/2002/07/owl#Class","label":"Intern"}}}`
`{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"addTriple","arguments":{"subjectIri":"http://example.com/reasoning-demo#Intern","predicateIri":"http://www.w3.org/2000/01/rdf-schema#subClassOf","objectIri":"http://example.com/reasoning-demo#Employee"}}}`
`{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-tb","spacing":200}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: Intern class added — subClassOf Employee
slug: intern-added
```

---

**Assistant:** Adding an annotation property to the Intern class.

`{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"updateNode","arguments":{"iri":"http://example.com/reasoning-demo#Intern","setProperties":[{"predicateIri":"http://www.w3.org/2000/01/rdf-schema#comment","value":"A temporary staff member under supervision."}]}}}`
`{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"expandNode","arguments":{"iri":"http://example.com/reasoning-demo#Intern","expand":true}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: Author directly on the canvas — add nodes, draw edges, edit properties
slug: intern-annotated
```

---

**Assistant:** Running OWL 2 DL reasoning via Konclude WASM.

`{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"runReasoning","arguments":{}}}`
`{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"expandNode","arguments":{}}}`
`{"jsonrpc":"2.0","id":13,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-tb","spacing":200}}}`
`{"jsonrpc":"2.0","id":14,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: OWL 2 DL reasoning (Konclude WASM) — inferred triples in amber
slug: reasoning-complete
```

---

**Assistant:** Switching to ABox and focusing on Dave to show inferred types.

`{"jsonrpc":"2.0","id":15,"method":"tools/call","params":{"name":"setViewMode","arguments":{"mode":"abox"}}}`
`{"jsonrpc":"2.0","id":16,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-lr","spacing":200}}}`
`{"jsonrpc":"2.0","id":17,"method":"tools/call","params":{"name":"focusNode","arguments":{"iri":"http://example.com/reasoning-demo#dave"}}}`
`{"jsonrpc":"2.0","id":18,"method":"tools/call","params":{"name":"expandNode","arguments":{"iri":"http://example.com/reasoning-demo#dave","expand":true}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: Dave — inferred Manager, LeadershipTeam, TeamLead from property domains
slug: dave-inferred
```

---

**Assistant:** Loading SHACL shapes for Employee validation.

`{"jsonrpc":"2.0","id":19,"method":"tools/call","params":{"name":"loadShacl","arguments":{"turtle":"@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix ex: <http://example.com/reasoning-demo#> .\n\nex:EmployeeShape a sh:NodeShape ;\n  sh:targetClass ex:Employee ;\n  sh:property [\n    sh:path ex:worksOn ;\n    sh:minCount 1 ;\n    sh:message \"Every Employee must work on at least one project.\"\n  ] ."}}}`

```tool-result
<!-- runner fills this in -->
```

---

**Assistant:** Running SHACL validation against the shapes.

`{"jsonrpc":"2.0","id":20,"method":"tools/call","params":{"name":"validateGraph","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: SHACL validation — load shapes, validate, inspect violations
slug: shacl-validated
```

---

**Assistant:** Exporting the complete graph as Turtle.

`{"jsonrpc":"2.0","id":21,"method":"tools/call","params":{"name":"exportGraph","arguments":{"format":"turtle"}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: Export Turtle / RDF-XML / JSON-LD — namespace management
slug: export-turtle
```
