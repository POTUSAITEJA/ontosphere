/**
 * Feature Demo: SHACL Validation
 * Seed: docs/mcp-demo/seeds/feat-shacl.md
 *
 * Run:  npx playwright test --config=playwright.demo.config.ts e2e/demo-feat-shacl.spec.ts
 */

import { test } from '@playwright/test';
import { DemoRunner } from './demo-runner.js';

const BASE_URL = process.env.DEMO_BASE_URL || 'http://localhost:8080';
const SEED = 'docs/mcp-demo/seeds/feat-shacl.md';

test('feat-shacl: load shapes, validate, violations, reasoning interplay', async ({ page }) => {
  test.setTimeout(120_000);

  const runner = new DemoRunner(page, BASE_URL);
  const turns = DemoRunner.parseSeed(SEED);

  await runner.openApp();
  await runner.captionPause('SHACL Validation — constraint checking for ontologies', 3_500);

  for (const turn of turns) {
    const isReasoningTurn = turn.toolCalls.some(c => c.name === 'runReasoning');
    const isValidationTurn = turn.toolCalls.some(c => c.name === 'validateGraph');

    if (isReasoningTurn) {
      await runner.caption('Running reasoning to add inferred types...');
    } else if (isValidationTurn && !turn.toolCalls.some(c => c.name === 'loadShaclFromUrl')) {
      await runner.caption('Validating graph against SHACL shapes...');
    }

    await runner.runSeedTurn(turn, 600, { captionAfter: isReasoningTurn });

    if (isReasoningTurn) {
      await runner.pauseMs(4_000);
    } else if (isValidationTurn) {
      await runner.pauseMs(3_000);
    } else {
      await runner.pauseMs(2_500);
    }
  }

  await runner.captionPause('SHACL + Reasoning — validation results evolve with inferred knowledge', 4_000);
  await runner.clearCaption();
  await runner.pauseMs(2_000);
});
