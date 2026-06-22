import { defineConfig, devices } from '@playwright/test';

// Relay bookmarklet tests open relay.html via window.open() from a script
// context (not a user gesture).  Without --disable-popup-blocking Chrome
// silently returns null from window.open(), stalling the whole chain.
const relayLaunchArgs = ['--disable-popup-blocking'];

const isCI = !!process.env.CI;

// Specs that require an environment public CI cannot provide: the relay
// "real"/"fhgenie" specs target an internal host (docker-dev.iwm.fraunhofer.de)
// and the OpenWebUI spec targets a separate dev server on :5173. They have their
// own dedicated entry points (e.g. `npm run test:e2e:real`) and are skipped only
// in CI so those local/manual runs still pick them up.
const ciOnlyIgnore = isCI
  ? [
      '**/relay-bookmarklet.real.spec.ts',
      '**/relay-bookmarklet.fhgenie.spec.ts',
      '**/relay-bookmarklet.openwebui.spec.ts',
    ]
  : [];

// CI installs only the Chromium browser (see .github/workflows/ci.yml). Run the
// full cross-browser matrix locally, but restrict CI to Chromium.
const chromium = {
  name: 'chromium',
  use: { ...devices['Desktop Chrome'], launchOptions: { args: relayLaunchArgs } },
};
const projects = isCI
  ? [chromium]
  : [
      chromium,
      { name: 'firefox', use: { ...devices['Desktop Firefox'], launchOptions: { firefoxUserPrefs: { 'dom.disable_open_during_load': false } } } },
      { name: 'edge', use: { ...devices['Desktop Edge'], channel: 'msedge', launchOptions: { args: relayLaunchArgs } } },
    ];

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/demo-*.spec.ts', ...ciOnlyIgnore],
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    headless: true,
    baseURL: 'http://localhost:8080',
  },
  // Serve the app for the specs that navigate to http://localhost:8080/. The dev
  // server runs on :8080 (base `/`) and emits the COOP/COEP headers the Konclude
  // WASM reasoner needs (see vite.config.ts coiHeadersPlugin → configureServer).
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:8080/',
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
  projects,
});
