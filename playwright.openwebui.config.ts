import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'demo-openwebui-*.spec.ts',
  outputDir: 'test-results/demo',
  timeout: 600_000,
  fullyParallel: false,
  projects: [
    {
      name: 'openwebui-demo',
      use: {
        browserName: 'chromium',
        headless: false,
        viewport: { width: 960, height: 1080 },
        video: { mode: 'off' },
        baseURL: 'http://localhost:8080',
        ignoreHTTPSErrors: true,
        launchOptions: {
          // --disable-web-security: allows cross-origin evaluate() into the OWUI page.
          // --ignore-certificate-errors: OWUI uses a self-signed Fraunhofer internal CA.
          // --disable-popup-blocking: relay bookmarklet opens relay.html as window.open popup.
          args: [
            '--disable-web-security',
            '--ignore-certificate-errors',
            '--disable-popup-blocking',
          ],
        },
      },
    },
  ],
});
