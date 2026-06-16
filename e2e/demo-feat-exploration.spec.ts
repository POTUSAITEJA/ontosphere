/**
 * Feature Demo: Visual Exploration
 * Seed: docs/mcp-demo/seeds/feat-exploration.md
 *
 * Run:  npx playwright test --config=playwright.demo.config.ts e2e/demo-feat-exploration.spec.ts
 * Output: test-results/demo/
 */

import { test } from '@playwright/test';
import { DemoRunner } from './demo-runner.js';

const BASE_URL = process.env.DEMO_BASE_URL || 'http://localhost:8080';
const SEED = 'docs/mcp-demo/seeds/feat-exploration.md';

test('feat-exploration: TBox/ABox toggle, search, zoom, minimap', async ({ page }) => {
  test.setTimeout(120_000);

  const runner = new DemoRunner(page, BASE_URL);
  const turns = DemoRunner.parseSeed(SEED);

  await runner.openApp();
  await runner.captionPause('Visual Exploration — navigate ontologies with ease', 3_500);

  for (const turn of turns) {
    await runner.runSeedTurn(turn, 600);
    await runner.pauseMs(2_500);
  }

  await runner.captionPause('TBox / ABox views — search, zoom, focus, minimap', 4_000);
  await runner.clearCaption();
  await runner.pauseMs(2_000);
});
