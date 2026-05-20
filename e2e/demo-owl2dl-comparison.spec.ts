/**
 * OWL 2 DL vs OWL-RL comparison captures.
 *
 * Loads owl2dl-comparison.ttl, runs N3 OWL-RL reasoning, captures an SVG,
 * clears inferred triples, runs Konclude OWL 2 DL reasoning, captures a second SVG.
 *
 * Outputs:
 *   docs/reasoning-comparison/01-n3-owlrl.svg
 *   docs/reasoning-comparison/02-konclude-owl2dl.svg
 *
 * Run: npm run demo:video   (or npx playwright test e2e/demo-owl2dl-comparison.spec.ts)
 */

import { test } from '@playwright/test';
import { DemoRunner } from './demo-runner.js';
import fs from 'fs';
import path from 'path';

const BASE_URL = process.env.DEMO_BASE_URL || 'http://localhost:8080';
const OUT_DIR = path.resolve('docs/reasoning-comparison');

test('owl2dl-comparison: N3 OWL-RL vs Konclude OWL 2 DL reasoning', async ({ page }) => {
  const runner = new DemoRunner(page, BASE_URL);

  const callTool = async (name: string, args: Record<string, unknown> = {}): Promise<unknown> =>
    page.evaluate(
      async ([n, a]: [string, Record<string, unknown>]) => {
        const tool = (window as any).__mcpTools?.[n];
        if (!tool) throw new Error(`Tool not found: ${n}`);
        return tool(a);
      },
      [name, args] as [string, Record<string, unknown>],
    );

  // ?ontologies= (empty) suppresses default ontology auto-loading so reasoning
  // runs only over the demo fixture, keeping it fast and uncluttered.
  await page.goto(`${BASE_URL}/?ontologies=`);
  await page.waitForFunction(
    () => !!(window as any).__mcpTools && typeof (window as any).__mcpTools['addNode'] === 'function',
    { timeout: 20_000 },
  );
  await runner.pauseMs(500);

  // Load the comparison fixture
  await runner.caption('Loading OWL 2 DL vs OWL-RL comparison fixture…');
  await callTool('loadRdf', { url: `${BASE_URL}/owl2dl-comparison.ttl` });
  await runner.pauseMs(1_500);

  // TBox view + layout
  await callTool('setViewMode', { mode: 'tbox' });
  await runner.pauseMs(300);
  await callTool('runLayout', { algorithm: 'elk-layered', spacing: 160 });
  await runner.pauseMs(800);
  await callTool('fitCanvas', {});
  await runner.pauseMs(600);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ── N3 OWL-RL reasoning ──────────────────────────────────────────────────
  await runner.caption('Running N3 OWL-RL reasoning…');
  await callTool('runReasoning', { reasonerBackend: 'n3', clearBefore: true });
  await runner.pauseMs(800);

  await callTool('fitCanvas', {});
  await runner.pauseMs(600);

  await runner.caption('N3 OWL-RL — rdfs:subClassOf from declared hierarchy only');
  await runner.pauseMs(400);
  const n3Result = await callTool('exportImage', { format: 'svg' }) as { success: boolean; data?: { content: string } };
  if (n3Result?.success && n3Result.data?.content) {
    fs.writeFileSync(path.join(OUT_DIR, '01-n3-owlrl.svg'), n3Result.data.content);
    console.log('Wrote 01-n3-owlrl.svg');
  }
  await runner.pauseMs(800);

  // ── Clear inferred ───────────────────────────────────────────────────────
  await runner.caption('Clearing inferred triples…');
  await callTool('clearInferred', {});
  await runner.pauseMs(1_000);

  // ── Konclude OWL 2 DL reasoning ──────────────────────────────────────────
  await runner.caption('Running Konclude OWL 2 DL reasoning…');
  await callTool('runReasoning', { reasonerBackend: 'konclude' });
  await runner.pauseMs(1_000);

  await callTool('fitCanvas', {});
  await runner.pauseMs(600);

  await runner.caption('Konclude OWL 2 DL — full subclass hierarchy in amber');
  await runner.pauseMs(400);
  const koncludeResult = await callTool('exportImage', { format: 'svg' }) as { success: boolean; data?: { content: string } };
  if (koncludeResult?.success && koncludeResult.data?.content) {
    fs.writeFileSync(path.join(OUT_DIR, '02-konclude-owl2dl.svg'), koncludeResult.data.content);
    console.log('Wrote 02-konclude-owl2dl.svg');
  }
  await runner.pauseMs(1_500);

  await runner.clearCaption();
  await runner.pauseMs(500);
});
