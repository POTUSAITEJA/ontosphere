/**
 * Generated from: docs/demo-scripts/iswc2026-comprehensive.md
 * Seed:           docs/mcp-demo/seeds/iswc2026-comprehensive.md
 *
 * Run:  npm run demo:video
 * Output: docs/demo-videos/iswc2026-comprehensive.webm / .mp4
 *
 * Requires: dev server running at http://localhost:8080
 *
 * This spec covers all 8 acts of the ISWC 2026 comprehensive demo:
 *   Act 1 — Zero-Install Entry (empty canvas, load ontology via URL param)
 *   Act 2 — Navigate and Explore (TBox/ABox toggle, search, zoom/pan)
 *   Act 3 — Author on the Canvas (add class, draw edge, edit annotation, undo/redo)
 *   Act 4 — Clustering and Fold Levels (L2 fold/unfold, L3 community detection)
 *   Act 5 — OWL 2 DL Reasoning (run reasoning, report, inspect inferred)
 *   Act 6 — SHACL Validation (load shapes, validate, violations)
 *   Act 7 — AI Relay Bridge (bookmarklet, relay tool call, round trip)
 *   Act 8 — Export and Close
 */

import { test } from '@playwright/test';
import { DemoRunner } from './demo-runner.js';

const BASE_URL = process.env.DEMO_BASE_URL || 'http://localhost:8080';
const SEED = 'docs/mcp-demo/seeds/iswc2026-comprehensive.md';

