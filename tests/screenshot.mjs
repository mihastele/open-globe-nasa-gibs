/** Capture a README screenshot showing the globe with terrain + 3D buildings. */
import { chromium } from 'playwright';

const BASE = process.env.APP_URL || 'http://127.0.0.1:5173/';

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.earthExplorer, { timeout: 60000 });
await page.waitForTimeout(8000);

await page.click('label.switch:has(#terrainToggle)');
await page.waitForTimeout(8000);
await page.click('label.switch:has(#buildingsToggle)');
await page.waitForTimeout(10000);

// A three-quarter view over central Vienna, where the buildings are dense.
await page.evaluate(() => {
  const { viewer } = window.earthExplorer;
  const Cartesian3 = viewer.camera.position.constructor;
  const rad = (d) => (d * Math.PI) / 180;
  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(16.3695, 48.2085, 2100),
    orientation: { heading: rad(35), pitch: rad(-58), roll: 0 },
  });
});
await page.waitForTimeout(20000);

await page.screenshot({ path: 'docs/screenshot.png' });
console.log('screenshot written to docs/screenshot.png');
await browser.close();
