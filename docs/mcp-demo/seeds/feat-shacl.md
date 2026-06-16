# Feature Demo: SHACL Validation

> Seed for the feat-shacl demo recording.
> Shows loading SHACL shapes, running validation, inspecting violations.
>
> Spec: `e2e/demo-feat-shacl.spec.ts`
> Dataset: `public/reasoning-demo.ttl`
> Shapes: `public/shacl-shapes/reasoning-demo.shacl.ttl`

---

**Assistant:** Loading the reasoning demo ontology.

`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"loadRdf","arguments":{"url":"http://localhost:8080/reasoning-demo.ttl"}}}`
`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-tb","spacing":200}}}`
`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"expandNode","arguments":{}}}`
`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-tb","spacing":200}}}`
`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: Ontology loaded — ready for SHACL validation
slug: loaded
```

---

**Assistant:** Loading SHACL shapes that validate the reasoning demo entities.

`{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"loadShaclFromUrl","arguments":{"url":"http://localhost:8080/shacl-shapes/reasoning-demo.shacl.ttl"}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: SHACL shapes loaded — 4 constraint shapes
slug: shapes-loaded
```

---

**Assistant:** Running validation against the loaded shapes.

`{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"validateGraph","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: Validation complete — violations and warnings found
slug: validation-result
```

---

**Assistant:** Now running reasoning to add inferred types, then re-validating.

`{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"runReasoning","arguments":{}}}`
`{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"expandNode","arguments":{}}}`
`{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-tb","spacing":200}}}`
`{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: Reasoning complete — inferred triples may change validation results
slug: after-reasoning
```

---

**Assistant:** Re-validating after reasoning to show how inferred types change the result.

`{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"validateGraph","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: SHACL + Reasoning interplay — validation results change with inferred types
slug: revalidation
```
