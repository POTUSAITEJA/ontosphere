/**
 * Feature Demo: Visual Exploration
 * Seed: docs/mcp-demo/seeds/feat-exploration.md
 *
 * TBox/ABox toggle, class tree navigation, layout dialog,
 * re-apply layout, zoom, node expand — all via UI actions.
 *
 * Run:  npx playwright test --config=playwright.demo.config.ts e2e/demo-feat-exploration.spec.ts
 * Keyframes: DEMO_KEYFRAMES=1 npx playwright test --config=playwright.demo.config.ts e2e/demo-feat-exploration.spec.ts
 */

import { test } from '@playwright/test';
import { DemoRunner } from './demo-runner.js';

const BASE_URL = process.env.DEMO_BASE_URL || 'http://localhost:8080';
const SEED = 'docs/mcp-demo/seeds/feat-exploration.md';

test('feat-exploration: TBox/ABox toggle, class tree nav, layout, zoom, expand', async ({ page }) => {
  test.setTimeout(120_000);

  const runner = new DemoRunner(page, BASE_URL);
  runner.setDemoName('feat-exploration');
  const turns = DemoRunner.parseSeed(SEED);

  await runner.openApp();
  await runner.captionPause('Visual Exploration — navigate ontologies with ease', 3_500);

  for (const turn of turns) {
    await runner.runSeedTurn(turn, 600);

    if (turn.slug === 'tbox-view') {
      await runner.verifyState(
        () => page.locator('button[title="View ontology schema (T-Box)"].glass-btn--active').isVisible(),
        'TBox button should be active after click',
      );
    }

    if (turn.slug === 'navigate-manager') {
      await runner.verifyState(
        () => page.locator('[data-element-id]:has(:text-is("Manager"))').isVisible(),
        'Manager node visible on canvas',
      );
    }

    if (turn.slug === 'abox-view') {
      await runner.verifyState(
        () => page.locator('button[title="View instance data (A-Box)"].glass-btn--active').isVisible(),
        'ABox button should be active after click',
      );
    }

    await runner.pauseMs(2_500);
  }

  await runner.captionPause('TBox / ABox views — navigate, layout, zoom, expand', 4_000);
  await runner.clearCaption();
  await runner.pauseMs(2_000);

  runner.writeKeyframeSummary();
});
