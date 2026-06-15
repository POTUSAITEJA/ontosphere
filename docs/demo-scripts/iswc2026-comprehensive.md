# Screenplay: ISWC 2026 Comprehensive Demo

A single cohesive walkthrough (~3 minutes) covering all major Ontosphere capabilities:
loading, navigating, authoring, clustering, OWL 2 DL reasoning, SHACL validation,
AI relay integration, and export. Designed for a live poster-and-demo session at ISWC 2026.

The demo uses the bundled reasoning ontology (`public/reasoning-demo.ttl`) as the primary
dataset. It starts from an empty canvas and progressively reveals features through a
narrative arc — not a feature checklist.

---

## Act 1 — Zero-Install Entry (0:00 – 0:25)

**Scene 1 — Empty canvas (10 s)**

Open the Ontosphere app full-screen.

Pause two seconds — caption "Ontosphere — Zero-Install Semantic Web Workbench".

The viewer sees a blank canvas with the toolbar along the top, the left sidebar (Onto,
File, Clear, Export, Settings buttons **[19–23]**), and the minimap **[30]** at bottom-right.
Pause long enough for the viewer to take in the chrome, then clear the caption.

**Scene 2 — Load ontology via URL parameter (15 s)**

Navigate to the app with the `rdfUrl` parameter pointing at the bundled reasoning demo:

```
?rdfUrl=https://thhanke.github.io/ontosphere/reasoning-demo.ttl
```

The TBox view loads automatically — class and property nodes appear on the canvas with
the default Dagre layout applied. Namespace badges (coloured pills) label each node with
its prefix.

Caption "Loaded OWL 2 DL ontology — 13 classes, 11 properties, 8 individuals".
Pause two seconds.

## Act 2 — Navigate and Explore (0:25 – 0:40)

**Scene 3 — TBox / ABox toggle, search, viewport (15 s)**

Click the **A-Box** button **[10]** in the top-right toolbar. The canvas switches to the
individual-level view: Alice, Bob, Carol, Dave, Eve, Frank, and AliceCEO appear as nodes.

Click the **T-Box** button **[10]** to return to the class/property view.

Type "Manager" in the **Search** box **[2]** and press Enter — the canvas pans to the
`ex:Manager` node and highlights it. The match badge shows "1 / 1".

Use scroll-to-zoom to zoom out, then drag the background to pan across the graph.
The minimap **[30]** tracks the viewport in real time.

Caption "TBox / ABox views — search, zoom, pan, minimap".
Pause one second, clear caption.

## Act 3 — Author on the Canvas (0:40 – 1:10)

**Scene 4 — Add a class node (8 s)**

Type "Intern" in the Search box **[2]** — no match found. Click "Create new entity" in the
search dropdown. The `addNode` dialog opens. Set type to `owl:Class`, label to "Intern",
IRI to `ex:Intern`. Confirm — the new class node appears on the canvas in the TBox view.

**Scene 5 — Draw a subClassOf edge via halo (10 s)**

Hover the new `ex:Intern` node to reveal the authoring halo. Drag the **Establish Link**
handle (plug icon **[26]**, right side of the node) to the existing `ex:Employee` node.
The link dialog opens — select `rdfs:subClassOf` from the scored autocomplete. Confirm.

A `rdfs:subClassOf` edge now connects Intern to Employee on the canvas.

**Scene 6 — Edit an annotation property inline (7 s)**

Click the `ex:Intern` node to select it. Click **Edit** **[24]** in the halo above the node.
The property editor opens. Type a `rdfs:comment`: "A temporary staff member under
supervision." Confirm.

The annotation appears in the node's property card on the canvas.

**Scene 7 — Undo (5 s)**

Click **Undo** **[15]** in the bottom-left authoring toolbar. The `rdfs:comment` annotation
disappears. Click **Redo** **[16]** to restore it.

Caption "Author directly on the canvas — add nodes, draw edges, edit properties, undo/redo".
Pause one second, clear caption.

## Act 4 — Clustering and Fold Levels (1:10 – 1:30)

**Scene 8 — Structural fold levels (10 s)**

Click **Unfold L2** **[8]** in the top-right toolbar. All collapsed subclass chains and OWL
collection groups expand — the graph grows visibly as intermediate nodes appear. The level
badge **[4]** changes from `L2` to `∅`.

Click **Fold L2** **[8]** to re-collapse. The badge returns to `L2`. The graph compresses
back to its summary form.

**Scene 9 — Community-detection clustering (10 s)**

Select **Louvain** in the clustering algorithm selector **[5]**. Click the **Cluster** button
**[6]**. Nodes group into colour-coded community clusters. The level badge **[4]** shows `L3`.

Pause one second on the clustered view, then click **Expand All** **[7]** to flatten back.

