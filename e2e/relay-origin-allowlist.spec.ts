/**
 * SECURITY e2e — relay.html opener-origin allowlist.
 *
 * Proves the P0 fix: the relay popup (public/relay.html) only accepts `vg-call`
 * messages from allowlisted origins and never forwards an untrusted origin's call
 * onto the BroadcastChannel (which executes the full MCP toolset — incl. queryGraph
 * INSERT/DELETE — in the Ontosphere tab).
 *
 * This test is fully self-contained: it serves public/relay.html from a local
 * HTTP server, loads it in a real browser, and exercises the ACTUAL shipped code:
 *
 *   1. isOriginAllowed(origin) — the real function from relay.html — is evaluated
 *      against a matrix of allowed / disallowed origins.
 *   2. The REAL installed 'message' handler is driven with synthetic MessageEvents
 *      whose `origin` we spoof via the MessageEvent constructor. We listen on the
 *      same BroadcastChannel relay.html forwards to and assert that an evil origin's
 *      vg-call is NEVER forwarded while an allowlisted one is.
 *   3. The source is grepped to confirm no `'*'` postMessage target remains.
 *
 * No external dev server / OWUI required.
 *
 * Run:
 *   npx playwright test e2e/relay-origin-allowlist.spec.ts
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import http from 'http';
import { fileURLToPath } from 'url';
import path from 'path';
import type { AddressInfo } from 'net';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELAY_PATH = path.resolve(__dirname, '../public/relay.html');
const RELAY_HTML = fs.readFileSync(RELAY_PATH, 'utf8');

// A static server scoped to the relay file. The served origin becomes the page's
// `window.location.origin`, which the same-origin branch of isOriginAllowed trusts.
function startServer(): Promise<{ origin: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(RELAY_HTML);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

test.describe('relay.html — opener-origin allowlist (security)', () => {
  let origin: string;
  let close: () => Promise<void>;

  test.beforeAll(async () => {
    ({ origin, close } = await startServer());
  });

  test.afterAll(async () => {
    await close();
  });

  test('isOriginAllowed: allowlisted AI platforms accepted, evil origins rejected, "*" never trusted', async ({ page }) => {
    await page.goto(`${origin}/relay.html`);
    await page.waitForFunction(() => typeof (window as any).isOriginAllowed === 'function');

    const result = await page.evaluate((selfOrigin) => {
      const f = (window as any).isOriginAllowed as (o: string) => boolean;
      return {
        // ── Allowed ──
        chatgpt:       f('https://chatgpt.com'),
        chatOpenai:    f('https://chat.openai.com'),
        claude:        f('https://claude.ai'),
        gemini:        f('https://gemini.google.com'),
        owui:          f('https://gpuserver1-sit.iwm.fraunhofer.de'),
        dockerDev:     f('http://docker-dev.iwm.fraunhofer.de:8080'),
        sameOrigin:    f(selfOrigin),
        localhost:     f('http://localhost:5173'),
        loopback:      f('http://127.0.0.1:8080'),
        // ── Rejected ──
        evil:          f('https://evil.example'),
        attacker:      f('https://attacker.com'),
        star:          f('*'),
        nullOrigin:    f('null'),
        empty:         f(''),
        // a look-alike that must NOT match a substring of an allowed host
        lookalike:     f('https://claude.ai.evil.example'),
        subdomainSpoof:f('https://chatgpt.com.attacker.net'),
      };
    }, origin);

    // Allowed
    expect(result.chatgpt).toBe(true);
    expect(result.chatOpenai).toBe(true);
    expect(result.claude).toBe(true);
    expect(result.gemini).toBe(true);
    expect(result.owui).toBe(true);
    expect(result.dockerDev).toBe(true);
    expect(result.sameOrigin).toBe(true);
    expect(result.localhost).toBe(true);
    expect(result.loopback).toBe(true);

    // Rejected
    expect(result.evil).toBe(false);
    expect(result.attacker).toBe(false);
    expect(result.star).toBe(false);
    expect(result.nullOrigin).toBe(false);
    expect(result.empty).toBe(false);
    expect(result.lookalike).toBe(false);
    expect(result.subdomainSpoof).toBe(false);
  });

  test('live message handler: evil-origin vg-call is NOT forwarded onto the BroadcastChannel', async ({ page }) => {
    await page.goto(`${origin}/relay.html`);
    await page.waitForFunction(() => typeof (window as any).isOriginAllowed === 'function');

    // Drive the REAL installed 'message' listener with spoofed-origin events and
    // observe what (if anything) reaches the BroadcastChannel relay.html forwards to.
    const forwarded = await page.evaluate(async () => {
      const CHANNEL_NAME = 'ontosphere-relay-v1';
      const seen: Array<{ type: string; tool?: string }> = [];
      const bc = new BroadcastChannel(CHANNEL_NAME);
      bc.onmessage = (e: MessageEvent) => {
        const d = e.data;
        if (d && d.type === 'vg-call') seen.push({ type: d.type, tool: d.tool });
      };

      function fire(originStr: string, tool: string) {
        // MessageEvent lets us spoof `origin`, so this drives relay.html's real
        // window 'message' handler exactly as a cross-origin postMessage would.
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'vg-call', tool, requestId: 'rq-test', params: {} },
          origin: originStr,
        }));
      }

      // EVIL origin — must be ignored (NOT forwarded).
      fire('https://evil.example', 'queryGraph');
      // ALLOWLISTED origin — must be forwarded.
      fire('https://claude.ai', 'addNode');

      // Allow BroadcastChannel delivery to flush.
      await new Promise((r) => setTimeout(r, 300));
      bc.close();
      return seen;
    });

    // Exactly one forwarded call, and it is the allowlisted one — never the evil one.
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].tool).toBe('addNode');
    expect(forwarded.some((m) => m.tool === 'queryGraph')).toBe(false);
  });

  test('source contains no "*" postMessage target fallback', () => {
    // Every window.opener.postMessage(...) must target a validated origin, never '*'.
    const lines = RELAY_HTML.split('\n');
    const offending = lines.filter((l) => {
      const code = l.replace(/\/\/.*$/, ''); // strip line comments
      return /postMessage\s*\([^)]*['"]\*['"]/.test(code);
    });
    expect(offending).toEqual([]);
    // Sanity: the allowlist constant exists.
    expect(RELAY_HTML).toContain('TRUSTED_ORIGINS');
    expect(RELAY_HTML).toContain('function isOriginAllowed');
  });
});
