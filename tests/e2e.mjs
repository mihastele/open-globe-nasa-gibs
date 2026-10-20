/**
 * End-to-end smoke test for the Earth Explorer globe.
 *
 * Drives a real Chrome via Playwright: loads the app, checks the globe renders,
 * exercises each layer toggle, place search, and the street-level view.
 *
 *   node tests/e2e.mjs          → test the dev server (default)
 *   node tests/e2e.mjs --prod   → build and test the production bundle
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const PROD = process.argv.includes('--prod');

/** Path to the locally installed vite binary (avoids npx, which fails to spawn here). */
const VITE_BIN = resolve(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vite.cmd' : 'vite',
);

/**
 * Windows needs `shell: true` to launch a `.cmd` shim; on POSIX the binary
 * can be executed directly.
 */
const SPAWN_OPTS = { cwd: projectRoot, shell: process.platform === 'win32' };

/** Start `vite preview` on a free port and resolve once it answers. */
async function startPreview() {
  const port = 4180;
  const child = spawn(
    VITE_BIN,
    ['preview', '--port', String(port), '--host', '127.0.0.1', '--strictPort'],
    { ...SPAWN_OPTS, stdio: 'pipe' },
  );

  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch(url);
      if (res.ok) return { child, url };
    } catch {
      /* not up yet */
    }
  }
  child.kill();
  throw new Error('vite preview did not start');
}

let server = null;
let BASE = process.env.APP_URL || 'http://127.0.0.1:5173/';

if (PROD) {
  console.log('Building production bundle (mode=e2e)…');
  await new Promise((resolveBuild, rejectBuild) => {
    const build = spawn(VITE_BIN, ['build', '--mode', 'e2e'], {
      ...SPAWN_OPTS,
      stdio: 'inherit',
    });
    build.on('exit', (code) =>
      code === 0 ? resolveBuild() : rejectBuild(new Error(`build failed (${code})`)),
    );
  });

  console.log('Starting vite preview…');
  server = await startPreview();
  BASE = server.url;
  console.log(`Testing production build at ${BASE}\n`);
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.earthExplorer, { timeout: 60000 });
await page.waitForTimeout(9000);

/* ---------------------------------------------------------- globe renders */

const canvasInfo = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  return c ? { w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight } : null;
});
check(
  'canvas fills the viewport',
  !!canvasInfo && canvasInfo.w > 1000 && canvasInfo.h > 600,
  canvasInfo ? `${canvasInfo.w}x${canvasInfo.h}` : 'no canvas',
);

const readout = await page.textContent('#coordReadout');
check('coordinate readout populated', /\d+\.\d+°/.test(readout || ''), readout || '');

/* ------------------------------------------------------ imagery is drawn */

// The WebGL drawing buffer is not preserved after compositing, so sample it
// from inside a render frame via Cesium's post-render hook.
const pixels = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const { viewer } = window.earthExplorer;
      const canvas = viewer.scene.canvas;

      const listener = (scene) => {
        viewer.scene.postRender.removeEventListener(listener);
        const tmp = document.createElement('canvas');
        tmp.width = 200;
        tmp.height = 200;
        const ctx = tmp.getContext('2d');
        ctx.drawImage(
          canvas,
          canvas.width / 2 - 300,
          canvas.height / 2 - 300,
          600,
          600,
          0,
          0,
          200,
          200,
        );
        const d = ctx.getImageData(0, 0, 200, 200).data;
        let lit = 0;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) {
          const v = d[i] + d[i + 1] + d[i + 2];
          sum += v;
          if (v > 30) lit++;
        }
        resolve({ lit, total: d.length / 4, avg: sum / (d.length / 4) });
      };

      viewer.scene.postRender.addEventListener(listener);
      setTimeout(() => resolve(null), 8000);
    }),
);
check(
  'satellite imagery drawn on the globe',
  !!pixels && pixels.lit > pixels.total * 0.5 && pixels.avg > 20,
  pixels ? `${pixels.lit}/${pixels.total} lit, avg ${pixels.avg.toFixed(0)}` : 'no sample',
);

/* ------------------------------------------------------------ 3D terrain */

// The checkbox itself is visually hidden behind a styled switch, so click the label.
// Capture the provider before the toggle: the app starts on the flat ellipsoid,
// so a changed provider afterwards means real elevation was attached.
const terrainBefore = await page.evaluate(
  () => window.earthExplorer.viewer.terrainProvider,
);
await page.click('label.switch:has(#terrainToggle)');
await page.waitForTimeout(9000);

