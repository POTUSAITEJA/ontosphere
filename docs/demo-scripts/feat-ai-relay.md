# Screenplay: MCP + AI Relay Bridge

A focused 90-second demo showing how the relay bookmarklet bridges any AI chat
to Ontosphere. Uses stage mode (mock chat + Ontosphere side by side).

---

## Scene 1 — Stage View (10 s)

Open demo-stage.html showing mock chat (left pane) and Ontosphere (right pane).

Caption "MCP + AI Relay Bridge — any AI chat controls Ontosphere". Pause 2.5 s.

## Scene 2 — Load Ontology (10 s)

Load `reasoning-demo.ttl` on the app side via `callToolOnStage`. Layout and expand.

Caption "Ontology loaded — connecting the relay bridge". Pause 2 s.

## Scene 3 — Bookmarklet Injection (15 s)

Inject the relay bookmarklet into the mock chat iframe. The relay popup appears,
confirming the bridge is live.

Caption "Relay connected — bookmarklet bridges AI chat to Ontosphere". Pause 2 s.

## Scene 4 — Single Tool Call (15 s)

Click the "single" scenario in the mock chat. The AI sends an `addNode` tool call
through the relay. The result appears in the chat and the node materialises on
the Ontosphere canvas.

Caption "AI sends a tool call through the relay..."
After result: "Node added to the graph in real time". Pause 2.5 s.

## Scene 5 — Full Workflow (20 s)

Clear the chat. Click the "full" scenario. The AI sends a batch of tool calls —
add nodes, add links, run layout, export.

The graph evolves in real time as each tool call executes.

Caption "Full workflow — nodes, links, layout via AI tool calls...".
After result: Pause.

## Scene 6 — Closing (10 s)

Caption "No server, no extension — just a bookmarklet click". Pause 3 s.

---

## Timing Summary

| Scene | Duration | Cumulative |
|-------|----------|------------|
| 1. Stage view | 10 s | 0:10 |
| 2. Load ontology | 10 s | 0:20 |
| 3. Bookmarklet | 15 s | 0:35 |
| 4. Single call | 15 s | 0:50 |
| 5. Full workflow | 20 s | 1:10 |
| 6. Closing | 10 s | 1:20 |

**Total: ~80 seconds** (within 90 s target)

---

## Notes

- This demo uses `openStage()` which loads `demo-stage.html` with two iframes.
  The spec uses DemoRunner's stage-mode helpers: `callToolOnStage()`,
  `injectBookmarklet()`, `clickScenario()`, `waitForResult()`.
- No seed-driven `runSeedTurn()` loop — the spec orchestrates directly because
  stage mode routes tool calls through the app iframe, not the main page.
- The mock chat scenarios ("single", "full") simulate real AI behaviour by sending
  JSON-RPC 2.0 tool calls that the relay intercepts and routes to Ontosphere.
