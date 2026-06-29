/**
 * OWL DL inconsistency detection end-to-end tests.
 *
 * Uses window.__mcpTools bridge (same pattern as reasoning-named-restriction.spec.ts).
 * Loads fixtures inline via fs.readFileSync so no URL assumptions are needed.
 *
 * ?ontologies= (empty) prevents QUDT auto-loading, keeping the store small so the
 * BlackBox MIPS algorithm runs on the fixture quads only (~26), not on 2000+ QUDT quads.
 *
 * Requires: npm run dev (http://localhost:8080) with SharedArrayBuffer enabled.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { gotoAndWaitForReady, callTool } from './e2e-helpers.js';

const BASE_URL = (process.env.VG_URL ?? 'http://localhost:8080') + '?ontologies=';

test('MCP runReasoning: inconsistent TTL → isConsistent=false, errors with frank nodeId, inferredTriples=0', async ({ page }) => {
  await gotoAndWaitForReady(page, BASE_URL, 'loadRdf');

  const turtle = fs.readFileSync(path.resolve('public/reasoning-demo-inconsistent.ttl'), 'utf-8');
  await callTool(page, 'loadRdf', { turtle }, BASE_URL);

  const result = await callTool(page, 'runReasoning', {}, BASE_URL) as any;
  console.log('[TEST] runReasoning result:', JSON.stringify(result?.data));

  expect(result?.success).toBe(true);
  expect(result?.data?.isConsistent).toBe(false);
  expect(result?.data?.errors?.length).toBeGreaterThan(0);
  expect(result?.data?.inferredTriples).toBe(0);

  const firstError = result?.data?.errors?.[0];
  expect(firstError?.severity).toBe('critical');
  expect(firstError?.nodeId).toMatch(/frank/i);
});

test('TopBar indicator: inconsistent TTL → button shows Inconsistent', async ({ page }) => {
  await gotoAndWaitForReady(page, BASE_URL, 'loadRdf');

  const turtle = fs.readFileSync(path.resolve('public/reasoning-demo-inconsistent.ttl'), 'utf-8');
  await callTool(page, 'loadRdf', { turtle }, BASE_URL);
  await callTool(page, 'runReasoning', {}, BASE_URL);

  const button = page.locator('button.glass-btn--status-error');
  await button.waitFor({ timeout: 30_000 });
  const text = await button.textContent();
  console.log('[TEST] TopBar button text:', text);
  expect(text).toMatch(/Inconsistent/i);
});

test('Modal content: Summary shows OWL DL card, Errors tab shows affected node', async ({ page }) => {
  // Konclude WASM explainInconsistency (blackbox MIPS) can be slow on CI.
  test.setTimeout(120_000);

  await gotoAndWaitForReady(page, BASE_URL, 'loadRdf');

  const turtle = fs.readFileSync(path.resolve('public/reasoning-demo-inconsistent.ttl'), 'utf-8');

  async function loadAndRun() {
    await callTool(page, 'loadRdf', { turtle }, BASE_URL);
    await callTool(page, 'runReasoning', {}, BASE_URL);
    const button = page.locator('button.glass-btn--status-error');
    await button.waitFor({ timeout: 30_000 });
    await button.click();
  }

  await loadAndRun();

  const dialog = page.locator('[role="dialog"]');
  try {
    await dialog.waitFor({ timeout: 60_000 });
  } catch {
    // COI service-worker may have reloaded the page after button click —
    // redo the data load + reasoning + click on the fresh page.
    await gotoAndWaitForReady(page, BASE_URL, 'loadRdf');
    await loadAndRun();
    await dialog.waitFor({ timeout: 60_000 });
  }

  // Summary tab should show the OWL DL inconsistency card
  await expect(dialog.getByText('OWL DL inconsistency detected')).toBeVisible();

  // Switch to Errors tab
  await dialog.getByRole('tab', { name: /errors/i }).click();

  // The Errors tab shows the affected node as a clickable local-name link
  // (the "Affected: Edge …" prefix is only used for edge-scoped errors).
  await expect(dialog.getByText(/frank/i).first()).toBeVisible();
});

test('Consistent sanity: reasoning-demo.ttl → isConsistent=true, errors=0, inferredTriples>0, TopBar Valid', async ({ page }) => {
  await gotoAndWaitForReady(page, BASE_URL, 'loadRdf');

  const turtle = fs.readFileSync(path.resolve('public/reasoning-demo.ttl'), 'utf-8');
  await callTool(page, 'loadRdf', { turtle }, BASE_URL);

  const result = await callTool(page, 'runReasoning', {}, BASE_URL) as any;
  console.log('[TEST] consistent runReasoning result:', JSON.stringify(result?.data));

  expect(result?.success).toBe(true);
  expect(result?.data?.isConsistent).toBe(true);
  expect(result?.data?.errors?.length).toBe(0);
  expect(result?.data?.inferredTriples).toBeGreaterThan(0);

  const okButton = page.locator('button.glass-btn--status-ok');
  await okButton.waitFor({ timeout: 30_000 });
  const text = await okButton.textContent();
  // The OK status button reads "Consistent" (optionally with a SHACL warnings
  // count), mirroring the "Inconsistent" label asserted in the error-status test.
  expect(text).toMatch(/Consistent/i);
});
