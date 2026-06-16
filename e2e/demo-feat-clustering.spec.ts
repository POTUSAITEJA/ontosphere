/**
 * Feature Demo: Hierarchical Clustering
 * Seed: docs/mcp-demo/seeds/feat-clustering.md
 *
 * Run:  npx playwright test --config=playwright.demo.config.ts e2e/demo-feat-clustering.spec.ts
 */

import { test } from '@playwright/test';
import { DemoRunner } from './demo-runner.js';

const BASE_URL = process.env.DEMO_BASE_URL || 'http://localhost:8080';
const SEED = 'docs/mcp-demo/seeds/feat-clustering.md';

test('feat-clustering: L2 fold/unfold, L3 Louvain, expand', async ({ page }) => {
  test.setTimeout(120_000);

  const runner = new DemoRunner(page, BASE_URL);
  const turns = DemoRunner.parseSeed(SEED);

  await runner.openApp();
  await runner.captionPause('Hierarchical Clustering — fold levels L1, L2, L3', 3_500);

  // Run seed turns (load + zoom)
  for (const turn of turns) {
    await runner.runSeedTurn(turn, 600);
    await runner.pauseMs(2_500);
  }

  // L2 fold/unfold via UI buttons
  const unfoldBtn = page.locator('[data-testid="level-up-btn"], button:has-text("Unfold"), [aria-label*="unfold" i], [aria-label*="level" i]').first();
  if (await unfoldBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await runner.caption('L2 Unfold — expand collapsed subclass chains');
    await unfoldBtn.click();
    await runner.pauseMs(2_500);

    await page.evaluate(async () => {
      const fit = (window as any).__mcpTools?.['fitCanvas'];
      if (fit) await fit({});
    });
    await runner.pauseMs(1_000);

    // Re-fold
    const foldBtn = page.locator('[data-testid="level-down-btn"], button:has-text("Fold"), [aria-label*="fold" i]').first();
    if (await foldBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await runner.caption('L2 Fold — re-collapse to summary form');
      await foldBtn.click();
      await runner.pauseMs(2_000);
    }
  }

  // L3 Louvain community detection
  const clusterSelect = page.locator('select[data-testid="cluster-algo"], select:near(button:has-text("Cluster"))').first();
  if (await clusterSelect.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await clusterSelect.selectOption({ label: 'Louvain' });
    await runner.pauseMs(500);

    const clusterBtn = page.locator('button:has-text("Cluster"), [data-testid="cluster-btn"]').first();
    if (await clusterBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await runner.caption('L3 Louvain — community detection groups related entities');
      await clusterBtn.click();
      await runner.pauseMs(2_500);
    }

    // Expand all
    const expandAllBtn = page.locator('button:has-text("Expand All"), button:has-text("Expand all"), [data-testid="expand-all-btn"]').first();
    if (await expandAllBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await runner.caption('Expand All — flatten back to individual nodes');
      await expandAllBtn.click();
      await runner.pauseMs(2_000);
    }
  }

  await page.evaluate(async () => {
    const fit = (window as any).__mcpTools?.['fitCanvas'];
    if (fit) await fit({});
  });

  await runner.captionPause('Three fold levels — from annotations to community detection', 4_000);
  await runner.clearCaption();
  await runner.pauseMs(2_000);
});
