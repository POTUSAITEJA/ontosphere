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

test('feat-reasoning: Konclude WASM, inferred triples, ABox inspection', async ({ page }) => {
  test.setTimeout(120_000);

  const runner = new DemoRunner(page, BASE_URL);
  const turns = DemoRunner.parseSeed(SEED);

  await runner.openApp();
  await runner.captionPause('OWL 2 DL Reasoning — Konclude runs entirely in-browser', 3_500);

  for (const turn of turns) {
    const isReasoningTurn = turn.toolCalls.some(c => c.name === 'runReasoning');
    if (isReasoningTurn) {
      await runner.caption('Running OWL 2 DL reasoning (Konclude WASM)...');
    }
    await runner.runSeedTurn(turn, 600, { captionAfter: isReasoningTurn });

    if (isReasoningTurn) {
      await runner.pauseMs(4_000);
    } else {
      await runner.pauseMs(2_500);
    }
  }

  await runner.captionPause('13 OWL 2 DL patterns — subclass, inverse, transitive, restriction, chain', 4_000);
  await runner.clearCaption();
  await runner.pauseMs(2_000);
});