// Assert on behaviour, not on the class name: production builds minify it.
const terrain = await page.evaluate((before) => {
  const provider = window.earthExplorer.viewer.terrainProvider;
  return {
    changed: provider !== before,
    hasLevelZeroError: typeof provider.getLevelMaximumGeometricError === 'function',
    tilesAvailable: provider.availability !== undefined,
  };
}, terrainBefore);
check(
  '3D terrain provider active',
  terrain.changed && terrain.hasLevelZeroError,
  JSON.stringify(terrain),
);

/* ---------------------------------------------------------- 3D buildings */

await page.click('label.switch:has(#buildingsToggle)');
await page.waitForTimeout(14000);
const primitives = await page.evaluate(
  () => window.earthExplorer.viewer.scene.primitives.length,
);
check('3D building primitives added', primitives > 0, `${primitives} primitives`);

/* --------------------------------------------------------- NASA timemachine */

await page.click('label.switch:has(#gibsToggle)');
await page.waitForTimeout(12000);
const gibsState = await page.evaluate(() => {
  const v = window.earthExplorer.viewer;
  const l = v.imageryLayers.get(1);
  if (!l) return null;
  const p = l.imageryProvider;
  return {
    // The debug handle exposes the provider's own marker; class names are
    // minified in production builds, so check behaviour instead.
    isGibs: typeof p.getTime === 'function' && typeof p.setTime === 'function',
    time: typeof p.getTime === 'function' ? p.getTime() : null,
    colorToAlpha: l.colorToAlpha ? l.colorToAlpha.toCssColorString() : null,
  };
});
check(
  'NASA GIBS layer added with black-to-alpha',
  !!gibsState && gibsState.isGibs && !!gibsState.colorToAlpha,
  JSON.stringify(gibsState),
);

// Date scrubbing
await page.fill('#gibsDate', '2026-09-01');
await page.dispatchEvent('#gibsDate', 'change');
await page.waitForTimeout(6000);
const providerTime = await page.evaluate(
  () => window.earthExplorer.viewer.imageryLayers.get(1).imageryProvider.getTime(),
);
check('date scrub updates the provider', providerTime === '2026-09-01', providerTime);

/* ---------------------------------------------------------------- search */

await page.fill('#searchInput', 'Triglav Slovenia');
await page.waitForTimeout(6000);
const resultCount = await page.locator('#searchResults .search-item').count();
check('place search returns results', resultCount > 0, `${resultCount} results`);

if (resultCount > 0) {
  const first = await page.locator('#searchResults .search-item').first().innerText();
  check('search result has a name', first.trim().length > 0, first.split('\n')[0]);
  await page.locator('#searchResults .search-item').first().click();
  await page.waitForTimeout(5000);
  const coord = await page.textContent('#coordReadout');
  check('selecting a result flies the camera', /46\./.test(coord || ''), coord || '');
}

/* ---------------------------------------------------------- street level */

// Fly somewhere with KartaView coverage (Berlin).
await page.evaluate(() => {
  const { viewer } = window.earthExplorer;
  const Cartesian3 = viewer.camera.position.constructor;
  const rad = (d) => (d * Math.PI) / 180;
  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(13.405, 52.52, 3000),
    orientation: { heading: rad(0), pitch: rad(-70), roll: 0 },
  });
});
await page.waitForTimeout(6000);

// Click the globe with real pointer events (Cesium listens for pointerdown/up).
// The target is a spot in central Berlin that has KartaView coverage.
const box = await page.locator('canvas').boundingBox();
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(16000);

const street = await page.evaluate(() => {
  const panel = document.getElementById('streetPanel');
  const img = document.getElementById('streetImage');
  return {
    visible: panel && !panel.classList.contains('hidden'),
    src: img ? img.src : '',
    meta: document.getElementById('streetMeta')?.textContent || '',
  };
});
check(
  'street-level view opens on click',
  street.visible && street.src.includes('openstreetcam'),
  JSON.stringify(street).slice(0, 160),
);

/* --------------------------------------------------------- basemap switch */

await page.click('.basemap-btn[data-id="dark"]');
await page.waitForTimeout(7000);
const basemap = await page.evaluate(() => {
  const v = window.earthExplorer.viewer;
  const l = v.imageryLayers.get(0);
  return l.imageryProvider._resource ? l.imageryProvider._resource.url : '';
});
check('basemap switches', basemap.includes('dark_all'), basemap.slice(-40));

/* ------------------------------------------------------------- console log */

const realErrors = consoleErrors.filter(
  (e) => !/favicon|Failed to load resource.*40[04]|GIBS tile request failed/i.test(e),
);
check('no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await page.screenshot({ path: 'test-screenshot.png', fullPage: false });
await browser.close();
server?.child.kill();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILED:');
  failed.forEach((f) => console.log(`  - ${f.name} ${f.detail}`));
  process.exit(1);
}
