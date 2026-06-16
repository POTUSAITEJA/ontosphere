/**
 * Feature Demo: MCP + AI Relay Bridge
 * Seed: docs/mcp-demo/seeds/feat-ai-relay.md (initial load only)
 *
 * Run:  npx playwright test --config=playwright.demo.config.ts e2e/demo-feat-ai-relay.spec.ts
 */

import { test, expect } from '@playwright/test';
import { DemoRunner } from './demo-runner.js';

const BASE_URL = process.env.DEMO_BASE_URL || 'http://localhost:8080';

test('feat-ai-relay: bookmarklet injection, AI tool calls, relay round trip', async ({ page }) => {
  test.setTimeout(120_000);

  const runner = new DemoRunner(page, BASE_URL);

  // Open stage — mock chat left, Ontosphere right
  await runner.openStage();
  await runner.captionPause('MCP + AI Relay Bridge — any AI chat controls Ontosphere', 3_500);

  // Load the ontology on the app side
  await runner.callToolOnStage('loadRdf', { url: `${BASE_URL}/reasoning-demo.ttl` });
  await runner.callToolOnStage('runLayout', { algorithm: 'dagre-tb', spacing: 200 });
  await runner.callToolOnStage('expandNode', {});
  await runner.callToolOnStage('runLayout', { algorithm: 'dagre-tb', spacing: 200 });
  await runner.callToolOnStage('fitCanvas', {});
  await runner.pauseMs(2_500);

  await runner.captionPause('Ontology loaded — connecting the relay bridge', 3_000);

  // Inject bookmarklet
  await runner.injectBookmarklet();
  await runner.captionPause('Relay connected — bookmarklet bridges AI chat to Ontosphere', 3_000);

  // Single tool call via mock chat
  await runner.caption('AI sends a tool call through the relay...');
  await runner.clickScenario('single');
  const singleResult = await runner.waitForResult(20_000);
  expect(singleResult).toContain('[Ontosphere');
  await runner.captionPause('Node added to the graph in real time', 3_500);

  // Full scenario — batch tool calls
  await runner.clearChat();
  await runner.pauseMs(1_000);
  await runner.caption('Full workflow — nodes, links, layout via AI tool calls...');
  await runner.clickScenario('full');
  const fullResult = await runner.waitForResult(30_000);
  expect(fullResult).toMatch(/\[Ontosphere/);
  await runner.pauseMs(2_500);

  await runner.captionPause('No server, no extension — just a bookmarklet click', 4_000);
  await runner.clearCaption();
  await runner.pauseMs(2_000);
});
