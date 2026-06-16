/**
 * Feature Demo: Zero-Install + RDF Loading
 * Seed: docs/mcp-demo/seeds/feat-loading.md
 *
 * Run:  npx playwright test --config=playwright.demo.config.ts e2e/demo-feat-loading.spec.ts
 */

import { test } from '@playwright/test';
import { DemoRunner } from './demo-runner.js';

const BASE_URL = process.env.DEMO_BASE_URL || 'http://localhost:8080';
const SEED = 'docs/mcp-demo/seeds/feat-loading.md';

test('feat-loading: zero-install entry, URL param load, file upload', async ({ page }) => {
  test.setTimeout(120_000);

  const runner = new DemoRunner(page, BASE_URL);
  const turns = DemoRunner.parseSeed(SEED);

  // Scene 1 — Show empty canvas
  await runner.openApp();
  await runner.captionPause('Ontosphere — Zero-Install Semantic Web Workbench', 3_500);

  // Scene 2 — Load via URL parameter (the primary loading method)
  await page.goto(`${BASE_URL}/?rdfUrl=${encodeURIComponent(`${BASE_URL}/reasoning-demo.ttl`)}`);
  await page.waitForFunction(
    () => !!(window as any).__mcpTools && typeof (window as any).__mcpTools['addNode'] === 'function',
    { timeout: 20_000 },
  );
  await runner.pauseMs(3_000);

  await runner.captionPause('Load any ontology via URL parameter — no server needed', 3_500);

  // Run seed turns (expand, ABox toggle, TBox return)
  for (const turn of turns) {
    await runner.runSeedTurn(turn, 600);
    await runner.pauseMs(2_500);
  }

  // Scene 3 — Show the sidebar load button
  await runner.caption('Also load from file upload, SPARQL endpoint, or Linked Open Vocabularies');
  const loadBtn = page.locator('[aria-label="Load Ontology"]');
  if (await loadBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await loadBtn.click();
    await runner.pauseMs(3_000);
    await page.keyboard.press('Escape');
  }
  await runner.pauseMs(2_000);

  await runner.captionPause('One URL — zero install, runs entirely in the browser', 4_000);
  await runner.clearCaption();
  await runner.pauseMs(2_000);
});
