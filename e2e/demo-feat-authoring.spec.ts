/**
 * Feature Demo: Canvas Authoring
 * Seed: docs/mcp-demo/seeds/feat-authoring.md
 *
 * Run:  npx playwright test --config=playwright.demo.config.ts e2e/demo-feat-authoring.spec.ts
 */

import { test } from '@playwright/test';
import { DemoRunner } from './demo-runner.js';

const BASE_URL = process.env.DEMO_BASE_URL || 'http://localhost:8080';
const SEED = 'docs/mcp-demo/seeds/feat-authoring.md';

test('feat-authoring: add class, draw edge, edit annotation, undo/redo', async ({ page }) => {
  test.setTimeout(120_000);

  const runner = new DemoRunner(page, BASE_URL);
  const turns = DemoRunner.parseSeed(SEED);

  await runner.openApp();
  await runner.captionPause('Canvas Authoring — build ontologies visually', 3_500);

  for (const turn of turns) {
    await runner.runSeedTurn(turn, 600);
    await runner.pauseMs(2_500);
  }

  await runner.captionPause('Add nodes, draw edges, edit properties — all on the canvas', 4_000);
  await runner.clearCaption();
  await runner.pauseMs(2_000);
});
