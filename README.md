Ontosphere — Browser-based RDF Knowledge Graph Editor
====================================================

[![DOI](https://zenodo.org/badge/1049705027.svg)](https://doi.org/10.5281/zenodo.19605270)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

| I want to… | Start here |
|------------|------------|
| Try the live demo | [Open Ontosphere ↗](https://thhanke.github.io/ontosphere) |
| Connect an AI agent | [AI / MCP Integration](#ai--mcp-integration) |
| Run it locally | [Quick start (development)](#quick-start-development) |
| Load my own data | [Startup / URL parameters](#startup--url-parameters) |
| Contribute code | [Contributing](#contributing--development-notes) |
| Read the paper | [ISWC 2026 Demo Paper ↗](https://thhanke.github.io/ontosphere/paper/) |

## Table of Contents

- [Overview](#overview)
- [Key capabilities](#key-capabilities)
- [Quick start (development)](#quick-start-development)
- [Startup / URL parameters](#startup--url-parameters)
- [Reasoning](#reasoning)
- [Reasoning demo](#reasoning-demo)
- [SHACL validation](#shacl-validation)
- [CORS and proxies](#cors-and-proxies)
- [Using the UI](#using-the-ui)
- [Developer utilities](#developer-utilities-window-globals)
- [Troubleshooting](#troubleshooting)
- [AI / MCP Integration](#ai--mcp-integration)
  - [How it works](#how-it-works)
  - [Setup (Playwright / headless)](#setup-playwright--headless)
  - [Recommended workflow](#recommended-workflow)
  - [Using Ontosphere with any AI](#using-ontosphere-with-any-ai)
    - [Claude Code / Playwright](#claude-code--playwright-full-automation)
    - [AI Relay Bridge (ChatGPT, Gemini, Claude.ai)](#chatgpt-gemini-claudeai--ai-relay-bridge)
- [Recording demo videos](#recording-demo-videos)
- [Contributing](#contributing--development-notes)
- [License & authors](#license--authors)

Overview
--------
Ontosphere is a browser-based [RDF](https://www.w3.org/RDF/)/ontology knowledge graph editor. It loads RDF from local files, remote URLs, or SPARQL/Fuseki endpoints; lets users author nodes and edges directly on the canvas; runs [OWL 2 DL reasoning](https://www.w3.org/TR/owl2-profiles/#OWL_2_DL) (via Konclude) with visual differentiation of inferred triples; and applies multi-algorithm layout ([Dagre](https://github.com/dagrejs/dagre), [ELK](https://github.com/kieler/elkjs)) and automatic clustering for large graphs. Additional features include namespace management with live URI renaming, a drag-and-drop workflow template catalog, and a [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server for AI-agent integration. All computation runs entirely client-side in the browser against an in-memory RDF store backed by Web Workers — no backend required.

Key capabilities
----------------
- Load RDF/Turtle/JSON-LD/RDF-XML/N-Triples from local files or remote URLs (including SPARQL endpoints and Fuseki datasets).
- Startup URL support: auto-load an RDF file via URL query parameter (see "Startup / URL usage" below).
- **Reactodia canvas**: pan, zoom, minimap, fit-view, with entity group (cluster) support and smooth animations.
- **Authoring mode** (always on): add nodes via search, draw edges by dragging the halo "Establish Link" handle, edit node annotation properties and link predicates directly on the canvas. Undo/Redo support. Entity auto-complete uses scored domain/range tiers derived from loaded ontologies.
- **Search**: type in the search box to find entities by label or IRI; press Enter to cycle through matches on the canvas.
- **TBox / ABox views**: toggle between ontology-level classes/properties (TBox) and data-level individuals (ABox).
- **Layout engine**: multiple algorithms — Dagre (horizontal/vertical), ELK (layered, force, stress, radial), and Reactodia-default — all running in Web Workers so the UI stays responsive. Spacing is adjustable via a slider; re-layout triggers automatically when spacing changes.
- **Hierarchical fold levels**: graphs load with two levels of structural folding already applied — L2 (subclass chains and OWL collection axioms collapsed into representative group nodes) and L1 (per-node annotation properties hidden). A level badge in the toolbar shows the current depth (`L3`/`L2`/`∅`). Fold/Unfold buttons for each level let users progressively reveal detail. L3 (community-detection clustering — Label Propagation, Louvain, K-Means) applies automatically on load above a configurable node threshold (default 100). Each view (TBox / ABox) tracks its fold state independently.
- **DL reasoning (Konclude)**: run OWL 2 DL inference in the browser and see inferred triples rendered as amber dashed edges; inferred types/annotations appear in amber italic. A reasoning report lists all inferred triples. Includes automatic OWL DL consistency checking — the Errors tab shows per-entity clash details when the ontology is contradictory. Clear inferred triples any time without affecting asserted data.
- **Namespace management**: edit namespace URIs directly in the legend panel (rename propagates across all stored triples). Colour-coded namespace badges on nodes and edges.
- Export the current graph as Turtle, RDF/XML, or JSON-LD.
- **Workflow catalog**: drag reusable workflow template cards from the sidebar onto the canvas to instantiate connected subgraphs.
- **MCP support**: exposes a Model Context Protocol server (via the browser's `navigator.modelContext` API) for AI-agent integration. Tools: `loadRdf`, `loadOntology`, `suggestOntologiesForTask`, `queryGraph`, `exportGraph`, `exportImage`, `addNode`, `removeNode`, `expandNode`, `getNodes`, `addLink`, `removeLink`, `getLinks`, `runLayout`, `clusterNodes`, `layoutNodes`, `focusNode`, `fitCanvas`, `runReasoning`, `clearInferred`, `getNeighbors`, `findPath`, `getNodeDetails`, `updateNode`, `getGraphState`, `setNamespace`, `removeNamespace`, `listNamespaces`, `loadShacl`, `validateGraph`, `getCapabilities`, `help`. MCP manifest at `/.well-known/mcp.json`.

Quick start (development)
-------------------------
1. Install dependencies:
   ```sh
   npm install
   ```
2. Start the Vite dev server:
   ```sh
   npm run dev
   ```
3. Open in your browser:
   ```text
   http://localhost:8080/
   ```

Startup / URL parameters
------------------------
Ontosphere supports several URL query parameters that control what is loaded on startup.

### RDF data URL

| Parameter | Aliases        | Description |
|-----------|----------------|-------------|
| `rdfUrl`  | `url`, `vg_url` | HTTP(S) URL of an RDF resource to load on startup. |

**Supported sources:**

1. **Plain RDF files** — Turtle (.ttl), N-Triples (.nt), N3, RDF/XML, JSON-LD. Format is detected from `Content-Type` and file extension.
   ```
   ?rdfUrl=https://example.org/mydata.ttl
   ```

2. **SPARQL endpoints** — URLs whose path ends with `/sparql` or `/query` are recognised automatically. Ontosphere issues a `CONSTRUCT { ?s ?p ?o } WHERE { { ?s ?p ?o } UNION { GRAPH ?g { ?s ?p ?o } } }` query.
   ```
   ?rdfUrl=https://example.org/fuseki/$/sparql
   ```

3. **Fuseki dataset root** — Returns the full dataset; named-graph quads are flattened into the data graph.
   ```
   ?rdfUrl=https://docker-dev.iwm.fraunhofer.de/dataset/<uuid>/fuseki/$/
   ```

### Authentication (API key)

| Parameter      | Default         | Description |
|----------------|-----------------|-------------|
| `apiKey`       | —               | Value sent as an authentication header with the RDF fetch. |
| `apiKeyHeader` | `Authorization` | Name of the HTTP header. |

```text
?rdfUrl=https://private-endpoint.example.org/data.ttl
&apiKey=Bearer+my-token
&apiKeyHeader=Authorization
```

The API key is sent only with the RDF fetch request. CORS: the server must allow the Ontosphere origin with credentials (wildcard `*` origins are incompatible with authenticated requests).

### Ontology pre-loading

| Parameter    | Description |
|--------------|-------------|
| `ontologies` | Comma-separated list of ontologies that **replaces** the configured autoload list entirely. Each value is a well-known short name (see table below) or a full HTTPS/HTTP URI. Use `?ontologies=owl,rdf,rdfs` to load only the W3C core vocabs. |
| `ontology`   | Comma-separated list of ontologies to load **in addition to** the configured autoload list. |

```text
?ontologies=owl,rdf,rdfs           # replace defaults — load only W3C core vocabs
?ontology=bfo,dcat                 # add on top of configured autoload list
?ontology=bfo2020,https://example.org/myontology.ttl
```

**Well-known short names:**

| Short name | Ontology |
|------------|----------|
| `rdf`      | RDF Concepts Vocabulary |
| `rdfs`     | RDF Schema |
| `owl`      | OWL |
| `skos`     | SKOS |
| `prov`     | PROV-O – The PROV Ontology |
| `p-plan`   | P-Plan Ontology |
| `bfo`      | BFO 2.0 – Basic Formal Ontology 2.0 |
| `bfo2020`  | BFO 2020 – Basic Formal Ontology 2020 |
| `dcat`     | DCAT – Data Catalog Vocabulary |
| `foaf`     | FOAF |
| `dcterms`  | Dublin Core Terms |
| `qudt`     | QUDT |
| `iof-core` | IOF Core |

### Import discovery

| Parameter     | Default | Description |
|---------------|---------|-------------|
| `loadImports` | `true`  | Set to `false` to disable automatic loading of `owl:imports` referenced in the loaded RDF. Overrides the per-session app setting without persisting it. |

```text
?rdfUrl=https://example.org/data.ttl&loadImports=false
```

### SHACL shapes

| Parameter      | Description |
|----------------|-------------|
| `shaclShapes`  | URL of SHACL shapes to load on startup. Accepts a direct `.ttl` URL, a GitHub folder URL, or a comma-separated list. Overrides the configured shapes URL for this session. |

```text
?rdfUrl=https://example.org/data.ttl&shaclShapes=/shacl-shapes/ontology-quality.shacl.ttl
```

### Full example (CKAN private dataset via Fuseki SPARQL)

```text
http://docker-dev.iwm.fraunhofer.de:8080/
  ?rdfUrl=https://docker-dev.iwm.fraunhofer.de/dataset/<uuid>/fuseki/$/sparql
  &apiKey=<ckan-api-jwt-token>
```

### Startup loading order

All startup mechanisms are additive and run in this order:

1. Configured additional ontologies (app settings → *persistedAutoload*)
2. RDF data graph (`rdfUrl` / `url` / `vg_url`)
3. Ontologies from `?ontology=` URL parameter
4. `owl:imports` discovery (runs after each load unless `?loadImports=false`)

### Other startup mechanisms

- `window.__VG_STARTUP_TTL` — inline Turtle string loaded before any URL parameter.
- `window.__VG_STARTUP_URL` — programmatic URL override (takes precedence over `rdfUrl`).
- `VITE_STARTUP_URL` environment variable — build-time default startup URL.

Reasoning
---------

Ontosphere runs OWL reasoning entirely in the browser via a pluggable backend. The default is **Konclude** (full OWL 2 DL). Inferred triples appear as amber dashed edges; inferred types and annotations appear in amber italic. A reasoning report lists all inferred triples. Reasoning is idempotent — running it again produces no additional triples. Use **Clear inferred** to remove all inferred triples without affecting asserted data. See the [feat-reasoning demo video](https://thhanke.github.io/ontosphere/demo-videos/feat-reasoning.mp4) for a walkthrough of all 15 supported OWL 2 DL construct patterns.

**OWL DL consistency checking** runs automatically alongside inference (Konclude only). If the ontology is logically contradictory, reasoning is skipped and the report's **Errors** tab shows per-entity clash details (affected individual, violated axiom, description). An "OWL DL inconsistency detected" banner appears in the report. Common inconsistencies: an individual in two `owl:disjointWith` classes, an `owl:allValuesFrom` restriction violated by an asserted type, or an `owl:AsymmetricProperty` / `owl:IrreflexiveProperty` cycle. The N3 backend does not perform consistency checking (`isConsistent` is always `null`).

### Konclude (default — OWL 2 DL)

[Konclude](https://www.derivo.de/products/konclude/) is a complete tableau reasoner for the description logic **SROIQ(D)** (OWL 2 DL), compiled to WebAssembly. It runs classification over the loaded ontology and writes `rdfs:subClassOf` and `owl:equivalentClass` inferences.

**Supported OWL constructs (complete):** `rdfs:subClassOf`, `owl:equivalentClass`, `owl:someValuesFrom`, `owl:allValuesFrom`, `owl:hasValue`, `owl:inverseOf`, `owl:SymmetricProperty`, `owl:TransitiveProperty`, `owl:subPropertyOf`, `rdfs:domain`/`rdfs:range`, `owl:intersectionOf`, `owl:unionOf`, `owl:oneOf`, `owl:propertyChainAxiom`, number restrictions, nominals, and more.

**Deployment requirement:** Konclude's WASM binary uses `SharedArrayBuffer` (pthreads). The server must send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` headers. Localhost deployments have `SharedArrayBuffer` available without headers. Ontosphere's `server.js` sets these headers automatically.

**Performance:** 250 ms – 2.5 s for typical benchmark ontologies (LUBM, GALEN, Pizza).

### N3 Rules (legacy / advanced)

The N3 backend uses the **N3.js BGP-only Reasoner** with configurable rulesets loaded from `public/reasoning-rules/`. Select it in *Settings → Reasoner Backend → N3 Rules*.

N3.js is BGP-only: rules using EYE/SWAP built-ins (`e:findall`, `list:in`, `log:notEqualTo`) are silently ignored. The `[REQUIRES EYE]` comments in the rule files mark those rules. Use this backend when you need custom N3 rule files or are working with demos that depend on specific rule-file behavior.

**Performance:** Under 2 seconds for typical ontologies (hundreds to a few thousand triples). There is currently no way to abort a running reasoning job; a page reload is required if reasoning hangs.

Reasoning demo
--------------
The reasoning demo showcases OWL 2 DL / SROIQ(D) inference on a small employee ontology:
[Open demo ↗](https://thhanke.github.io/ontosphere/?rdfUrl=https://raw.githubusercontent.com/ThHanke/ontosphere/refs/heads/main/public/reasoning-demo.ttl)

The demo (`public/reasoning-demo.ttl`) defines a Person → Employee → Manager → Executive hierarchy with ABox assertions that drive inference patterns across all OWL 2 DL construct groups:

**OWL 1 RL patterns:**
1. **rdfs:subPropertyOf** — `ex:hasFriend` sub-property of `ex:knows`: `alice hasFriend bob` → `alice knows bob`.
2. **owl:inverseOf** — `ex:isManagedBy` inverse of `ex:manages`: `alice manages carol` → `carol isManagedBy alice`.
3. **owl:SymmetricProperty** — `ex:isColleagueOf` is symmetric: `bob isColleagueOf carol` → reverse direction.
4. **owl:TransitiveProperty** — `ex:hasSupervisor` is transitive: `bob→alice`, `alice→dave` → `bob→dave`.
5. **rdfs:domain** — `ex:dave` has no type; because he is subject of `ex:manages` (domain `ex:Manager`), the reasoner infers `dave rdf:type ex:Manager`.

**OWL 2 DL extensions:**
6. **owl:someValuesFrom** — `alice` and `carol` each `worksOn projectAlpha` (a `Project`) → inferred `ProjectContributor`.
7. **owl:hasValue** — `carol isManagedBy alice` (via inverseOf) → `carol` inferred `DirectReport` (hasValue restriction on alice).
8. **owl:intersectionOf** — `dave` manages `bob` (inferred Manager) and `eve` (Employee) → `dave` inferred `TeamLead`.
9. **owl:disjointWith** — `Contractor disjointWith Employee`; `frank` is a `Contractor` (structural TBox constraint).
10. **owl:complementOf** — `NonEmployee ≡ ¬Employee` (structural TBox only).
11. **owl:propertyChainAxiom** — `hasGrandManager ← hasSupervisor ∘ hasSupervisor`: `carol→bob→alice` → `carol hasGrandManager alice`.
12. **owl:unionOf** — `LeadershipTeam ≡ Executive ∪ Manager`: `alice` (Executive) and `dave` (inferred Manager) → inferred `LeadershipTeam`.
13. **owl:sameAs** — `aliceCEO sameAs alice`: `aliceCEO` inherits all of `alice`'s inferred types including `Executive`.

A separate **inconsistency demo** (`public/reasoning-demo-inconsistent.ttl`) shows the consistency checker in action:
[Open inconsistency demo ↗](https://thhanke.github.io/ontosphere/?rdfUrl=https://raw.githubusercontent.com/ThHanke/ontosphere/refs/heads/main/public/reasoning-demo-inconsistent.ttl)

`inc:frank` is asserted as both `inc:Employee` and `inc:Contractor`, which are declared `owl:disjointWith`. Running reasoning produces `isConsistent: false`, reasoning is skipped, and the report's Errors tab shows the disjointness clash on `frank`.

SHACL validation
-----------------
Ontosphere validates RDF data against [SHACL](https://www.w3.org/TR/shacl/) (Shapes Constraint Language) shapes. SHACL shapes define constraints on your data — required properties, value ranges, cardinality — and the validation engine reports which nodes violate them.

SHACL validation runs automatically as part of the reasoning pipeline. After reasoning completes, the reasoning report shows SHACL violations alongside OWL inferences, with **SHACL** / **OWL** source badges on each finding. Only SHACL errors (severity `sh:Violation`) mark the data as invalid; warnings (`sh:Warning`) and info-level findings do not.

Affected nodes display validation badges directly on the canvas — red for errors, amber for warnings. Clicking a finding in the reasoning report navigates to the affected node.

### Loading shapes

| Method | Description |
|--------|-------------|
| `?shaclShapes=` URL parameter | Direct `.ttl` URL, GitHub folder URL, or comma-separated list |
| Settings → SHACL tab | Persistent shapes URL with bundled presets |
| MCP tool `loadShaclFromUrl` | AI-agent-driven shape loading |

Shapes are loaded into the `urn:vg:shapes` named graph, which is excluded from OWL reasoning. The sidebar **SHACL Shapes** panel shows loaded shapes with their target classes, constraint messages, and severity levels.

### Bundled shape presets

| Preset | Target | Checks |
|--------|--------|--------|
| Ontology Quality | `owl:Class`, `owl:ObjectProperty`, `owl:DatatypeProperty` | `rdfs:label`, `rdfs:comment`, `rdfs:domain`, `rdfs:range` |
| SKOS Quality | `skos:Concept`, `skos:ConceptScheme` | `skos:prefLabel`, `skos:inScheme`, `rdfs:label` |
| Reasoning Demo | `ex:Project`, `ex:Contractor`, `ex:Employee`, `owl:NamedIndividual` | Missing descriptions, supervisors, job titles |

### SHACL demo

The SHACL demo loads the reasoning-demo ontology with purpose-built shapes that produce both errors and warnings:

[Open SHACL demo ↗](https://thhanke.github.io/ontosphere/?rdfUrl=https://raw.githubusercontent.com/ThHanke/ontosphere/refs/heads/main/public/reasoning-demo.ttl&shaclShapes=https://raw.githubusercontent.com/ThHanke/ontosphere/refs/heads/main/public/shacl-shapes/reasoning-demo.shacl.ttl)

After loading, click **▶** (Run Reasoning) in the toolbar. The report will show:

- **2 errors** (sh:Violation): `projectAlpha` missing `rdfs:comment`; `frank` (Contractor) missing `ex:hasSupervisor`
- **12 warnings** (sh:Warning): employees missing `ex:jobTitle`; all individuals missing `rdfs:comment`

Each finding links to the affected node — click to close the dialog and navigate to it on the canvas. Error and warning badges appear directly on affected nodes.

CORS and proxies
----------------
Ontosphere fetches remote RDF directly from the browser. If the remote host does not allow cross-origin requests, the fetch will be blocked.

**Well-known ontologies** (FOAF, SKOS, PROV-O, Dublin Core, QUDT, etc.) are pre-configured with CORS-friendly fetch URLs (W3C, dublincore.org, LOV, qudt.org) and load without any proxy.

**Custom ontology URLs** that lack CORS headers require a proxy. Configure one in Settings → Advanced → CORS Proxy URL. The proxy must:
- Accept a URL-encoded target as a query parameter: `https://your-proxy/?url=<encoded>`
- Forward the `Accept` header to the target server
- Not restrict RDF MIME types (`text/turtle`, `application/rdf+xml`, etc.)

> **Note:** `corsproxy.io` free tier blocks RDF content types and will not work. Self-hosted options that do work: a [Cloudflare Worker](https://developers.cloudflare.com/workers/) using the cors-anywhere pattern, or a local Vite dev-server proxy.

Workarounds for development:
- Use CORS-enabled hosting for the RDF file.
- Configure a local dev proxy in your Vite config to forward the request.

Using the UI
------------

<details>
<summary>Expand annotated UI reference (human operators)</summary>

The annotated diagram below identifies the numbered UI elements described in this section.

![Ontosphere UI overview](public/ui-overview.svg)

### Top bar — left group

**1** **☰ View menu** — dropdown: Export canvas as PNG, Export as SVG, Print, Show/Hide Legend (toggles the namespace colour key panel).

**2** **Search** — type to find entities by label or IRI. ↑↓ arrows or **Enter** cycle through matches on the canvas. The badge shows current match / total count.

### Top bar — right group (action toolbar)

**3** **Layout** — opens the layout popover: choose algorithm (Dagre horizontal/vertical, ELK layered/force/stress/radial, Reactodia-default), adjust spacing via a slider, toggle auto-layout (re-runs after every graph update).

**4** **Level badge** — shows current fold depth: `L3` (community-detection clusters active), `L2` (structural fold active — subclass chains and OWL collections), or `∅` (fully expanded).

**5** **Clustering algorithm selector** — choose between None, Label Propagation, Louvain, or K-Means. The large-graph threshold (default 100 nodes, configurable in Settings) controls when auto-clustering runs on load.

**6** **Cluster** — cluster visible nodes with the selected algorithm. Disabled when already clustered or algorithm is None.

**7** **Expand All** — expand all collapsed cluster groups at once.

**8** **Fold L2 / Unfold L2** — toggle structural fold: collapses subclass chains and OWL collection members (`owl:intersectionOf`, `owl:unionOf`, etc.) into representative group nodes. Applied by default on load.

**9** **Fold L1 / Unfold L1** — toggle per-node annotation property visibility across all nodes at once.

**10** **A-Box / T-Box** — switch between instance-level individuals (A-Box, highlighted when active) and ontology-level classes/properties (T-Box).

**11** **Ontologies** — shows the count of loaded ontologies. Click to open a popover listing each ontology with options to add/remove from autoload.

**12** **Reasoning status** — shows the current DL reasoning state: Ready / ✓ Valid / ⚠ Warnings / Errors / spinner while running. Click to open the reasoning report (inferred triples grouped by rule).

**13** **Clear inferred** (🗑) — removes all inferred triples without touching asserted data.

**14** **Run reasoning** (▶) — triggers DL reasoning (Konclude). Inferred triples appear as amber dashed edges. Idempotent.

### Authoring toolbar (bottom left)

**15** **Undo** — undo last authoring change.

**16** **Redo** — redo last undone change.

**17** **Save** — commit all pending authoring edits to the RDF store in a single batch.

**18** **Re-layout** — re-apply the current layout algorithm in-place.

### Left sidebar

**19** **Onto** — open the ontology loader. Enter any HTTP(S) URL or pick from pre-configured sources in Settings.

**20** **File** — open a file picker for local RDF files. Supported: Turtle (.ttl), JSON-LD (.jsonld), RDF/XML (.rdf/.owl), N-Triples (.nt).

**21** **Clear** — remove all loaded graphs and reset the canvas.

**22** **Export** — export as Turtle, JSON-LD, or RDF/XML (dropdown). Generated entirely in the browser.

**23** **Settings** — open the settings panel for default layout, clustering algorithm, large-graph threshold, ontology autoload URLs, workflow catalog, and other preferences.

### Sidebar content (expanded)

When the sidebar is expanded (click the **›** toggle), the file operation buttons are shown in a compact grid. A **Workflows** accordion appears below when the workflow catalog is enabled in Settings. Drag a template card onto the canvas to instantiate it as a connected subgraph.

### Node authoring halo (visible on selected node)

**24** **Edit / Delete** — buttons that appear above a selected node. **Edit** opens the property editor (IRI, annotation properties, custom fields). **Delete** permanently removes the entity from the RDF store.

**25** **Remove** (✕) — removes the node from the canvas view without deleting it from the RDF store.

**26** **Establish Link** (plug icon, right side) — drag to another node to create a new edge. A dialog confirms the predicate with scored autocomplete from loaded ontologies.

**27** **Expand neighbours** (∧, bottom) — load and show all RDF neighbours of the node on the canvas.

### Canvas elements

**28** **Individual node** — represents an RDF subject. The header shows the local name, a coloured namespace badge, and the OWL class. Properties (IRI, annotations, custom fields) are shown in an editable table on selection.

**29** **Edge / predicate** — labelled arrow between two nodes. Amber dashed edges are inferred triples. Double-click to open the link property editor (scored autocomplete from ontologies).

**30** **Minimap** — overview panel at bottom-right. Click to jump to a region, drag to pan.

### Canvas interactions
- **Add a node**: type in **2** Search and press Enter to search the ontology; select a match to place it on the canvas.
- **Authoring mode** is always active: hover a node to reveal the halo (**24**–**27**).
- Drag the **26** Establish Link handle to another node to create a new edge.
- Double-click an edge (**26**) to open the link property editor.
- Scroll to zoom; drag the background to pan.
- Namespace legend panel: enable via **1** View menu → Show Legend. Click a namespace entry's pencil icon to rename its URI; renames propagate across all stored triples.
- Use the fit-view button in the canvas controls (left side, zoom icon group) to reset the viewport.

</details>

Developer utilities (window globals)
------------------------------------
The following debug flags can be set in the browser console to enable diagnostic output. All are gated — they only activate when `window.__VG_DEBUG__` is truthy (or `config.debugAll` is enabled in Settings):

- `window.__VG_DEBUG__` — master debug gate. Set to `true` to enable all `[VG_*]` diagnostic console output.
- `window.__VG_LOG_RDF_WRITES` — log RDF triple writes to the console.
- `window.__VG_DEBUG_STACKS__` — capture stack traces in debug messages.
- `window.__VG_DEBUG_SUMMARY__` — read-only object populated by the startup debug harness with fallback and timing data.

All flags are also persisted from `config.debugAll` (toggleable in Settings → Debug). Setting `config.debugAll = true` via Settings is the recommended way to enable diagnostics without console access.

Troubleshooting
---------------
- **rdfUrl doesn't load on open:**
  - Confirm the URL is percent-encoded in the address bar.
  - Open DevTools → Network and check the fetch request and response headers.
  - Look for CORS errors (`Access-Control-Allow-Origin`).
  - Check the console for RDF parser errors or application diagnostics.
- **403 when using certain query parameter names:**
  - Some servers intercept reserved query names. Use `?rdfUrl=...` to avoid conflicts.
- **Graph is very large / slow:**
  - Increase the large-graph threshold in Settings or reduce the number of loaded triples.
  - Clustering activates automatically above the threshold; use Expand All sparingly on huge graphs.

AI / MCP Integration
--------------------

Ontosphere exposes a full [Model Context Protocol](https://modelcontextprotocol.io) tool surface so AI agents can build and reason over knowledge graphs through natural-language chat.

### How it works

The app has two coupled layers:

- **N3 RDF store** — source of truth. `addNode` / `addLink` write triples here.
- **Reactodia canvas** — visual mirror. Nodes are *not* created automatically from triples; you must call `addNode` to place a subject on canvas. After adding triples, canvas links refresh automatically. Nodes start collapsed — call `expandNode` (with an IRI to expand one node, or no args to expand all) to reveal annotation property cards.

DL reasoning (Konclude) writes inferred triples back to the store and refreshes the canvas.

### Setup (Playwright / headless)

`navigator.modelContext` does not exist in headless Chromium. Inject the polyfill **before** the page loads using `page.addInitScript`:

```js
await page.addInitScript(() => {
  const tools = {};
  Object.defineProperty(navigator, 'modelContext', {
    value: { registerTool: async (n, _d, _s, h) => { tools[n] = h; } },
    configurable: true,
  });
  window.__mcpTools = tools;
});

// After page load:
await page.evaluate(async () => {
  const mod = await import('/src/mcp/ontosphereMcpServer.ts');
  await mod.registerMcpTools();
});

// Call a tool:
await page.evaluate(async ([name, params]) => window.__mcpTools[name](params),
  ['addNode', { iri: 'ex:alice', typeIri: 'foaf:Person', label: 'Alice' }]);
```

In a browser with native `navigator.modelContext`, tools register automatically on app load.

### Example output

An AI agent built this from scratch in one session — [full demo with tool calls →](docs/mcp-demo/foaf-social-network.md)

[![FOAF social network](docs/mcp-demo/foaf-social-network/04-frank-focus.svg)](docs/mcp-demo/foaf-social-network.md)

### Recommended workflow

```text
loadOntology (TBox)
  → addNode ×N  (ABox individuals, rdf:type set)
  → addLink ×N  (object-property triples, edges appear on canvas)
  → runLayout   (dagre-lr recommended)
  → expandNode  (reveal annotation property cards — omit iri to expand all)
  → runReasoning (infer subClass / domain / range entailments; isConsistent=false signals contradiction)
  → fitCanvas + exportImage   (SVG snapshot, token-efficient)
  → exportGraph(turtle)       (final deliverable)
```

### URL parameters

| Parameter | Effect |
|-----------|--------|
| `?url=<encoded-url>` | Load RDF from URL on startup |
| `?ontology=foaf` | Pre-load FOAF ontology |
| `?loadImports=false` | Skip owl:imports auto-loading |

### Demo

| Demo | Final state |
|------|-------------|
| **[FOAF social network](docs/mcp-demo/foaf-social-network.md)**<br>Build a social network, extend FOAF with employment classes, run reasoning | [![FOAF social network final state](docs/mcp-demo/foaf-social-network/04-frank-focus.svg)](docs/mcp-demo/foaf-social-network.md) |
| **[DL reasoning (Konclude)](docs/mcp-demo/reasoning-demo.md)**<br>Build TBox + ABox, infer types via domain/range and transitivity | [![DL reasoning final state](docs/mcp-demo/reasoning-demo/04-dave-focus.svg)](docs/mcp-demo/reasoning-demo.md) |
| **[Scene ontology](docs/mcp-demo/scene-ontology.md)**<br>Load an external ontology, author individuals, export Turtle | [![Scene ontology final state](docs/mcp-demo/scene-ontology/04-jake-focus.svg)](docs/mcp-demo/scene-ontology.md) |
| **[Manchester Pizza Tutorial](docs/mcp-demo/pizza-tutorial.md)**<br>Full OWL pizza ontology — classes, disjointness, properties, DL reasoning | [![Manchester Pizza Tutorial final state](docs/mcp-demo/pizza-tutorial/20-owa-vegetarian-lesson.svg)](docs/mcp-demo/pizza-tutorial.md) |

Regenerate:

```sh
npm run demo:all
# or individually:
node scripts/run-demo.mjs docs/mcp-demo/seeds/foaf-social-network.md
node scripts/run-demo.mjs docs/mcp-demo/seeds/reasoning-demo.md
node scripts/run-demo.mjs docs/mcp-demo/seeds/scene-ontology.md
node scripts/run-demo.mjs docs/mcp-demo/seeds/pizza-tutorial.md
```

Full tool declarations with input schemas: [public/.well-known/mcp.json](public/.well-known/mcp.json)

### Using Ontosphere with any AI

The demo scripts work against the **live deployment** — no local server needed. Any AI that can drive a browser (Claude Code, headless Playwright, computer-use agents) can use Ontosphere directly via its MCP tools.

#### Claude Code / Playwright (full automation)

Point the demo scripts at the deployed app:

```sh
node scripts/mcp-demo-reasoning.mjs --url https://thhanke.github.io/ontosphere
node scripts/mcp-demo-foaf.mjs       --url https://thhanke.github.io/ontosphere
```

The script opens a headless browser, navigates to the URL, registers the MCP tools, then drives the full workflow — building TBox + ABox, running reasoning, taking snapshots, exporting Turtle — exactly as shown in the demo documents.

#### ChatGPT, Gemini, Claude.ai — AI Relay Bridge

The **AI Relay Bridge** connects any AI chat tab to Ontosphere with no server, extension, or copy-paste. A bookmarklet watches the AI's output for backtick-wrapped JSON-RPC 2.0 tool calls, executes them in Ontosphere via a BroadcastChannel popup, and injects JSON-RPC responses back into the chat input automatically.

➡️ **[Full setup guide: docs/relay-bridge.md](docs/relay-bridge.md)**

**Setup (one time):**
1. Open Ontosphere, expand the **AI Relay** sidebar panel
2. Drag the **Ontosphere Relay** button to your browser bookmark bar
3. Go to your AI chat tab and click the bookmark — a small relay popup opens

**Starter prompt** (paste into your AI chat after clicking the bookmarklet):

```text
You are connected to Ontosphere via a relay. A script in this tab intercepts your tool calls, runs them in Ontosphere, and injects results back as a user message. If a tool call returns success:false, read the error, fix the argument, and retry the same call immediately — never skip a failed call. Ask the user what they would like to build.

Output format — one JSON-RPC 2.0 call per line, backtick-wrapped:
`{"jsonrpc":"2.0","id":<N>,"method":"tools/call","params":{"name":"<toolName>","arguments":{...}}}`

Call help first to get full instructions and the tool list:
`{"jsonrpc":"2.0","id":0,"method":"tools/call","params":{"name":"help","arguments":{}}}`
```

The relay handles execution and result feedback automatically — no manual copy-paste needed.

Recording demo videos
---------------------
See [docs/demo-scripts/HOWTO.md](docs/demo-scripts/HOWTO.md) for the full guide.

Three styles of demo video are supported:

**Seed-driven** — write a seed markdown file in `docs/mcp-demo/seeds/` with JSON-RPC
tool calls and `\`\`\`action` UI action blocks. The runner parses the seed and executes each
step (tool calls via `window.__mcpTools`, UI actions via Playwright locators).

**Chat-style (side-by-side)** — open `demo-stage.html` (mock chat left, app right),
inject messages programmatically via `addChatMessage()`, and call tools on the app
iframe via `callToolOnStage()`. No relay popup needed. Example: `pizza-tutorial-chat`.

**Feature demos** — focused 60–90 second demos, one per paper feature section. All use
`reasoning-demo.ttl` as the shared dataset. Seeds mix MCP tool calls with UI action blocks.

### Feature demos (paper-aligned)

| Video | Paper Section | Description |
|-------|---------------|-------------|
| [feat-loading.mp4](https://thhanke.github.io/ontosphere/demo-videos/feat-loading.mp4) | §3.1 Zero-Install + RDF Loading | URL param load, file upload, SPARQL endpoint |
| [feat-exploration.mp4](https://thhanke.github.io/ontosphere/demo-videos/feat-exploration.mp4) | §3.2 Visual Exploration | TBox/ABox toggle, search, zoom/pan, minimap |
| [feat-authoring.mp4](https://thhanke.github.io/ontosphere/demo-videos/feat-authoring.mp4) | §3.3 Canvas Authoring | Add class, draw edge, edit annotation, undo/redo |
| [feat-clustering.mp4](https://thhanke.github.io/ontosphere/demo-videos/feat-clustering.mp4) | §3.4 Hierarchical Clustering | L2 fold/unfold, L3 Louvain community detection |
| [feat-reasoning.mp4](https://thhanke.github.io/ontosphere/demo-videos/feat-reasoning.mp4) | §3.5 OWL 2 DL Reasoning | Konclude WASM, inferred triples, ABox inspection |
| [feat-shacl.mp4](https://thhanke.github.io/ontosphere/demo-videos/feat-shacl.mp4) | §3.6 SHACL Validation | Load shapes, validate, reasoning interplay |
| [feat-ai-relay.mp4](https://thhanke.github.io/ontosphere/demo-videos/feat-ai-relay.mp4) | §3.7 MCP + AI Relay | Bookmarklet injection, AI tool calls, relay round trip |

### Workflow demos

| Video | Description |
|-------|-------------|
| [iswc2026-comprehensive.mp4](https://thhanke.github.io/ontosphere/demo-videos/iswc2026-comprehensive.mp4) | Full 3-minute walkthrough of all features |
| [foaf-social-network.mp4](https://thhanke.github.io/ontosphere/demo-videos/foaf-social-network.mp4) | AI builds a FOAF social graph with DL reasoning |
| [scene-ontology.mp4](https://thhanke.github.io/ontosphere/demo-videos/scene-ontology.mp4) | AI builds a film scene ontology on BFO/RO upper ontology |
| [pizza-tutorial.mp4](https://thhanke.github.io/ontosphere/demo-videos/pizza-tutorial.mp4) | Manchester Pizza Ontology — class hierarchy, disjointness, DL reasoning |
| [pizza-tutorial-chat.mp4](https://thhanke.github.io/ontosphere/demo-videos/pizza-tutorial-chat.mp4) | OWL pizza tutorial as AI tutor lesson, side-by-side chat |

To re-record all videos:
```sh
npm run demo:video   # starts dev server, records, encodes, kills server
```

Contributing / Development notes
---------------------------------
- Canvas & top bar: [src/components/Canvas/](src/components/Canvas/)
- Cluster algorithms: [src/components/Canvas/core/clusterAlgorithms/](src/components/Canvas/core/clusterAlgorithms/)
- Layout functions: [src/components/Canvas/layout/](src/components/Canvas/layout/)
- Search widget: [src/components/Canvas/search/](src/components/Canvas/search/)
- RDF worker and protocol: [src/workers/](src/workers/)
- MCP server and tools: [src/mcp/](src/mcp/)
- Tests: [src/__tests__/](src/__tests__/) — run with `npm test`.

License & authors
-----------------
Check the repository root for licence and contributor information.
