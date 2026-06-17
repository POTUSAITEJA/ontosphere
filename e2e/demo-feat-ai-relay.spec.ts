/**
 * Feature Demo: MCP + AI Relay Bridge
 * Seed: docs/mcp-demo/seeds/feat-ai-relay.md (sidebar phase only)
 *
 * Phase 1 — sidebar: openApp, show relay widget, bookmarklet, copy prompt
 * Phase 2 — relay:   openStage, inject bookmarklet, starter prompt,
 *                     help() round-trip, FOAF profile creation via tool calls
 *
 * Run:  npx playwright test --config=playwright.demo.config.ts e2e/demo-feat-ai-relay.spec.ts
 * Keyframes: DEMO_KEYFRAMES=1 npx playwright test --config=playwright.demo.config.ts e2e/demo-feat-ai-relay.spec.ts
 */

import { test, expect } from '@playwright/test';
import { DemoRunner } from './demo-runner.js';

const BASE_URL = process.env.DEMO_BASE_URL || 'http://localhost:8080';
const SEED = 'docs/mcp-demo/seeds/feat-ai-relay.md';

const STARTER_PROMPT = [
  'You are connected to Ontosphere via a relay.',
  'A script in this tab intercepts your tool calls, runs them in Ontosphere,',
  'and injects results back as a user message.',
  '',
  'Output format — one JSON-RPC 2.0 call per line, backtick-wrapped:',
  '`{"jsonrpc":"2.0","id":<N>,"method":"tools/call","params":{"name":"<toolName>","arguments":{...}}}`',
  '',
  'Call help first to get full instructions and the tool list:',
  '`{"jsonrpc":"2.0","id":0,"method":"tools/call","params":{"name":"help","arguments":{}}}`',
].join('\n');

const AI_ACK = [
  "I've received Ontosphere's tool catalog.",
  'I can add nodes, create triples, run layout algorithms,',
  'trigger OWL 2 DL reasoning, validate SHACL shapes, and more.',
  '',
  'What would you like me to create?',
].join(' ');

const VCARD_REQUEST =
  'Create a FOAF profile for Tim Berners-Lee — add his full name, email address, and homepage URL.';

const VCARD_TOOLS = [
  "I'll create Tim Berners-Lee's FOAF profile on the canvas.",
  '',
  '`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"addNode","arguments":{"iri":"ex:TimBernersLee","label":"Tim Berners-Lee","typeIri":"foaf:Person"}}}`',
  '`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"addTriple","arguments":{"subjectIri":"ex:TimBernersLee","predicateIri":"foaf:name","objectLiteral":"Sir Timothy John Berners-Lee"}}}`',
  '`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"addTriple","arguments":{"subjectIri":"ex:TimBernersLee","predicateIri":"foaf:mbox","objectLiteral":"timbl@w3.org"}}}`',
  '`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"addTriple","arguments":{"subjectIri":"ex:TimBernersLee","predicateIri":"foaf:homepage","objectLiteral":"https://www.w3.org/People/Berners-Lee/"}}}`',
  '`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"expandNode","arguments":{}}}`',
  '`{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"runLayout","arguments":{"algorithm":"dagre-tb","spacing":200}}}`',
  '`{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"fitCanvas","arguments":{}}}`',
].join('\n');

test('feat-ai-relay: sidebar widget, bookmarklet, relay round trip', async ({ page }) => {
  test.setTimeout(180_000);

  const runner = new DemoRunner(page, BASE_URL);
  runner.setDemoName('feat-ai-relay');

  // ── Phase 1: Sidebar relay widget (full viewport) ──────────────────────
  const turns = DemoRunner.parseSeed(SEED);

  await runner.openApp();
  await runner.captionPause('MCP + AI Relay Bridge — any AI chat controls Ontosphere', 3_500);

  for (const turn of turns) {
    await runner.runSeedTurn(turn, 600);
    await runner.pauseMs(2_500);
  }

  await runner.captionPause('Next: connecting the relay from an AI chat', 2_500);

  // ── Phase 2: Relay round-trip (stage mode) ────────────────────────────
  await runner.openStage();
  await runner.setStreamSpeed(12);
  await runner.captionPause('Mock AI chat (left) — Ontosphere canvas (right)', 3_000);

  // Show UI mode compatibility — same relay works with any chat interface
  const chatFrame = runner.getChatFrame();
  await runner.caption('Works with any AI chat — FhGenie, Open WebUI, ChatGPT…');
  await runner.cursorTo(chatFrame.locator('#mode-fhgenie'));
  await runner.pauseMs(800);
  await runner.cursorTo(chatFrame.locator('#mode-openwebui'));
  await runner.pauseMs(800);
  await runner.cursorTo(chatFrame.locator('#mode-chatgpt'));
  await runner.pauseMs(800);
  await runner.clearCaption();
  await runner.pauseMs(500);

  // Connect relay
  await runner.injectBookmarklet();
  await runner.captionPause('Bookmarklet injected — relay bridge connected via BroadcastChannel', 3_000);
  await runner.captureKeyframe('relay-connected', {
    caption: 'Relay bridge active',
  });

  // Send starter prompt — contains help() which the relay executes automatically
  const chatInput = runner.getChatFrame().locator('#user-input');
  const sendBtn = runner.getChatFrame().locator('#send-btn');

  await runner.cursorTo(chatInput);
  await chatInput.fill(STARTER_PROMPT);
  await runner.pauseMs(600);
  await runner.cursorTo(sendBtn);
  await sendBtn.click();
  await runner.caption('Starter prompt sent — help() call executes through the relay');

  // Bookmarklet auto-dispatches help() from the starter prompt text
  const helpResult = await runner.waitForResult(20_000);
  expect(helpResult).toContain('[Ontosphere');
  await runner.captionPause(
    'Tool catalog returned — the AI now knows all available tools',
    3_500,
  );
  await runner.captureKeyframe('help-result', { caption: 'Tool catalog returned' });

  // AI acknowledges
  await runner.addChatMessage('ai', AI_ACK);
  await runner.waitForChatStream();
  await runner.pauseMs(2_000);
  await runner.captureKeyframe('ai-ready', { caption: 'AI ready' });

  // User asks for FOAF profile
  await runner.cursorTo(chatInput);
  await chatInput.fill(VCARD_REQUEST);
  await runner.pauseMs(800);
  await runner.cursorTo(sendBtn);
  await sendBtn.click();
  await runner.pauseMs(1_000);

  // AI creates FOAF profile via relay tool calls
  await runner.caption('AI sends tool calls through the relay...');
  await runner.addChatMessage('ai', VCARD_TOOLS);
  await runner.waitForChatStream();

  const vcardResult = await runner.waitForResult(30_000);
  expect(vcardResult).toContain('[Ontosphere');
  await runner.pauseMs(2_500);
  await runner.captionPause(
    'FOAF profile created — each tool call executed through the relay bridge',
    3_500,
  );
  await runner.captureKeyframe('vcard-complete', {
    caption: 'Tim Berners-Lee FOAF profile complete',
  });

  // Final message
  await runner.captionPause(
    'No server, no browser extension — just a bookmarklet click',
    4_000,
  );
  await runner.clearCaption();
  await runner.pauseMs(2_000);

  runner.writeKeyframeSummary();
});
