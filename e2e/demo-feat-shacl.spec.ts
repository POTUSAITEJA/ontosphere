/**
 * Feature Demo: SHACL Validation
 * Seed: docs/mcp-demo/seeds/feat-shacl.md
 *
 * Loads dataset + SHACL shapes via MCP, demonstrates validation with
 * reasoning, sidebar navigation, error inspection, and settings overview.
 *
 * Run:  npx playwright test --config=playwright.demo.config.ts e2e/demo-feat-shacl.spec.ts
 * Keyframes: DEMO_KEYFRAMES=1 npx playwright test --config=playwright.demo.config.ts e2e/demo-feat-shacl.spec.ts
 */

import { test } from '@playwright/test';
import { DemoRunner } from './demo-runner.js';

const BASE_URL = process.env.DEMO_BASE_URL || 'http://localhost:8080';
const SEED = 'docs/mcp-demo/seeds/feat-shacl.md';

test('feat-shacl: SHACL validation, sidebar navigation, settings overview', async ({ page }) => {
  test.setTimeout(300_000);

  const runner = new DemoRunner(page, BASE_URL);
  runner.setDemoName('feat-shacl');
  const turns = DemoRunner.parseSeed(SEED);

  await runner.openApp();
  await runner.captionPause('SHACL Validation — constraint checking for ontologies', 3_500);

  for (const turn of turns) {
    const isReasoningClick = turn.steps.some(
      s => s.kind === 'action' && s.type === 'click' && s.selector?.includes('Run reasoning'),
    );

    if (isReasoningClick) {
      await runner.caption('Running OWL 2 DL reasoning with SHACL validation…');
    }

    await runner.runSeedTurn(turn, 600);

    if (isReasoningClick) {
      await runner.verifyState(
        async () => {
          const ready = page.locator('button.glass-btn--status-ok, button.glass-btn--status-error');
          return ready.first().isVisible();
        },
        'Reasoning indicator should show result status',
        15_000,
      );
    }

    if (turn.slug === 'settings-shacl-tab') {
      await runner.verifyState(
        async () => page.locator('button:has-text("Reasoning Demo")').isVisible(),
        'SHACL settings tab should show preset buttons',
        5_000,
      );
    }

    await runner.pauseMs(1_200);
  }

  await runner.captionPause('SHACL Validation — shapes, presets, and reasoning interplay', 4_000);
  await runner.clearCaption();
  await runner.pauseMs(2_000);

  runner.writeKeyframeSummary();
});