test('iswc2026-comprehensive', async ({ page }) => {
  const runner = new DemoRunner(page, BASE_URL);
  const turns = DemoRunner.parseSeed(SEED);

  // ── Act 1 — Zero-Install Entry (0:00 – 0:25) ─────────────────────────────

  // Scene 1 — Empty canvas
  await runner.openApp();
  await runner.captionPause('Ontosphere — Zero-Install Semantic Web Workbench', 2_500);

  // Scene 2 — Load ontology via URL parameter
  // Navigate with rdfUrl to trigger auto-load of the reasoning demo ontology
  await page.goto(`${BASE_URL}/?rdfUrl=${encodeURIComponent(`${BASE_URL}/reasoning-demo.ttl`)}`);
  await page.waitForFunction(
    () => !!(window as any).__mcpTools && typeof (window as any).__mcpTools['addNode'] === 'function',
    { timeout: 20_000 },
  );
  // Wait for the ontology to load and layout to settle
  await runner.pauseMs(3_000);

  // Fit the canvas so all loaded nodes are visible
  await page.evaluate(async () => {
    const fit = (window as any).__mcpTools?.['fitCanvas'];
    if (fit) await fit({});
  });
  await runner.pauseMs(500);

  await runner.captionPause('Loaded OWL 2 DL ontology — 13 classes, 11 properties, 8 individuals', 2_500);

  // ── Act 2 — Navigate and Explore (0:25 – 0:40) ────────────────────────────

  // Scene 3 — TBox / ABox toggle, search, viewport

  // Switch to ABox
  await page.evaluate(async () => {
    const tool = (window as any).__mcpTools?.['setViewMode'];
    if (tool) await tool({ mode: 'abox' });
  });
  await runner.pauseMs(1_500);

  // Switch back to TBox
  await page.evaluate(async () => {
    const tool = (window as any).__mcpTools?.['setViewMode'];
    if (tool) await tool({ mode: 'tbox' });
  });
  await runner.pauseMs(1_000);

  // Search for "Manager"
  const searchInput = page.locator('input[placeholder*="earch"]').first();
  await searchInput.click();
  await searchInput.fill('Manager');
  await searchInput.press('Enter');
  await runner.pauseMs(1_500);

  // Clear search
  await searchInput.fill('');
  await searchInput.press('Escape');
  await runner.pauseMs(500);

  // Zoom out with scroll wheel then pan
  await page.mouse.move(960, 540);
  await page.mouse.wheel(0, 300);
  await runner.pauseMs(600);
  await page.mouse.wheel(0, -150);
  await runner.pauseMs(600);

  await runner.captionPause('TBox / ABox views — search, zoom, pan, minimap', 2_000);

  // ── Act 3 — Author on the Canvas (0:40 – 1:10) ────────────────────────────

  // Scene 4 — Add a class node (via MCP tool — the seed turn handles this)
  // Parse and run the "Adding the new Intern class" seed turn
  const addInternTurn = turns.find(t => t.toolCalls.some(c => c.name === 'addNode'));
  if (addInternTurn) {
    await runner.runSeedTurn(addInternTurn, 400);
    await runner.pauseMs(1_500);
  }

  // Scene 5 — the subClassOf edge was already created by addTriple in the seed turn above
  await runner.captionPause('New class Intern — subClassOf edge connects to Employee', 2_000);

  // Scene 6 — Edit an annotation property inline (via MCP updateNode)
  const annotateTurn = turns.find(t => t.toolCalls.some(c => c.name === 'updateNode'));
  if (annotateTurn) {
    await runner.runSeedTurn(annotateTurn, 400);
    await runner.pauseMs(1_500);
  }

  // Scene 7 — Undo / Redo
  // Use keyboard shortcuts for undo/redo
  await page.keyboard.press('Control+z');
  await runner.pauseMs(1_000);
  await page.keyboard.press('Control+Shift+z');
  await runner.pauseMs(1_000);

  await runner.captionPause('Author directly on the canvas — add nodes, draw edges, edit properties, undo/redo', 2_000);

  // ── Act 4 — Clustering and Fold Levels (1:10 – 1:30) ──────────────────────

  // Scene 8 — Structural fold levels
  // Click L2 unfold button (level-up)
  const unfoldBtn = page.locator('[data-testid="level-up-btn"], button:has-text("Unfold"), [aria-label*="unfold" i], [aria-label*="level" i]').first();
  if (await unfoldBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await unfoldBtn.click();
    await runner.pauseMs(2_000);
    // Click fold L2 to re-collapse
    const foldBtn = page.locator('[data-testid="level-down-btn"], button:has-text("Fold"), [aria-label*="fold" i]').first();
    if (await foldBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await foldBtn.click();
      await runner.pauseMs(1_500);
    }
  }

  // Scene 9 — Community-detection clustering (Louvain)
  // Select Louvain from cluster algorithm selector
  const clusterSelect = page.locator('select[data-testid="cluster-algo"], select:near(button:has-text("Cluster"))').first();
  if (await clusterSelect.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await clusterSelect.selectOption({ label: 'Louvain' });
    await runner.pauseMs(500);
    // Click the Cluster button
    const clusterBtn = page.locator('button:has-text("Cluster"), [data-testid="cluster-btn"]').first();
    if (await clusterBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await clusterBtn.click();
      await runner.pauseMs(2_000);
    }
    // Click Expand All to flatten back
    const expandAllBtn = page.locator('button:has-text("Expand All"), button:has-text("Expand all"), [data-testid="expand-all-btn"]').first();
    if (await expandAllBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await expandAllBtn.click();
      await runner.pauseMs(1_500);
    }
  }

  await runner.captionPause('Hierarchical fold levels L1/L2/L3 — structural collapse and community detection', 2_000);

  // ── Act 5 — OWL 2 DL Reasoning (1:30 – 2:00) ─────────────────────────────

  // Scene 10 — Run reasoning (via seed turn)
  const reasoningTurn = turns.find(t => t.toolCalls.some(c => c.name === 'runReasoning'));
  if (reasoningTurn) {
    await runner.caption('Running OWL 2 DL reasoning (Konclude WASM)...');
    // Run reasoning — Konclude WASM can take a few seconds
    for (const call of reasoningTurn.toolCalls) {
      await page.evaluate(
        async ([name, args]: [string, Record<string, unknown>]) => {
          const tool = (window as any).__mcpTools?.[name];
          if (tool) await tool(args);
        },
        [call.name, call.arguments] as [string, Record<string, unknown>],
      );
      // Extra wait for reasoning to complete
      if (call.name === 'runReasoning') {
        await runner.pauseMs(5_000);
      } else {
        await runner.pauseMs(400);
      }
    }
    await runner.clearCaption();
  }

  await runner.captionPause('OWL 2 DL reasoning (Konclude WASM) — inferred triples in amber', 3_000);

  // Scene 11 — Reasoning report
  // Click the reasoning status indicator to open the report
  const reasoningStatus = page.locator('[data-testid="reasoning-status"], [aria-label*="eason" i]').first();
  if (await reasoningStatus.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await reasoningStatus.click();
    await runner.pauseMs(2_500);
    // Close the report by clicking elsewhere or pressing Escape
    await page.keyboard.press('Escape');
    await runner.pauseMs(500);
  }

  await runner.captionPause('Reasoning report — 13 OWL 2 DL construct patterns demonstrated', 2_000);

  // Scene 12 — Inspect an inferred individual (Dave in ABox)
  const daveInspectTurn = turns.find(t => t.toolCalls.some(c =>
    c.name === 'focusNode' && (c.arguments as any)?.iri?.includes('dave'),
  ));
  if (daveInspectTurn) {
    await runner.runSeedTurn(daveInspectTurn, 400);
    await runner.pauseMs(2_000);
  }

  await runner.captionPause('Dave — inferred Manager, LeadershipTeam, TeamLead from property domains', 2_500);

  // ── Act 6 — SHACL Validation (2:00 – 2:15) ────────────────────────────────

  // Scene 13 — Load shapes and validate
  // Switch back to TBox for SHACL context visibility
  await page.evaluate(async () => {
    const tool = (window as any).__mcpTools?.['setViewMode'];
    if (tool) await tool({ mode: 'tbox' });
  });
  await runner.pauseMs(1_000);

  const shaclTurn = turns.find(t => t.toolCalls.some(c => c.name === 'loadShacl'));
  if (shaclTurn) {
    await runner.caption('Loading SHACL shapes...');
    await runner.runSeedTurn(shaclTurn, 400);
    await runner.pauseMs(1_000);
    await runner.clearCaption();
  }

  const validateTurn = turns.find(t => t.toolCalls.some(c => c.name === 'validateGraph'));
  if (validateTurn) {
    await runner.caption('Validating graph against SHACL shapes...');
    await runner.runSeedTurn(validateTurn, 400);
    await runner.pauseMs(1_500);
    await runner.clearCaption();
  }

  await runner.captionPause('SHACL validation — load shapes, validate, inspect violations', 2_500);

  // ── Act 7 — AI Relay Bridge (2:15 – 2:45) ─────────────────────────────────

  // Scene 14–16 — Relay demo using the stage (side-by-side mock chat + Ontosphere)
  // Re-open the app in stage mode for the relay segment
  await runner.openStage();
  await runner.captionPause('AI Relay Bridge — connects any AI chat to Ontosphere', 2_000);

  // Inject bookmarklet into the mock chat
  await runner.injectBookmarklet();
  await runner.captionPause('Relay connected — bookmarklet bridges two browser tabs', 1_500);

  // Scene 15 — AI sends tool calls via relay
  // Use the 'single' scenario to demonstrate a simple addNode via relay
  await runner.caption('AI sends a tool call through the relay...');
  await runner.clickScenario('single');
  await runner.waitForResult(20_000);
  await runner.captionPause('AI tool call executed — node appears on Ontosphere canvas', 2_500);

  // Scene 16 — Show the full workflow scenario briefly
  await runner.clearChat();
  await runner.caption('Full workflow — nodes, links, layout via relay...');
  await runner.clickScenario('full');
  await runner.waitForResult(30_000);
  await runner.captionPause('Graph built by AI tool calls through the relay', 3_000);

  // ── Act 8 — Export and Close (2:45 – 3:00) ─────────────────────────────────

  // Scene 17 — Export as Turtle
  // Switch back to full-app mode for the export
  await runner.openApp();

  // Re-load the ontology since openApp starts fresh
  await page.evaluate(async () => {
    const loadRdf = (window as any).__mcpTools?.['loadRdf'];
    if (loadRdf) await loadRdf({ url: `${window.location.origin}/reasoning-demo.ttl` });
  });
  await runner.pauseMs(2_000);

  // Layout and fit
  await page.evaluate(async () => {
    const layout = (window as any).__mcpTools?.['runLayout'];
    if (layout) await layout({ algorithm: 'dagre-tb', spacing: 200 });
  });
  await runner.pauseMs(500);
  await page.evaluate(async () => {
    const fit = (window as any).__mcpTools?.['fitCanvas'];
    if (fit) await fit({});
  });
  await runner.pauseMs(500);

  // Trigger export via MCP tool
  await page.evaluate(async () => {
    const exportTool = (window as any).__mcpTools?.['exportGraph'];
    if (exportTool) await exportTool({ format: 'turtle' });
  });
  await runner.pauseMs(500);

  await runner.captionPause('Export Turtle / RDF-XML / JSON-LD — namespace management with live URI renaming', 2_500);

  // Scene 18 — Closing
  await runner.captionPause('Ontosphere — https://thhanke.github.io/ontosphere', 2_000);
  await runner.caption('DOI: 10.5281/zenodo.19605270 — Apache 2.0 — Zero install, runs entirely in-browser');
  await runner.pauseMs(4_000);
  await runner.clearCaption();
  await runner.pauseMs(1_500);
});
