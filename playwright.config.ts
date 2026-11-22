import { defineConfig, devices } from '@playwright/test';

const PORT = 5297;
/** Set E2E_BASE_URL to test a site that is already being served, for example a built copy. */
const EXTERNAL = (process.env.E2E_BASE_URL ?? '').trim().replace(/\/+$/, '');
const ORIGIN = EXTERNAL || `http://127.0.0.1:${PORT}`;
/** E2E_GPU=1 renders on the real graphics card through ANGLE; the default is the SwiftShader software renderer. */
const GPU = process.env.E2E_GPU === '1';
const executablePath = process.env.E2E_CHROMIUM_PATH;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: [['list']],
  ...(EXTERNAL
    ? {}
    : {
        webServer: {
          command: `npx vite --port ${PORT} --strictPort`,
          url: `${ORIGIN}/index.html`,
          reuseExistingServer: true,
          timeout: 60_000,
        },
      }),
  use: {
    baseURL: ORIGIN,
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath,
      args: GPU ? ['--use-angle=d3d11', '--ignore-gpu-blocklist'] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } }, testIgnore: /phone\.spec\.ts$/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /phone\.spec\.ts$/ },
  ],
});
