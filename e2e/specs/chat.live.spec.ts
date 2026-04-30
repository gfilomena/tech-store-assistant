import { test, expect } from "@playwright/test";

// Marked with “live” so `npm run e2e:live` can select it via -g.
test.describe("live chat smoke (live)", () => {
  test.skip(process.env.E2E_RUN_LIVE !== "1", "Set E2E_RUN_LIVE=1 to run live smoke tests.");

  test("can load UI and send a simple message", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app-bootOverlay")).toBeHidden({ timeout: 120_000 });

    const input = page.locator("input.tech-chat__input");
    await input.fill("How many products are in the catalog?");
    await page.locator("button.tech-chat__send").click();

    const assistantBodies = page.locator(".tech-chat__msg--assistant .tech-chat__msgBody");
    await expect(assistantBodies.last()).toBeVisible({ timeout: 120_000 });

    // Soft assertions: must respond and must contain guidance marker (or at least normal text).
    const text = await assistantBodies.last().innerText();
    expect(text.length).toBeGreaterThan(0);
  });
});

