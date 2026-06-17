/**
 * Feature Demo: OWL 2 DL Reasoning
 * Seed: docs/mcp-demo/seeds/feat-reasoning.md
 *
 * Run:  npx playwright test --config=playwright.demo.config.ts e2e/demo-feat-reasoning.spec.ts
 */

import { test } from '@playwright/test';
import { DemoRunner } from './demo-runner.js';

const BASE_URL = process.env.DEMO_BASE_URL || 'http://localhost:8080';
const SEED = 'docs/mcp-demo/seeds/feat-reasoning.md';

test('feat-reasoning: OWL 2 DL reasoning with cursor interaction', async ({ page }) => {
  test.setTimeout(300_000);

  const runner = new DemoRunner(page, BASE_URL);
  runner.setDemoName('feat-reasoning');
  const turns = DemoRunner.parseSeed(SEED);

  await runner.openApp();
  await runner.captionPause('OWL 2 DL Reasoning — Konclude runs entirely in-browser', 3_500);

  for (const turn of turns) {
    const isReasoningClick = turn.steps.some(
      s => s.kind === 'action' && s.type === 'click'
        && s.selector === 'button[title="Run reasoning"]'
    );

    if (isReasoningClick) {
      await runner.caption('Running OWL 2 DL reasoning (Konclude WASM)…');
    }

    await runner.runSeedTurn(turn, 600, { captionAfter: isReasoningClick });
    await runner.pauseMs(2_500);
  }

  await runner.captionPause(
    '15 OWL 2 DL patterns — full SROIQ(D) compliance via Konclude WASM',
    4_000,
  );
  await runner.clearCaption();
  await runner.pauseMs(2_000);
  runner.writeKeyframeSummary();
});