Caption "Hierarchical fold levels L1/L2/L3 — structural collapse and community detection".
Pause one second, clear caption.

## Act 5 — OWL 2 DL Reasoning (1:30 – 2:00)

**Scene 10 — Run reasoning (15 s)**

Click the **Run reasoning** button (play icon **[14]**) in the top-right toolbar. A spinner
appears in the reasoning status indicator **[12]** while Konclude runs in-browser via WASM.

After one to two seconds, reasoning completes. New amber dashed edges and amber italic type
annotations appear across the graph — these are inferred triples. The reasoning status
**[12]** updates to show the result (checkmark for consistent, warning for issues).

Caption "OWL 2 DL reasoning (Konclude WASM) — inferred triples in amber".
Pause two seconds.

**Scene 11 — Reasoning report and consistency (10 s)**

Click the reasoning status indicator **[12]** to open the reasoning report. The report lists
all inferred triples grouped by rule pattern: `rdfs:subPropertyOf`, `owl:inverseOf`,
`owl:TransitiveProperty`, `rdfs:domain` entailment, `owl:someValuesFrom`,
`owl:propertyChainAxiom`, and more.

Scroll briefly through the report. Point out the inferred types: Dave inferred as Manager
(via `rdfs:domain` of `ex:manages`), Alice inferred as ProjectContributor (via
`owl:someValuesFrom`).

Caption "Reasoning report — 13 OWL 2 DL construct patterns demonstrated".
Pause one second, clear caption.

**Scene 12 — Inspect an inferred individual (5 s)**

Switch to **A-Box** view **[10]**. Click `ex:Dave` to select it and click **Expand** **[27]**
to show his property card. His inferred types (`ex:Manager`, `ex:LeadershipTeam`) appear in
amber italic alongside the asserted types.

## Act 6 — SHACL Validation (2:00 – 2:15)

**Scene 13 — Load shapes and validate (15 s)**

This scene demonstrates AI-driven SHACL validation via MCP tools. An AI agent (or the
viewer following along) calls:

```
loadShacl({ turtle: `
  @prefix sh:  <http://www.w3.org/ns/shacl#> .
  @prefix ex:  <http://example.org/> .
  ex:EmployeeShape a sh:NodeShape ;
    sh:targetClass ex:Employee ;
    sh:property [
      sh:path ex:worksFor ;
      sh:minCount 1 ;
      sh:message "Every Employee must work for at least one organisation."
    ] .
` })
```

Then:

```
validateGraph({})
```

The validation result returns: conformance status and any violations. If violations exist,
the report shows the focus node, the path, and the constraint message — e.g., "Carol: Every
Employee must work for at least one organisation."

Caption "SHACL validation — load shapes, validate, inspect violations".
Pause one second, clear caption.

## Act 7 — AI Relay Bridge (2:15 – 2:45)

**Scene 14 — Bookmarklet injection (10 s)**

Open the left sidebar and expand the **AI Relay** panel. Drag the **Ontosphere Relay**
button to the browser bookmark bar (or click it directly).

Switch to an AI chat tab (ChatGPT, Gemini, Claude.ai, or OpenWebUI). Click the
bookmarklet — a small relay popup appears, confirming the bridge is live.

Caption "AI Relay Bridge — connects any AI chat to Ontosphere".

**Scene 15 — AI sends tool calls via relay (15 s)**

Paste the starter prompt into the AI chat. The AI calls `help({})` first — the relay
intercepts the backtick-wrapped JSON-RPC 2.0 call, executes it in Ontosphere via
BroadcastChannel, and injects the result back into the chat input automatically.

The AI then sends a tool call — for example:

```
`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"addNode","arguments":{"iri":"ex:NewConcept","typeIri":"owl:Class","label":"NewConcept"}}}`
```

The relay intercepts, Ontosphere executes `addNode`, and the JSON-RPC response appears in
the chat. A new class node materialises on the Ontosphere canvas.

Caption "AI tool call → relay → Ontosphere → result injected back into chat".

**Scene 16 — Round trip visible (5 s)**

Switch focus to the Ontosphere tab. The node created by the AI is visible on the canvas.
No server, no extension, no copy-paste — just a bookmarklet bridging two browser tabs.

Pause one second, clear caption.

## Act 8 — Export and Close (2:45 – 3:00)

**Scene 17 — Export as Turtle (10 s)**

Click the **Export** button **[22]** in the left sidebar. Select "Turtle" from the dropdown.
The browser downloads the complete graph as a `.ttl` file — all asserted and inferred triples,
with clean namespace prefixes.

Open the namespace legend (View menu **[1]** → Show Legend). Colour-coded namespace entries
are visible. Click the pencil icon on a namespace to demonstrate live URI renaming — the
rename propagates across all stored triples.

Caption "Export Turtle / RDF-XML / JSON-LD — namespace management with live URI renaming".
Pause one second.

