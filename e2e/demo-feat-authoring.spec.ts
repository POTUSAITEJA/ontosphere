/**
 * Feature Demo: Canvas Authoring
 * Seed: docs/mcp-demo/seeds/feat-authoring.md
 *
 * Full UI path — all node creation via class tree create button + entity dialog,
 * edge drawing via halo establish-link drag, undo/save via toolbar buttons.
 *
 * Run:  npx playwright test --config=playwright.demo.config.ts e2e/demo-feat-authoring.spec.ts
 * Keyframes: DEMO_KEYFRAMES=1 npx playwright test --config=playwright.demo.config.ts e2e/demo-feat-authoring.spec.ts
 */

import { test } from '@playwright/test';
import { DemoRunner } from './demo-runner.js';

const BASE_URL = process.env.DEMO_BASE_URL || 'http://localhost:8080';
const SEED = 'docs/mcp-demo/seeds/feat-authoring.md';

test('feat-authoring: create classes via UI, draw edge, undo, save', async ({ page }) => {
  test.setTimeout(120_000);

  const runner = new DemoRunner(page, BASE_URL);
  runner.setDemoName('feat-authoring');
  const turns = DemoRunner.parseSeed(SEED);

  await runner.openApp();
  await runner.captionPause('Canvas Authoring — build ontologies from scratch', 3_500);

  for (const turn of turns) {
    await runner.runSeedTurn(turn, 600);

    if (turn.slug === 'employee-added') {
      await runner.verifyState(
        async () => page.locator('[data-element-id]:has-text("Employee")').isVisible(),
        'Employee node visible on canvas',
      );
    }

    if (turn.slug === 'person-added') {
      await runner.verifyState(
        async () => page.locator('[data-element-id]:has-text("Person")').isVisible(),
        'Person node visible on canvas',
      );
    }

    if (turn.slug === 'third-node') {
      await runner.verifyState(
        async () => page.locator('[data-element-id]:has-text("Department")').isVisible(),
        'Department node visible on canvas',
      );
    }

    if (turn.slug === 'after-undo') {
      await runner.verifyState(
        async () => {
          const count = await page.locator('[data-element-id]:has-text("Department")').count();
          return count === 0;
        },
        'Department node gone after undo',
      );
    }

    await runner.pauseMs(2_500);
  }

  await runner.captionPause('Visual Authoring — create, connect, undo, save', 4_000);
  await runner.clearCaption();
  await runner.pauseMs(2_000);

  runner.writeKeyframeSummary();
});
