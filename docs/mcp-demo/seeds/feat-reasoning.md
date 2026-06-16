# Feature Demo: OWL 2 DL Reasoning

> Seed for the feat-reasoning demo recording.
> Shows running Konclude WASM, inspecting inferred triples, consistency check, ABox inspection.
>
> Spec: `e2e/demo-feat-reasoning.spec.ts`
> Dataset: `public/reasoning-demo.ttl`

---

**Assistant:** Loading the reasoning demo ontology with the full TBox.

`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"loadRdf","arguments":{"url":"http://localhost:8080/reasoning-demo.ttl"}}}`
`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-tb","spacing":200}}}`
`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"expandNode","arguments":{}}}`
`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-tb","spacing":200}}}`
`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: OWL 2 DL ontology loaded — 13 patterns ready for reasoning
slug: before-reasoning
```

---

**Assistant:** Running OWL 2 DL reasoning via Konclude WASM.

`{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"runReasoning","arguments":{}}}`
`{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"expandNode","arguments":{}}}`
`{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-tb","spacing":200}}}`
`{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: Reasoning complete — inferred triples shown in amber
slug: reasoning-complete
```

---

**Assistant:** Switching to ABox and focusing on Dave to show inferred types.

`{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"setViewMode","arguments":{"mode":"abox"}}}`
`{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-lr","spacing":200}}}`
`{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"expandNode","arguments":{}}}`
`{"jsonrpc":"2.0","id":13,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-lr","spacing":200}}}`
`{"jsonrpc":"2.0","id":14,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: ABox after reasoning — individuals with inferred types
slug: abox-reasoned
```

---

**Assistant:** Focusing on Dave — he had no explicit type, all inferred from property domains.

`{"jsonrpc":"2.0","id":15,"method":"tools/call","params":{"name":"focusNode","arguments":{"iri":"http://example.com/reasoning-demo#dave"}}}`
`{"jsonrpc":"2.0","id":16,"method":"tools/call","params":{"name":"expandNode","arguments":{"iri":"http://example.com/reasoning-demo#dave","expand":true}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: Dave — Manager, TeamLead, LeadershipTeam all inferred
slug: dave-inferred
```

---

**Assistant:** Focusing on Carol to show inferred DirectReport and ProjectContributor.

`{"jsonrpc":"2.0","id":17,"method":"tools/call","params":{"name":"focusNode","arguments":{"iri":"http://example.com/reasoning-demo#carol"}}}`
`{"jsonrpc":"2.0","id":18,"method":"tools/call","params":{"name":"expandNode","arguments":{"iri":"http://example.com/reasoning-demo#carol","expand":true}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: Carol — DirectReport and ProjectContributor via restriction reasoning
slug: carol-inferred
```