**Scene 18 — Closing (5 s)**

Caption "Ontosphere — https://thhanke.github.io/ontosphere".

Pause one second.

Caption "DOI: 10.5281/zenodo.19605270 — Apache 2.0 — Zero install, runs entirely in-browser".

Pause three seconds. End.

---

## Timing summary

| Act | Scenes | Duration | Cumulative |
|-----|--------|----------|------------|
| 1. Zero-Install Entry | 1–2 | 25 s | 0:25 |
| 2. Navigate and Explore | 3 | 15 s | 0:40 |
| 3. Author on the Canvas | 4–7 | 30 s | 1:10 |
| 4. Clustering and Fold Levels | 8–9 | 20 s | 1:30 |
| 5. OWL 2 DL Reasoning | 10–12 | 30 s | 2:00 |
| 6. SHACL Validation | 13 | 15 s | 2:15 |
| 7. AI Relay Bridge | 14–16 | 30 s | 2:45 |
| 8. Export and Close | 17–18 | 15 s | 3:00 |

**Total: ~3 minutes**

---

## Feature coverage checklist

- [x] **Loading** — ontology loaded via `rdfUrl` URL parameter (Scene 2)
- [x] **Navigating** — TBox/ABox toggle, search, zoom/pan, minimap (Scene 3)
- [x] **Authoring** — add class node, draw subClassOf edge via halo, edit annotation, undo/redo (Scenes 4–7)
- [x] **Clustering** — L2 fold/unfold, L3 community-detection clustering (Louvain), expand all (Scenes 8–9)
- [x] **Reasoning** — Konclude OWL 2 DL inference, amber inferred triples, reasoning report, consistency check (Scenes 10–12)
- [x] **SHACL** — load shapes via `loadShacl`, validate via `validateGraph`, violation report (Scene 13)
- [x] **AI Relay** — bookmarklet injection, AI sends JSON-RPC tool call, Ontosphere executes, result injected back (Scenes 14–16)
- [x] **Export** — Turtle export, namespace legend, live URI renaming (Scene 17)

---

## MCP tools referenced

| Tool | Scene | Purpose |
|------|-------|---------|
| `addNode` | 4, 15 | Create new class node on canvas |
| `addTriple` | (implicit via edge dialog) | Assert subClassOf edge |
| `expandNode` | 12 | Reveal property card on Dave |
| `runReasoning` | 10 | Trigger OWL 2 DL inference |
| `loadShacl` | 13 | Load SHACL shapes into shapes graph |
| `validateGraph` | 13 | Run SHACL validation |
| `exportGraph` | 17 | Export as Turtle |
| `setViewMode` | 3, 12 | Switch TBox / ABox |
| `help` | 15 | AI's first relay call to get manifest |
| `setNamespace` | 17 | (referenced) Live namespace URI renaming |
| `runLayout` | 2 | (implicit) Auto-layout on load |

---

## UI elements referenced

Numbers match the annotated UI overview in `public/ui-overview.svg` and the README
"Using the UI" section.

| # | Element | Scenes used |
|---|---------|-------------|
| 1 | View menu | 17 |
| 2 | Search | 3, 4 |
| 4 | Level badge | 8, 9 |
| 5 | Clustering algorithm selector | 9 |
| 6 | Cluster button | 9 |
| 7 | Expand All | 9 |
| 8 | Fold/Unfold L2 | 8 |
| 10 | A-Box / T-Box toggle | 3, 12 |
| 12 | Reasoning status | 10, 11 |
| 14 | Run reasoning button | 10 |
| 15 | Undo | 7 |
| 16 | Redo | 7 |
| 19–23 | Left sidebar buttons | 1, 17 |
| 24 | Edit button (halo) | 6 |
| 26 | Establish Link handle (halo) | 5 |
| 27 | Expand neighbours (halo) | 12 |
| 30 | Minimap | 1, 3 |

---

## How to re-record this video

```sh
npm run dev          # terminal 1 — keep running
npm run demo:video   # terminal 2
```

Output: `docs/demo-videos/iswc2026-comprehensive.webm` and `.mp4`.
Spec: `e2e/demo-iswc2026-comprehensive.spec.ts` (to be created from this screenplay).

## Notes for the presenter

- The reasoning demo ontology (`public/reasoning-demo.ttl`) is small enough to reason in
  under 2 seconds but rich enough to demonstrate 13 OWL 2 DL construct patterns.
- The SHACL scene uses inline Turtle shapes via `loadShacl` — no external shapes file needed.
- The AI Relay scene can use any AI chat (ChatGPT, Gemini, Claude.ai, OpenWebUI). For a
  live demo, OpenWebUI with a local model avoids network latency.
- All computation runs entirely in the browser — no backend, no API keys, no installation.
  This is the central ISWC message: a zero-install semantic web workbench.
