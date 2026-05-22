import { defineConfig, devices } from '@playwright/test';

// Relay bookmarklet tests open relay.html via window.open() from a script
// context (not a user gesture).  Without --disable-popup-blocking Chrome
// silently returns null from window.open(), stalling the whole chain.
const relayLaunchArgs = ['--disable-popup-blocking'];

export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/demo-*.spec.ts',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { args: relayLaunchArgs } } },
    { name: 'firefox',  use: { ...devices['Desktop Firefox'], launchOptions: { firefoxUserPrefs: { 'dom.disable_open_during_load': false } } } },
    { name: 'edge',     use: { ...devices['Desktop Edge'], channel: 'msedge', launchOptions: { args: relayLaunchArgs } } },
  ],
});
