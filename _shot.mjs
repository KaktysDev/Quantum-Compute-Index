import { chromium } from "playwright-core";
const exe = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const routes = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
for (const r of routes) {
  const name = r.replace(/[^a-z0-9]+/gi, "_") || "root";
  await page.goto("http://localhost:3001" + r, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(600);
  const out = `/private/tmp/claude-501/-Users-gouthamkr-Documents-GitHub-Quantum-Compute-Index/a6ecc1a8-14bf-4a9c-bb83-f9137abc3010/scratchpad/shot${name}.png`;
  await page.screenshot({ path: out, fullPage: true });
  console.log("saved", out);
}
await browser.close();
