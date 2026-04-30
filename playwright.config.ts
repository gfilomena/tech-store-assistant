import { defineConfig, devices } from "@playwright/test";

const PORT = Number.parseInt(process.env.E2E_PORT || "3000", 10);
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "e2e/specs",
  testMatch: process.env.E2E_RUN_LIVE === "1" ? /.*\.spec\.ts/ : /.*mock\.spec\.ts/,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Use system Chrome only when explicitly requested.
        ...(process.env.E2E_USE_SYSTEM_CHROME === "1" ? { channel: "chrome" } : {}),
      },
    },
  ],
  // In CI we start our own server. Locally we assume you already run `npm run dev`.
  ...(process.env.CI
    ? {
        webServer: {
          command: `E2E_MOCK_CHAT=1 NEXT_PUBLIC_E2E_SKIP_WARMUP=1 npx next dev -p ${PORT}`,
          url: baseURL,
          reuseExistingServer: false,
          timeout: 120_000,
        },
      }
    : {}),
});

