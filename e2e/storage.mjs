// Storage limits end to end, against a server started with a tiny STORAGE_LIMIT_GB (~10.5 MB).
import { chromium, devices } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const BASE = process.env.BASE_URL;
const fx = (f) => path.join(import.meta.dirname, "fixtures", f);
const SHOTS = process.argv[2];
const step = (s) => console.log("•", s);
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#pw", process.env.APP_PASSWORD);
  await page.click("button:has-text('Sign in')");
  await page.waitForURL(`${BASE}/`);

  step("sidebar meter starts near empty, no banner");
  await page.locator("aside a[href='/media#storage']").waitFor();
  if (await page.getByText(/Storage \d+% full/).count()) throw new Error("banner shown while empty");

  step("two videos push usage past 80%: banner, meter warning, Media tab marked");
  await page.goto(`${BASE}/media`);
  await page.setInputFiles("input[type=file]", [fx("vertical.mp4"), fx("landscape.mp4")]);
  await page.locator("[data-testid=library] button").nth(1).waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
  await page.goto(`${BASE}/`);
  await page.getByText(/Storage \d+% full/).waitFor({ timeout: 20000 });
  await page.locator("aside").getByText("Getting full").waitFor();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "storage-banner.png") });
  const phone = await browser.newContext({ ...devices["iPhone 13"] });
  await phone.addCookies(await ctx.cookies());
  const pp = await phone.newPage();
  await pp.goto(`${BASE}/`);
  await pp.locator("nav [aria-label='Storage needs attention']").waitFor();
  await pp.getByText(/Storage \d+% full/).waitFor();
  if (await pp.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error("phone overflow with banner");
  if (SHOTS) await pp.screenshot({ path: path.join(SHOTS, "storage-phone.png") });
  await phone.close();

  step("an upload that won't fit is refused before sending");
  await page.goto(`${BASE}/media`);
  await page.setInputFiles("input[type=file]", fx("vertical.mp4"));
  await page.getByText(/won't fit/).waitFor();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "storage-panel.png"), fullPage: true });

  step("server enforces the limit even if the browser check is bypassed");
  const res = await page.request.post(`${BASE}/api/media`, { data: fs.readFileSync(fx("vertical.mp4")), headers: { "content-type": "video/mp4", "x-file-name": "sneaky.mp4" } });
  if (res.status() !== 507) throw new Error(`expected 507, got ${res.status()}`);
  console.log("  server said:", (await res.json()).error);

  step("files in a draft are protected; 'delete all unused' frees the rest");
  await page.goto(`${BASE}/accounts`);
  await page.click("text=Add demo Instagram account");
  await page.goto(`${BASE}/media`);
  await page.click("button:text-is('Select')");
  await page.locator("[data-testid=library] button").nth(0).click();
  await page.click("text=New post with 1");
  await page.locator("button[aria-pressed]", { hasText: "Demo IG" }).click();
  await page.click("button:text-is('Save draft')");
  await page.waitForURL(/\/posts\//);
  await page.goto(`${BASE}/media`);
  await page.getByText(/Delete all unused/).click();
  await page.locator("[role=dialog] button:text-is('Delete')").click();
  await page.locator("[role=status]", { hasText: /Deleted 1 file/ }).waitFor();
  const left = await page.locator("[data-testid=library] button").count();
  if (left !== 1) throw new Error(`expected the draft's file to remain, found ${left} files`);
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(500);
  if (await page.getByText(/Storage \d+% full/).count()) {
    const r = await (await page.request.get(`${BASE}/api/storage`)).json();
    throw new Error(`banner still shown after cleanup: ${JSON.stringify({ used: r.used, limit: r.limit, level: r.level, breakdown: r.breakdown })}`);
  }

  console.log("✓ storage passed");
} catch (e) {
  console.error("✗", e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
