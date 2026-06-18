# Ontosphere v1.5.0

The main theme of v1.5.0 is **first-class SHACL validation** — Ontosphere now validates RDF data against SHACL shapes alongside OWL 2 DL reasoning, with visual feedback directly on the canvas.

## Highlights

- **SHACL validation** integrated into the reasoning pipeline with canvas violation badges, severity handling, and click-to-navigate
- **shacl-engine migration** — replaced rdf-validate-shacl with shacl-engine for SHACL Core + SPARQL-based constraints and targets
- **7 per-feature demo videos** aligned with the ISWC 2026 paper sections
- **ISWC 2026 demo paper** published at [thhanke.github.io/ontosphere/paper/](https://thhanke.github.io/ontosphere/paper/)

## Features

### SHACL Validation
- First-class SHACL validation with sidebar panel showing loaded shapes, target classes, and constraint messages
- Canvas node badges — red for violations (`sh:Violation`), amber for warnings (`sh:Warning`)
- Click-to-navigate from reasoning report findings to affected nodes
- SHACL/OWL source badges on each finding in the reasoning report
- `?shaclShapes=` URL parameter for loading shapes on startup (direct URLs, GitHub folders, comma-separated)
- Bundled shape presets: Ontology Quality, SKOS Quality, Reasoning Demo
- Settings → SHACL tab with persistent shapes URL configuration
- Optional SHACL validation toggle (persistent checkbox — disable if shapes are not needed)
- MCP tools: `loadShacl` (inline Turtle), `validateGraph`, `loadShaclFromUrl` (URL/GitHub auto-discovery)

### Demo Videos & Paper
- 7 per-feature demo videos: loading, exploration, authoring, clustering, reasoning, SHACL, AI relay
- Animated cursor overlay with keyframe system for demo recordings
- Per-video trim configuration for idle frame removal
- ISWC 2026 comprehensive demo reworked with PMDCO data-quality story
- Declarative UI action blocks in demo seed format

## Improvements

- **SHACL engine**: migrated from `rdf-validate-shacl` to `shacl-engine` — adds SPARQL-based constraints and targets, 15–26× faster validation
- **Export**: strip unused prefixes from exported files; use loaded filename as download name
- **Reasoning**: 3-minute timeout for Konclude WASM calls; worker reset on ontology unload
- **UI**: all dialogs migrated to Tailwind-native overlay pattern; toolbar button alignment (Layout, Ontologies)

## Fixes

- SHACL: filter false-positive warnings from ontology classes
- SHACL: clear named graph before loading new shapes from URL
- SHACL: fix stale highlights, deferred badge rendering, badge count per message
- SHACL: revalidate badges on ABox/TBox view mode switch
- Navigation: switch views for IRIs not in iriViewMap (blank nodes)
- UI: fix mobile dialog overlay issues

## Full Changelog

See [v1.4.1...v1.5.0](https://github.com/ThHanke/ontosphere/compare/v1.4.1...v1.5.0) for the complete list of changes.
