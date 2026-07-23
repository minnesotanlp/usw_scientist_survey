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

  assert.equal(await page.locator("[data-nav-section]").count(), 10);
  assert.match(await page.title(), /Welcome & consent/);
  assert.equal(await page.locator("#response-status").textContent(), "New");

  await page.locator('[data-nav-section="5"]').click();
  await page.waitForSelector('[data-action="load-workflow-example"]');
  assert.equal(await page.locator(".workflow-node").count(), 3);
  assert.equal(await page.locator(".workflow-edge.flow").count(), 2);

  await page.locator('[data-action="load-workflow-example"]').click();
  assert.equal(await page.locator(".workflow-node").count(), 7);
  assert.equal(await page.locator(".workflow-edge").count(), 7);
  assert.match(await page.locator(".workflow-preview").textContent(), /Research question/);
  assert.match(await page.locator(".workflow-preview").textContent(), /↺/);

  await page.locator('[data-action="add-stage"]').click();
  assert.equal(await page.locator(".workflow-node").count(), 8);
  await page.locator(".workflow-node").last().locator(".workflow-node-name").fill("Publication");

  await page.locator('[data-workflow-tool="flow"]').click();
  await page.locator(".workflow-node").nth(6).locator(".workflow-port-out").click();
  await page.locator(".workflow-node").nth(7).locator(".workflow-port-in").click();
  assert.equal(await page.locator(".workflow-edge.flow").count(), 7);

  await page.locator('[data-workflow-tool="branch"]').click();
  await page.locator(".workflow-node").nth(2).locator(".workflow-port-out").click();
  await page.locator(".workflow-node").nth(4).locator(".workflow-port-in").click();
  assert.equal(await page.locator(".workflow-edge.branch").count(), 1);

  await page.locator('[data-workflow-tool="loop"]').click();
  await page.locator(".workflow-node").last().locator(".workflow-port-out").click();
  await page.locator(".workflow-node").last().locator(".workflow-port-in").click();
  assert.equal(await page.locator(".workflow-edge.loop").count(), 2);

  const dragHandle = page.locator(".workflow-node").last().locator(".workflow-drag-handle");
  const beforeDrag = await page.locator(".workflow-node").last().getAttribute("style");
  const dragBox = await dragHandle.boundingBox();
  assert.ok(dragBox);
  await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(dragBox.x + 60, dragBox.y - 10, { steps: 6 });
  await page.mouse.up();
  assert.notEqual(await page.locator(".workflow-node").last().getAttribute("style"), beforeDrag);
  await page.locator(".workflow-builder").screenshot({ path: `${outputDir}/workflow-scratchpad.png` });
  await page.screenshot({ path: `${outputDir}/desktop-workflow.png`, fullPage: true });

  await page.locator("#demo-fill-button").click();
  await page.locator('[data-nav-section="9"]').click();
  assert.equal((await page.locator("#section-title").textContent()).trim(), "Participant feedback");
  await page.locator('[data-question-card="H1"]').waitFor();
  await page.locator('[data-question-card="H5"]').waitFor();
  await page.screenshot({ path: `${outputDir}/feedback-page.png`, fullPage: true });
  await page.locator("#submit-button").click();
  await page.locator("#submit-dialog[open]").waitFor({ timeout: 10_000 });

  assert.equal((await page.locator("#submitted-version").textContent()).trim(), "1");
  const recoveryKey = (await page.locator("#submitted-key").textContent()).trim();
  assert.match(recoveryKey, /^USW-(?:[A-Z2-9]{4}-){5}[A-Z2-9]{4}$/);

  await page.locator("#submit-dialog-done").click();
  await page.locator("#input-H10").fill("Edited fictional feedback for browser testing.");
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
