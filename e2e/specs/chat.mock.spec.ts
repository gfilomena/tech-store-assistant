import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

type Scenario = {
  id: string;
  prompt: string;
  expect: {
    answerIncludes: string[];
    intent: "pre_purchase" | "post_purchase" | "unknown";
    stage: "identify_device" | "clarify_problem" | "answer";
  };
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const scenariosPath = join(__dirname, "..", "fixtures", "scenarios.json");
const scenarios = (JSON.parse(readFileSync(scenariosPath, "utf-8")) as { scenarios: Scenario[] })
  .scenarios;

function parseGuidanceFromVisibleAnswer(text: string) {
  const marker = "[[[GUIDANCE_JSON]]]";
  const idx = text.indexOf(marker);
  if (idx === -1) return null;
  const after = text.slice(idx + marker.length).trim();
  const json = after.replace(/^\s*\n/, "").trim();
  try {
    return JSON.parse(json) as any;
  } catch {
    return null;
  }
}

test.describe("chat UI (mock mode)", () => {
  test.beforeEach(async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    (page as any).__consoleErrors = consoleErrors;
  });

  test("boot overlay blocks until ready", async ({ page }) => {
    await page.goto("/?e2e=1");
    const overlay = page.locator(".app-bootOverlay");
    await expect(overlay).toBeVisible();
    await expect(overlay).toBeHidden({ timeout: 30_000 });

    const input = page.locator("input.tech-chat__input");
    await expect(input).toBeVisible();
  });

  for (const s of scenarios) {
    test(`scenario: ${s.id}`, async ({ page }) => {
      await page.goto("/?e2e=1");
      await expect(page.locator(".app-bootOverlay")).toBeHidden({ timeout: 30_000 });

      const input = page.locator("input.tech-chat__input");
      await input.fill(s.prompt);
      await page.locator("button.tech-chat__send").click();

      // Wait for an assistant message containing guidance marker.
      const assistantBodies = page.locator(".tech-chat__msg--assistant .tech-chat__msgBody");
      await expect(assistantBodies.last()).toContainText("[[[GUIDANCE_JSON]]]", { timeout: 15_000 });

      const text = await assistantBodies.last().innerText();
      for (const inc of s.expect.answerIncludes) {
        await expect(assistantBodies.last()).toContainText(inc, { timeout: 1_000 });
      }

      const guidance = parseGuidanceFromVisibleAnswer(text);
      expect(guidance, "guidance json should parse").toBeTruthy();
      expect(guidance.intent).toBe(s.expect.intent);
      expect(guidance.stage).toBe(s.expect.stage);
      expect(Array.isArray(guidance.clarifying_questions)).toBe(true);
      expect(Array.isArray(guidance.next_suggested_questions)).toBe(true);

      const errors: string[] = (page as any).__consoleErrors ?? [];
      expect(errors, `console errors:\n${errors.join("\n")}`).toEqual([]);
    });
  }
});

