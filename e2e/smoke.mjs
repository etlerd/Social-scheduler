// End-to-end smoke test against a running server started with ENABLE_DEMO_ACCOUNTS=true.
// Usage: BASE_URL=http://localhost:3100 APP_PASSWORD=... node e2e/smoke.mjs [screenshotDir]
import { chromium, devices } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const PW = process.env.APP_PASSWORD;
const SHOTS = process.argv[2];
const fx = (f) => path.join(import.meta.dirname, "fixtures", f);
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const shot = async (page, name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
const step = (s) => console.log("•", s);

const browser = await chromium.launch();
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  step("login rejects wrong password");
  await page.goto(`${BASE}/`);
  await page.waitForURL(/\/login/);
  await page.fill("#pw", "nope");
  await page.click("button:has-text('Sign in')");
  await page.getByText("Wrong password.").waitFor();
  await page.fill("#pw", PW);
  await page.click("button:has-text('Sign in')");
  await page.waitForURL(`${BASE}/`);

  step("add demo accounts");
  await page.goto(`${BASE}/accounts`);
  await page.click("text=Add demo Instagram account");
  await page.click("text=Add demo YouTube account");
  await page.getByText(/Demo IG/).waitFor();
  await page.getByText(/Demo Channel/).waitFor();
  await shot(page, "desktop-accounts");

  step("compose: one vertical video → IG Reel + YT Short, publish now");
  await page.goto(`${BASE}/compose`);
  await page.locator("button[aria-pressed]", { hasText: "Demo IG" }).click();
  await page.locator("button[aria-pressed]", { hasText: "Demo Channel" }).click();
  await page.setInputFiles("section:has-text('Media') input[type=file]", fx("vertical.mp4"));
  await page.locator("section:has(h2:text-is('Media')) video").first().waitFor({ timeout: 30000 });
  await page.locator("button[aria-pressed=true]", { hasText: "Reel" }).waitFor();
  await page.locator("button[aria-pressed=true]", { hasText: "Short" }).waitFor();
  await page.fill("#caption", "Behind the scenes of today's shoot 🎬 #bts #creator");
  await page.fill("input[placeholder^='Short title']", "How we shot this in 6 seconds #Shorts");
  await page.locator("section").filter({ hasText: "Demo IG" }).locator("textarea").fill("#reels #filmmaking");
  await page.click("button:text-is('Publish now')");
  await shot(page, "desktop-compose");
  await page.click("button.btn-primary:text-is('Publish')");
  await page.waitForURL(/\/posts\/[\w-]+$/);
  step("wait for both to publish via the worker");
  await page.getByText("Published", { exact: true }).first().waitFor();
  for (let i = 0; i < 40; i++) {
    const n = await page.locator(".chip", { hasText: /^Published$/ }).count();
    if (n >= 3) break; // post badge + 2 targets
    await page.waitForTimeout(1000);
  }
  if ((await page.locator(".chip", { hasText: /^Published$/ }).count()) < 3) throw new Error("targets did not publish");
  await page.getByText("Open on Instagram").waitFor();
  await page.getByText("Open on YouTube").waitFor();
  await shot(page, "desktop-post-detail");
  step("published media file is deleted from the server");
  await page.reload();
  await page.getByText("Video deleted after publishing").waitFor();

  step("validation blocks a PNG-free IG post without media");
  await page.goto(`${BASE}/compose`);
  await page.locator("button[aria-pressed]", { hasText: "Demo IG" }).click();
  await page.getByText("Add a photo.").waitFor();
  if (!(await page.locator("button.btn-primary:text-is('Schedule')").isDisabled())) throw new Error("schedule should be disabled");

  step("carousel from PNG (auto-converted to JPEG) + JPEG, scheduled tomorrow; YT thumbnail");
  await page.setInputFiles("section:has-text('Media') input[type=file]", [fx("square.png"), fx("portrait.jpg")]);
  await page.locator("button[aria-pressed=true]", { hasText: "Carousel" }).waitFor({ timeout: 30000 });
  await page.fill("#caption", "Two looks, one day. Swipe → #style");
  const tomorrow = new Date(Date.now() + 86400_000);
  tomorrow.setHours(9, 30, 0, 0);
  const p2 = (n) => String(n).padStart(2, "0");
  await page.fill("input[type=datetime-local]", `${tomorrow.getFullYear()}-${p2(tomorrow.getMonth() + 1)}-${p2(tomorrow.getDate())}T09:30`);
  const errs = await page.locator("li.text-bad").count();
  if (errs) throw new Error(`unexpected validation errors: ${await page.locator("li.text-bad").allTextContents()}`);
  await page.click("button.btn-primary:text-is('Schedule')");
  await page.waitForURL(/\/posts\/[\w-]+$/);
  await page.getByText("Scheduled", { exact: true }).first().waitFor();

  step("media library shows converted JPEG");
  await page.goto(`${BASE}/media`);
  await page.locator("button:has(img[alt='square.jpg'])").click();
  await page.getByText("image/jpeg").waitFor();
  await page.keyboard.press("Escape");

  step("#fail caption → failed status + retry button");
  await page.goto(`${BASE}/compose`);
  await page.locator("button[aria-pressed]", { hasText: "Demo IG" }).click();
  await page.click("text=Library");
  await page.locator("[role=dialog] button:has(img[alt='portrait.jpg'])").click();
  await page.click("text=/Use 1 selected/");
  await page.fill("#caption", "this one breaks #fail");
  await page.click("button:text-is('Publish now')");
  await page.click("button.btn-primary:text-is('Publish')");
  await page.waitForURL(/\/posts\/[\w-]+$/);
  await page.locator("p.text-bad", { hasText: "Simulated platform error" }).waitFor({ timeout: 30000 });
  await page.getByText("Retry failed").waitFor();

  step("calendar + posts list");
  await page.goto(`${BASE}/`);
  if (tomorrow.getMonth() !== new Date().getMonth()) await page.click("[aria-label='Next month']");
  await page.getByText("Two looks, one day").first().waitFor();
  await shot(page, "desktop-calendar");
  await page.goto(`${BASE}/posts`);
  await page.click("button:has-text('Needs attention')");
  await page.getByText("this one breaks").waitFor();

  step("mobile layout");
  const m = await browser.newContext({ ...devices["iPhone 13"] });
  await m.addCookies(await ctx.cookies());
  const mp = await m.newPage();
  mp.on("pageerror", (e) => errors.push(e.message));
  await mp.goto(`${BASE}/`);
  await mp.locator("nav a[aria-label='New post']").waitFor();
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) throw new Error("horizontal overflow on mobile calendar");
  await shot(mp, "mobile-calendar");
  await mp.goto(`${BASE}/compose`);
  await mp.locator("button[aria-pressed]", { hasText: "Demo Channel" }).click();
  await mp.setInputFiles("section:has-text('Media') input[type=file]", fx("landscape.mp4"));
  await mp.locator("main").getByText(/^16:9/).waitFor({ timeout: 30000 });
  await mp.fill("input[placeholder='Video title']", "Full tutorial");
  if (await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error("horizontal overflow on mobile composer");
  await shot(mp, "mobile-compose");
  const sched = mp.locator("button.btn-primary:text-is('Schedule')");
  if (await sched.isDisabled()) throw new Error(`mobile Schedule disabled; issues: ${await mp.locator("li.text-bad").allTextContents()}`);
  await mp.click("button:has-text('Preview')");
  await mp.locator("[role=dialog]").getByText("Full tutorial").waitFor();
  await shot(mp, "mobile-preview");
  await mp.keyboard.press("Escape");
  await mp.goto(`${BASE}/posts`);
  await mp.click("button:has-text('All')");
  if (await mp.evaluate(() => [...document.querySelectorAll("main a.card")].some((el) => el.getBoundingClientRect().right > window.innerWidth))) throw new Error("post cards overflow on mobile");
  await shot(mp, "mobile-posts");

  const real = errors.filter((e) => !/favicon|Failed to load resource: the server responded with a status of 4/.test(e));
  if (real.length) throw new Error(`browser errors:\n${real.join("\n")}`);
  console.log("✓ smoke passed");
} catch (e) {
  console.error("✗", e.message);
  if (errors.length) console.error("browser errors:", errors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
