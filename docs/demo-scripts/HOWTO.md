# Demo video HOWTO

## Re-record an existing video

```sh
npm run dev          # terminal 1 — keep running
npm run demo:video   # terminal 2
```

Outputs `docs/demo-videos/<name>.webm` + `.mp4`. Commit both.
`demo:video` runs Playwright then automatically calls `scripts/collect-demo-videos.mjs`, which copies videos from the hashed Playwright output dir to `docs/demo-videos/<name>.*`.

> **Requires `ffmpeg`** for `.mp4` conversion. If missing, only `.webm` is written and a warning is printed.
> Install: `sudo apt install ffmpeg` (Debian/Ubuntu) or `brew install ffmpeg` (macOS).

## Per-video post-processing options

The collect script runs idle-block compression by default (via `scripts/shorten-idle.py`): it detects long static sections and shortens them to keep the video tight. This works well for demos with long AI thinking pauses (e.g. OWUI Socratic) but can falsely cut active content in UI-action demos where short pauses between turns get merged into one big "idle" block.

Override per video by placing a `docs/demo-videos/<name>.video.json` file:

```json
{
  "idleTrim": false,
  "noCutLast": true,
  "extraVf": "split[_bm][_bi];[_bi]crop=700:40:100:30,boxblur=8:2[_bl];[_bm][_bl]overlay=100:30"
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `idleTrim` | `true` | Run idle-block compression. Set `false` for UI-action demos. |
| `noCutLast` | `false` | Keep last idle block at full length (useful when the final freeze is the demo payoff). |
| `extraVf` | `""` | Extra ffmpeg video filter appended after concat (e.g. blur a URL bar). |

All fields are optional — omit the file entirely to get defaults.

## Create a new demo video

1. Write screenplay in `docs/demo-scripts/<name>.md` — plain English prose
2. Ask Claude: *"Record a demo video from this screenplay: `docs/demo-scripts/<name>.md`"*
3. Claude writes `e2e/demo-<name>.spec.ts` using `DemoRunner` from `e2e/demo-runner.ts`
4. Run `npm run demo:video` — produces and commits video files

## Create a seed-driven demo video

Seed files (`docs/mcp-demo/seeds/*.md`) already contain the full AI workflow as JSON-RPC tool calls.
To turn one into a video, create a spec that calls `DemoRunner.parseSeed()` + `runSeedTurn()`:

```ts
const turns = DemoRunner.parseSeed('docs/mcp-demo/seeds/my-seed.md'); // relative to repo root
await runner.openApp();
for (const turn of turns) {
  await runner.runSeedTurn(turn, 250);
  await runner.pauseMs(600);
}
```

`parseSeed()` extracts tool calls and snapshot captions from the seed markdown.
`runSeedTurn()` calls each tool directly on `window.__mcpTools` and shows the caption overlay.

## Extended seed format — action blocks

Seeds support `\`\`\`action` fenced blocks alongside JSON-RPC tool calls. Each line is one UI action:

```
\`\`\`action
click: [selector]               — click a Playwright locator
fill: [selector] | [text]       — type text into an input (clears first)
scroll: [deltaX] [deltaY]       — mouse wheel scroll at viewport center
drag: [selector] | [dx] [dy]    — drag element by offset
dragTo: [src-selector] | [tgt]  — drag from source element to target element
select: [selector] | [text]     — select option containing text from <select>
hover: [selector]               — hover over element
key: [key]                      — press key (e.g. "Control+z", "Enter")
wait: [ms]                      — pause for N milliseconds
waitFor: [selector]             — wait for element to be visible
\`\`\`
```

Actions and tool calls are interleaved in encounter order within each turn. Unknown action types are silently skipped. Seeds without action blocks work exactly as before.

**When to use actions vs MCP tools:** Use action blocks when the UI interaction is more visually compelling than the MCP equivalent (clicking buttons, typing in search, undo/redo). Use MCP tool calls for bulk operations (loading data, running reasoning, adding many triples).

## Animated cursor overlay

All action-based demos get a large animated cursor overlay automatically. The cursor is a white arrow with black outline and drop shadow, injected into the page DOM at `z-index: 999998` with `pointer-events: none`.

- Before each `click`, `fill`, `hover`, `select` action, the cursor animates from its current position to the target element center (~400ms ease-in-out)
- For `drag`/`dragTo` actions, the cursor animates to the source, holds mouse down, then animates to the destination (~600ms)
- Passive actions (`wait`, `waitFor`, `key`) skip cursor animation
- The cursor starts at viewport center and is visible in keyframe screenshots

No configuration needed — cursor is always active during action execution.

## Keyframe inspection system

Capture screenshots at every `snapshot` slug to verify demo correctness without watching the full video.

```sh
DEMO_KEYFRAMES=1 npx playwright test --config=playwright.demo.config.ts e2e/demo-feat-authoring.spec.ts
```

Output: `docs/demo-keyframes/<demoName>/01-slug.png`, `02-slug.png`, etc. plus `summary.json` and `summary.md`.

To enable, the spec must call `runner.setDemoName('feat-authoring')` before running turns. The snapshot `slug:` field in the seed drives filenames.

Clean up before re-recording:
```sh
rm -rf docs/demo-keyframes/   # also done by scripts/demo-video.sh
```

The `docs/demo-keyframes/` directory is git-ignored — keyframes are for local inspection only.

## Feature demos

Feature demos are focused 60–90 second recordings, one per paper feature section. All use `reasoning-demo.ttl` as the shared dataset for a consistent narrative.

| Slug | Paper Section | Duration |
|------|---------------|----------|
| `feat-loading` | Zero-Install + RDF Loading | 60 s |
| `feat-exploration` | Visual Exploration | 60 s |
| `feat-authoring` | Canvas Authoring | 75 s |
| `feat-clustering` | Hierarchical Clustering | 75 s |
| `feat-reasoning` | OWL 2 DL Reasoning | 90 s |
| `feat-shacl` | SHACL Validation | 75 s |
| `feat-ai-relay` | MCP + AI Relay Bridge | 90 s |

Each has three files:
- Screenplay: `docs/demo-scripts/feat-<slug>.md`
- Seed: `docs/mcp-demo/seeds/feat-<slug>.md`
- Spec: `e2e/demo-feat-<slug>.spec.ts`

## Runner primitives (`e2e/demo-runner.ts`)

| Method | Description |
|--------|-------------|
| `openStage()` | Opens mock chat (left) + app (right) at 1920×1080 |
| `openApp()` | Opens app alone (full viewport) — for seed-driven demos |
| `DemoRunner.parseSeed(path)` | Parse seed markdown → `SeedTurn[]` (static) |
| `runSeedTurn(turn, delayMs?)` | Execute one seed turn: caption + tool calls on app frame |
| `injectBookmarklet()` | Injects relay bookmarklet, waits for popup |
| `clickScenario(name)` | `single \| batch \| full \| prefixed \| unknown-tool` |
| `switchMode(mode)` | `fhgenie \| openwebui \| chatgpt` |
| `waitForResult(timeout?)` | Waits for `[Ontosphere` result in chat stream |
| `clearChat()` | Clears mock chat |
| `pauseMs(ms)` | Pacing pause |
| `caption(text)` | Bottom-center overlay — stays until replaced or cleared |
| `clearCaption()` | Remove overlay |
| `captionPause(text, ms)` | Show caption → pause → clear |

## Building an OWUI Socratic demo: interactive-first workflow

The OWUI Socratic demo (pizza-ontology) drives a live AI model through Socratic questions
and records its tool calls on the Ontosphere canvas. The scripted Playwright spec must
match what that specific model (qwen3:4b) actually does — not what we wish it did.

**Workflow: validate questions interactively, then encode them in the spec.**

### Step 1 — Prerequisites

```bash
# Terminal 1: keep Ontosphere dev server running
npm run dev

# Terminal 2: clear stale browser state before each session
bash .playwright/demo-restart.sh
```

MCP browser must have two tabs **before** running setup:
- **Tab 0** — Ontosphere at `http://docker-dev.iwm.fraunhofer.de:8080`
- **Tab 1** — OWUI at `https://gpuserver1-sit.iwm.fraunhofer.de` (authenticated)

If OWUI shows auth page, restore session from saved state:
```bash
OWUI_URL=https://gpuserver1-sit.iwm.fraunhofer.de npm run demo:owui:auth
```
Or inject the token inline (see pizza-demo-setup.js auth section).

### Step 2 — Bootstrap the interactive session

```text
mcp__playwright__browser_run_code_unsafe filename=.playwright/pizza-demo-setup.js
```

Expected return: `{ ok: true, chatUrl, instrInjected: true, turn0: true }`.

This sends: plain-text seed → relay injection → `help({})` call → T0 question.
Turn 0 is now in flight. Wait for the model to finish (relay toast appears, streaming stops).

### Step 3 — Observe T0 behavior

Check two things:
1. **Canvas**: take a screenshot or read node list — does it match the expected OWL concept?
2. **OWUI chat body**: read `document.body.innerText` to see what qwen3 actually generated.
   Look for which tools were called (relay result lines: `[Ontosphere — N tools ✓]`).

Key questions per turn:
- Did qwen3 use the right OWL concept? (e.g. `rdfs:subClassOf`, `owl:disjointWith`)
- Did it stay on-topic? (qwen3 sometimes introduces off-topic classes like `Person/Alice`)
- Did it call too many tools in one response (went ahead of where we wanted to stop)?
- Did the canvas change correctly?

### Step 4 — Drive turns interactively

Inject remaining turns one at a time via turn-driver.js OR manually via `__vgInjectResult`:

```text
mcp__playwright__browser_run_code_unsafe filename=.playwright/turn-driver.js
```

Or inject a single turn manually:
```js
// In browser_run_code_unsafe:
async (page) => {
  const owuiPage = page.context().pages().find(p => p.url().includes('gpuserver1-sit'));
  const ok = await owuiPage.evaluate(t => window.__vgInjectResult?.(t), 'Your question here');
  const btn = await owuiPage.$('#send-message-button:not([disabled])');
  if (btn) await btn.click();
  return { ok };
}
```

### Step 5 — Capture turn-by-turn results

After each turn completes (streaming=false), read the model response:

```js
async (page) => {
  const owuiPage = page.context().pages().find(p => p.url().includes('gpuserver1-sit'));
  return owuiPage.evaluate(() => {
    const texts = Array.from(document.querySelectorAll('[class*="prose"],[class*="markdown"]'))
      .map(e => e.innerText).filter(t => t.length > 20);
    return texts[texts.length - 1]?.slice(0, 3000);
  });
}
```

And check relay results in the OWUI chat for `[Ontosphere — N tools ✓]` lines.

### Step 6 — Iterate questions

If qwen3 goes off-topic, uses wrong format, or skips a concept:
- Adjust the question in `.playwright/turn-driver.js` (TURNS array)
- Add a **fallback nudge** (see `pizza-ontology.md` Fallback nudges section)
- Re-run from Step 2 with a fresh session (`demo-restart.sh` first)

Common failure modes:

| Failure | Cause | Fix |
|---------|-------|-----|
| Goes ahead of the question | Model is eager/comprehensive | Add "only do this one step" |
| Off-topic nodes (Person/Alice) | Hallucinated from training | Add "stay within the pizza domain" |
| Wrong format (triple-backtick) | Model forgot relay format | Nudge with `help({tool:"X"})` reminder |
| subClassOf reversed | Confuses direction | Nudge: "points from specific to general" |

### Step 7 — Promote validated questions to scripted spec

Once all T0–T9 questions produce the correct OWL concepts in order:
1. Copy the final TURNS array from `turn-driver.js` → `e2e/demo-openwebui-socratic.spec.ts`
2. Update caption text in `pizza-ontology.md` to match what qwen3 actually produced
3. Run `npm run demo:owui:video` to record the scripted version

The scripted spec replays the same questions against a live model session — it is not
pre-recorded; the model still runs live. The spec just drives the questions and waits for
tool-call completion at each turn.

---

## Video inventory

### Feature demos (paper-aligned)

- `feat-loading` — zero-install entry, URL param loading
- `feat-exploration` — TBox/ABox toggle, search, zoom, minimap
- `feat-authoring` — add class, draw edge, edit annotation, undo/redo
- `feat-clustering` — L2 fold/unfold, L3 Louvain community detection
- `feat-reasoning` — Konclude WASM, inferred triples, ABox inspection
- `feat-shacl` — SHACL validation, reasoning interplay
- `feat-ai-relay` — bookmarklet injection, AI tool calls via relay

### Workflow demos

- `iswc2026-comprehensive` — full 3-minute walkthrough of all features
- `foaf-social-network` — seed-driven, FOAF + employment + OWL-RL reasoning
- `scene-ontology` — seed-driven, film ontology on BFO/RO
- `pizza-tutorial` — seed-driven, Manchester Pizza OWL tutorial
- `pizza-tutorial-chat` — OWL pizza tutorial as AI tutor lesson, side-by-side chat
- `openwebui-socratic` — live OWUI session (separate recording pipeline)

---

## Lessons learned — building demos efficiently

### Prefer UI actions over MCP shortcuts for user-facing demos

MCP tool calls (`addNode`, `addTriple`) are fast but invisible — viewers can't follow what happened. Use action blocks (`click`, `fill`, `dragTo`) for operations the user would do manually. Reserve MCP tools for setup (switching modes, loading data) and bulk operations.

### Inspect custom components before writing selectors

Ontosphere replaces several Reactodia default components (entity editor, relation editor) with shadcn-based custom forms. Standard Reactodia selectors like `input[name="reactodia-text-property-input"]` won't work. Always check the actual component source before writing selectors — look for unique classes (`input.font-mono`), placeholder text, or role attributes.

### Use keyframes as your primary debug tool

Running the full video takes ~2 minutes. Running with `DEMO_KEYFRAMES=1` takes the same time but produces inspectable PNGs — much faster feedback. Iterate on selectors and timing using keyframes before doing a final video recording.

### Account for multi-step undo in authored entities

Creating an entity via the class tree creates TWO history entries: one for the entity creation (`batch.store()`) and one for the entity edit when Apply is clicked (`editor.changeEntity()`). To fully undo, click the undo button twice with a small gap (`wait: 500` between clicks).

### Unfold the class tree before clicking create buttons

The class tree create (`+`) buttons are only visible on items that appear in the tree dropdown. Type a search term (e.g. `Class`) into `input[placeholder*="earch"]` to unfold the hierarchy first, then target the create button.

### Use `waitFor` before interacting with dialogs

Dialogs animate in — clicking immediately after triggering them often misses. Add `waitFor: .reactodia-dialog` (or a specific element inside it) before `fill` or `click` actions targeting dialog contents.

### Relation type uses autocomplete, not a select dropdown

The custom relation editor renders an `EntityAutoComplete` input (`input[placeholder*="predicate"]`), not a `<select>`. To pick a relation type: `fill` the input with a partial match, `wait` for the dropdown, then `click` the `[role="option"]` that matches.
