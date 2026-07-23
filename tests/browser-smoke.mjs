import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.SURVEY_URL || "http://127.0.0.1:4173";
const outputDir = process.env.SCREENSHOT_DIR || "test-results";
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1536, height: 1050 }, deviceScaleFactor: 1 });
const browserErrors = [];
page.on("pageerror", (error) => browserErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") browserErrors.push(message.text());
});

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-nav-section]");

  assert.equal(await page.locator("[data-nav-section]").count(), 9);
  assert.match(await page.title(), /Welcome & consent/);
  assert.equal(await page.locator("#response-status").textContent(), "New");

  await page.locator('[data-nav-section="5"]').click();
  await page.waitForSelector('[data-action="load-workflow-example"]');
  assert.equal(await page.locator(".workflow-stage[draggable]").count(), 3);

  await page.locator('[data-action="load-workflow-example"]').click();
  assert.equal(await page.locator(".workflow-stage[draggable]").count(), 7);
  assert.match(await page.locator(".workflow-preview").textContent(), /Research question/);
  assert.match(await page.locator(".workflow-preview").textContent(), /LOOP/);
  await page.screenshot({ path: `${outputDir}/desktop-workflow.png`, fullPage: true });

  await page.locator("#demo-fill-button").click();
  await page.locator('[data-nav-section="8"]').click();
  await page.locator("#submit-button").click();
  await page.locator("#submit-dialog[open]").waitFor({ timeout: 10_000 });

  assert.equal((await page.locator("#submitted-version").textContent()).trim(), "1");
  const recoveryKey = (await page.locator("#submitted-key").textContent()).trim();
  assert.match(recoveryKey, /^USW-(?:[A-Z2-9]{4}-){5}[A-Z2-9]{4}$/);

  await page.locator("#submit-dialog-done").click();
  await page.locator("#input-G4").fill("Edited fictional response for browser testing.");
  await page.waitForTimeout(900);
  assert.equal(await page.locator("#response-status").textContent(), "Editing");

  await page.locator("#submit-button").click();
  await page.locator("#submit-dialog[open]").waitFor({ timeout: 10_000 });
  assert.equal((await page.locator("#submitted-version").textContent()).trim(), "2");
  await page.locator("#submit-dialog-done").click();

  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator("#response-status").textContent(), "New");
  await page.locator("#resume-button").click();
  await page.locator("#recovery-input").fill(recoveryKey);
  await page.locator("#recovery-load-button").click();
  await page.locator("#recovery-dialog").waitFor({ state: "hidden" });
  assert.equal(await page.locator("#response-status").textContent(), "Submitted");
  assert.equal(await page.locator("#response-version").textContent(), "v2");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#mobile-nav-toggle").click();
  await page.locator('[data-nav-section="5"]').click();
  await page.waitForSelector(".workflow-builder");
  await page.screenshot({ path: `${outputDir}/mobile-workflow.png`, fullPage: true });

  assert.deepEqual(browserErrors, []);
  console.log(`Browser smoke test passed; recovery ${recoveryKey.slice(0, 8)}…; version 2 restored.`);
} finally {
  await browser.close();
}
