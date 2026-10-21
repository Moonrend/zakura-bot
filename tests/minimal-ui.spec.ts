import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`minimal chat and immediate settings at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Try demo", exact: true }).click();
    const composer = page.getByRole("textbox", { name: "Message Zakura", exact: true });
    await expect(composer).toBeVisible();
    await composer.fill("hello");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.locator('[data-testid^="message-asst_"]').first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`chat-${width}.png`) });
    await page.getByRole("button", { name: "Bot details", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Info", exact: true })).toBeVisible();
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save settings", exact: true })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Auth token", exact: true })).toHaveCount(0);
    await page.getByRole("radio", { name: "Theme: Light", exact: true }).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("zakura-bot.settings.v1") ?? "{}").theme)).toBe("light");
    await page.reload();
    await expect(page.getByRole("radio", { name: "Theme: Light", exact: true })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("radio", { name: "Theme: Dark", exact: true }).click();
    await expect(page.getByRole("radio", { name: "Theme: Dark", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`settings-${width}.png`) });
    expect(errors).toEqual([]);
  });
}
