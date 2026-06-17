# Feature Demo: OWL 2 DL Reasoning

> Seed for the feat-reasoning demo recording.
> Comprehensive walkthrough: load ontology, click Run Reasoning with animated cursor,
> then systematically navigate TBox axiom definitions and ABox inference results
> for every OWL 2 DL construct.
>
> Spec: `e2e/demo-feat-reasoning.spec.ts`
> Dataset: `public/reasoning-demo.ttl`

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
caption: OWL 2 DL ontology loaded — ready for reasoning
slug: loaded
```

---

**Assistant:** Running OWL 2 DL reasoning via Konclude WASM.

```action
click: button[title="Run reasoning"]
wait: 4000
```

```snapshot
caption: Running OWL 2 DL reasoning (Konclude WASM)…
slug: reasoning-running
```

---

**Assistant:** Reasoning complete — switching to TBox to examine axiom definitions.

`{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"setViewMode","arguments":{"mode":"tbox"}}}`
`{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"expandNode","arguments":{}}}`
`{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-tb","spacing":200}}}`
`{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: TBox after reasoning — inferred class relationships shown in amber
slug: tbox-after-reasoning
```

---

**Assistant:** rdfs:subClassOf — Executive is a subclass of Manager, Employee, Person.

`{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"focusNode","arguments":{"iri":"http://example.com/reasoning-demo#Executive"}}}`

```action
wait: 600
click: [data-element-id]:has(:text-is("Executive"))
wait: 800
```

```snapshot
caption: rdfs:subClassOf — Executive → Manager → Employee → Person
slug: tbox-subclassof
```

---

**Assistant:** owl:someValuesFrom — ProjectContributor defined as anyone who worksOn some Project.

`{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"focusNode","arguments":{"iri":"http://example.com/reasoning-demo#ProjectContributor"}}}`

```action
wait: 600
click: [data-element-id]:has(:text-is("ProjectContributor"))
wait: 800
```

```snapshot
caption: owl:someValuesFrom — ProjectContributor ≡ ∃worksOn.Project
slug: tbox-somevaluesfrom
```

---

**Assistant:** owl:hasValue — DirectReport defined as anyone managed by alice specifically.

`{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"focusNode","arguments":{"iri":"http://example.com/reasoning-demo#DirectReport"}}}`

```action
wait: 600
click: [data-element-id]:has(:text-is("DirectReport"))
wait: 800
```

```snapshot
caption: owl:hasValue — DirectReport ≡ ∃isManagedBy.{alice}
slug: tbox-hasvalue
```

---

**Assistant:** owl:allValuesFrom — DirectorRole requires all managed individuals to be Managers.

`{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"focusNode","arguments":{"iri":"http://example.com/reasoning-demo#DirectorRole"}}}`

```action
wait: 600
click: [data-element-id]:has(:text-is("DirectorRole"))
wait: 800
```

```snapshot
caption: owl:allValuesFrom — DirectorRole ≡ ∀manages.Manager (structural, no ABox entailment in OWA)
slug: tbox-allvaluesfrom
```

---

**Assistant:** owl:intersectionOf — TeamLead defined as managing both a Manager and an Employee.

`{"jsonrpc":"2.0","id":13,"method":"tools/call","params":{"name":"focusNode","arguments":{"iri":"http://example.com/reasoning-demo#TeamLead"}}}`

```action
wait: 600
click: [data-element-id]:has(:text-is("TeamLead"))
wait: 800
```

```snapshot
caption: owl:intersectionOf — TeamLead ≡ (∃manages.Manager) ∩ (∃manages.Employee)
slug: tbox-intersectionof
```

---

**Assistant:** owl:unionOf — LeadershipTeam includes all Executives and all Managers.

`{"jsonrpc":"2.0","id":14,"method":"tools/call","params":{"name":"focusNode","arguments":{"iri":"http://example.com/reasoning-demo#LeadershipTeam"}}}`

```action
wait: 600
click: [data-element-id]:has(:text-is("LeadershipTeam"))
wait: 800
```

```snapshot
caption: owl:unionOf — LeadershipTeam ≡ Executive ∪ Manager
slug: tbox-unionof
```

---

**Assistant:** owl:disjointWith — Contractor and Employee are mutually exclusive classes.

`{"jsonrpc":"2.0","id":15,"method":"tools/call","params":{"name":"focusNode","arguments":{"iri":"http://example.com/reasoning-demo#Contractor"}}}`

```action
wait: 600
click: [data-element-id]:has(:text-is("Contractor"))
wait: 800
```

```snapshot
caption: owl:disjointWith — Contractor ⊥ Employee (no individual can be both)
slug: tbox-disjointwith
```

---

**Assistant:** owl:complementOf — NonEmployee is the negation of Employee.

`{"jsonrpc":"2.0","id":16,"method":"tools/call","params":{"name":"focusNode","arguments":{"iri":"http://example.com/reasoning-demo#NonEmployee"}}}`

```action
wait: 600
click: [data-element-id]:has(:text-is("NonEmployee"))
wait: 800
```

```snapshot
caption: owl:complementOf — NonEmployee ≡ ¬Employee (structural TBox constraint)
slug: tbox-complementof
```

---

**Assistant:** Switching to ABox to see inference results on individuals.

`{"jsonrpc":"2.0","id":17,"method":"tools/call","params":{"name":"setViewMode","arguments":{"mode":"abox"}}}`
`{"jsonrpc":"2.0","id":18,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-lr","spacing":200}}}`
`{"jsonrpc":"2.0","id":19,"method":"tools/call","params":{"name":"expandNode","arguments":{}}}`
`{"jsonrpc":"2.0","id":20,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: ABox — individuals with inferred types from OWL 2 DL reasoning
slug: abox-overview
```

---

**Assistant:** Alice — subClassOf chain infers Manager, Employee, Person. someValuesFrom infers ProjectContributor.

`{"jsonrpc":"2.0","id":21,"method":"tools/call","params":{"name":"focusNode","arguments":{"iri":"http://example.com/reasoning-demo#alice"}}}`

```action
wait: 600
click: [data-element-id]:has(:text-is("Alice"))
wait: 800
```

```snapshot
caption: Alice — Manager, Employee, Person (subClassOf), ProjectContributor (someValuesFrom), LeadershipTeam (unionOf)
slug: abox-alice
```

---

**Assistant:** Dave — no explicit type. Manager inferred from manages domain. TeamLead from intersectionOf.

`{"jsonrpc":"2.0","id":22,"method":"tools/call","params":{"name":"focusNode","arguments":{"iri":"http://example.com/reasoning-demo#dave"}}}`

```action
wait: 600
click: [data-element-id]:has(:text-is("Dave"))
wait: 800
```

```snapshot
caption: Dave — Manager (rdfs:domain), TeamLead (intersectionOf), LeadershipTeam (unionOf)
slug: abox-dave
```

---

**Assistant:** Carol — DirectReport via hasValue, ProjectContributor via someValuesFrom, hasGrandManager via property chain.

`{"jsonrpc":"2.0","id":23,"method":"tools/call","params":{"name":"focusNode","arguments":{"iri":"http://example.com/reasoning-demo#carol"}}}`

```action
wait: 600
click: [data-element-id]:has(:text-is("Carol"))
wait: 800
```

```snapshot
caption: Carol — DirectReport (hasValue), ProjectContributor (someValuesFrom), hasGrandManager (propertyChain), hasSupervisor alice (transitive)
slug: abox-carol
```

---

**Assistant:** Bob — isColleagueOf inferred in reverse via symmetric. isManagedBy via inverseOf. knows via subPropertyOf.

`{"jsonrpc":"2.0","id":24,"method":"tools/call","params":{"name":"focusNode","arguments":{"iri":"http://example.com/reasoning-demo#bob"}}}`

```action
wait: 600
click: [data-element-id]:has(:text-is("Bob"))
wait: 800
```

```snapshot
caption: Bob — isColleagueOf (symmetric), isManagedBy (inverseOf), knows (subPropertyOf hasFriend)
slug: abox-bob
```

---

**Assistant:** AliceCEO — owl:sameAs alice propagates all inferred types automatically.

`{"jsonrpc":"2.0","id":25,"method":"tools/call","params":{"name":"focusNode","arguments":{"iri":"http://example.com/reasoning-demo#aliceCEO"}}}`

```action
wait: 600
click: [data-element-id]:has(:text-is("AliceCEO"))
wait: 800
```

```snapshot
caption: AliceCEO — owl:sameAs alice: Executive, Manager, Employee, ProjectContributor all propagated
slug: abox-aliceceo
```

---

**Assistant:** Frank — Contractor is consistent because frank is not asserted as Employee.

`{"jsonrpc":"2.0","id":26,"method":"tools/call","params":{"name":"focusNode","arguments":{"iri":"http://example.com/reasoning-demo#frank"}}}`

```action
wait: 600
click: [data-element-id]:has(:text-is("Frank"))
wait: 800
```

```snapshot
caption: Frank — Contractor (consistent with disjointWith Employee, differentFrom alice)
slug: abox-frank
```

---

**Assistant:** Full OWL 2 DL compliance — 15 construct patterns verified in-browser via Konclude WASM.

`{"jsonrpc":"2.0","id":27,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`

```tool-result
<!-- runner fills this in -->
```

```snapshot
caption: 15 OWL 2 DL patterns — full SROIQ(D) compliance via Konclude WASM
slug: final-overview
```
